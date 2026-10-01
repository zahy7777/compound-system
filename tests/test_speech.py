"""真实 WS 会话验证 PCM、全文、停止、取消与失败，不调用收费识别。"""
import asyncio
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from backend.__main__ import make_app
from service.speech import Speech
from service.speech.tencent import TencentRecognitionSlice, TencentRecognitionCompleted, TencentAsrError

CONFIG = {'TENCENTCLOUD_APPID': '1', 'TENCENTCLOUD_SECRET_ID': 'test', 'TENCENTCLOUD_SECRET_KEY': 'test'}


class Stream:
    def __init__(self, *args, **kwargs):
        self.events = asyncio.Queue()
        self.audio = bytearray()
        self.closed = False
        self.finished = False
    async def connect(self): pass
    async def write_pcm(self, audio):
        self.audio.extend(audio)
        await self.events.put(TencentRecognitionSlice(0, '初稿', False, {}))
        await self.events.put(TencentRecognitionSlice(0, '最终', True, {}))
        await self.events.put(TencentRecognitionSlice(1, '文本', True, {}))
    async def receive(self): return await self.events.get()
    async def finish(self):
        self.finished = True
        await self.events.put(TencentRecognitionCompleted({}))
    async def close(self): self.closed = True


@pytest.mark.parametrize('action', ['stop', 'cancel', 'invalid', 'failure'])
def test_pcm_session_lifecycle(system, monkeypatch, action):
    streams = []
    class Recognition(Stream):
        def __init__(self, *args, **kwargs):
            super().__init__(); streams.append(self)
        async def write_pcm(self, audio):
            if action == 'failure': raise TencentAsrError('断网')
            await super().write_pcm(audio)
    monkeypatch.setattr('service.speech.websocket.TencentRecognitionStream', Recognition)
    async def run():
        kernel, repo, backup = system
        speech = Speech(CONFIG)
        async with TestClient(TestServer(make_app(kernel, backup, speech))) as client:
            assert await (await client.get('/speech/config')).json() == {'configured': True}
            assert (await client.post('/speech/offer', json={})).status == 404
            socket = await client.ws_connect('/speech/stream')
            assert await socket.receive_json() == {'type': 'authorized'}
            assert await socket.receive_json() == {'type': 'ready'}
            if action == 'cancel':
                await socket.close()
            elif action == 'invalid':
                await socket.send_bytes(b'x')
                assert (await socket.receive_json())['type'] == 'error'
            else:
                await socket.send_bytes(b'\x00\x10' * 1280)
                if action == 'failure':
                    assert (await socket.receive_json())['type'] == 'error'
                else:
                    assert await socket.receive_json() == {'type': 'transcript', 'text': '初稿'}
                    assert await socket.receive_json() == {'type': 'transcript', 'text': '最终'}
                    assert await socket.receive_json() == {'type': 'transcript', 'text': '最终文本'}
                    await socket.send_bytes(b'\x00\x20' * 3)
                    await socket.send_str('stop')
                    while True:
                        message = await socket.receive_json()
                        if message['type'] == 'completed':
                            assert message['text'] == '最终文本'; break
                    assert streams[0].audio == b'\x00\x10' * 1280 + b'\x00\x20' * 3
                    assert streams[0].finished
            if not socket.closed: await socket.close()
            assert kernel.read([[]]) == [[]]
        assert streams[0].closed and not speech.sessions
    asyncio.run(run())


def test_unconfigured_speech_rejects_connection(system):
    async def run():
        kernel, repo, backup = system
        async with TestClient(TestServer(make_app(kernel, backup, Speech({})))) as client:
            assert (await client.get('/speech/stream')).status == 400
    asyncio.run(run())


def test_speech_through_public_gateway(system, tmp_path, monkeypatch):
    import sys
    from pathlib import Path
    from backend.access import Access
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'public_gateway'))
    from router.app import create_app
    streams = []
    class Recognition(Stream):
        def __init__(self, *args, **kwargs):
            super().__init__(); streams.append(self)
    monkeypatch.setattr('service.speech.websocket.TencentRecognitionStream', Recognition)
    async def run():
        kernel, repo, backup = system
        access = Access(tmp_path / 'access')
        backend = TestServer(make_app(kernel, backup, Speech(CONFIG), access))
        await backend.start_server()
        try:
            async with TestClient(TestServer(create_app({'/compound/dev': str(backend.make_url('/')).rstrip('/')}, public_scheme='http'))) as client:
                assert (await client.get('/compound/dev/speech/config')).status == 401
                password = (tmp_path / 'access' / 'initial-password.txt').read_text(encoding='utf-8')
                login = await client.post('/compound/dev/access/login', json={'password': password})
                csrf = (await login.json())['csrf']
                socket = await client.ws_connect('/compound/dev/speech/stream', headers={'Origin': str(client.make_url('/')).rstrip('/')})
                await socket.send_json({'type': 'authorize', 'csrf': csrf})
                assert await socket.receive_json() == {'type': 'authorized'}
                assert await socket.receive_json() == {'type': 'ready'}
                await socket.send_bytes(b'\x00\x10' * 10)
                await socket.send_str('stop')
                while (await socket.receive_json())['type'] != 'completed': pass
                await socket.close()
            assert streams[0].audio == b'\x00\x10' * 10
        finally:
            await backend.close()
        assert streams[0].closed
    asyncio.run(run())
