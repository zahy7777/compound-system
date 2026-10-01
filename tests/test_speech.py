"""音频轨道自然结束时不能取消或等待当前消费任务。"""
import asyncio
from aiortc.mediastreams import MediaStreamError
from service.speech.webrtc import RecognitionSession
from service.speech.tencent import TencentRecognitionCompleted


def test_audio_track_end_finishes_without_self_cancellation():
    class Stream:
        def __init__(self):
            self.done = asyncio.Event()
            self.closed = False

        async def connect(self):
            pass

        async def receive(self):
            await self.done.wait()
            return TencentRecognitionCompleted(raw={})

        async def finish(self):
            self.done.set()

        async def close(self):
            self.closed = True

    class Track:
        async def recv(self):
            raise MediaStreamError

    async def run():
        session = RecognitionSession(None, {"TENCENTCLOUD_APPID": "1", "TENCENTCLOUD_SECRET_ID": "test", "TENCENTCLOUD_SECRET_KEY": "test"})
        session.stream = Stream()
        session.audio_task = asyncio.create_task(session.consume(Track()))
        await asyncio.wait_for(session.audio_task, 2)
        assert session.finishing
        assert session.stream.closed
        assert session.receive_task.done()
        assert not session.audio_task.cancelled()

    asyncio.run(run())


def test_speech_api_is_independent(system):
    from aiohttp.test_utils import TestClient, TestServer
    from backend.__main__ import make_app

    class Speech:
        configured = True
        ice_servers = []
        closed = False
        async def offer(self, sdp, type):
            assert (sdp, type) == ('test-sdp', 'offer')
            return {'sdp': 'answer-sdp', 'type': 'answer'}
        async def close(self):
            self.closed = True

    async def run():
        kernel, repo, backup = system
        speech = Speech()
        async with TestClient(TestServer(make_app(kernel, backup, speech))) as client:
            response = await client.get('/speech/config')
            assert await response.json() == {'configured': True, 'iceServers': []}
            response = await client.post('/speech/offer', json={'sdp': 'test-sdp', 'type': 'offer'})
            assert await response.json() == {'sdp': 'answer-sdp', 'type': 'answer'}
            response = await client.post('/speech/offer', json={'sdp': 'test-sdp', 'type': 'answer'})
            assert response.status == 400
            speech.configured = False
            response = await client.post('/speech/offer', json={'sdp': 'test-sdp', 'type': 'offer'})
            assert response.status == 400
            assert kernel.read([[]]) == [[]]
        assert speech.closed

    asyncio.run(run())


def test_transcript_replaces_segments_and_waits_for_final():
    from service.speech.tencent import TencentRecognitionSlice
    class Channel:
        readyState = 'open'
        def __init__(self): self.messages = []
        def send(self, value):
            import json
            self.messages.append(json.loads(value))
    class Stream:
        def __init__(self):
            self.events = iter([TencentRecognitionSlice(0, '初稿', False, {}), TencentRecognitionSlice(0, '最终', True, {}), TencentRecognitionSlice(1, '文本', True, {}), TencentRecognitionCompleted({})])
        async def receive(self): return next(self.events)
    async def run():
        session = RecognitionSession(None, {'TENCENTCLOUD_APPID': '1', 'TENCENTCLOUD_SECRET_ID': 'test', 'TENCENTCLOUD_SECRET_KEY': 'test'})
        session.stream = Stream(); session.channel = Channel()
        await session.receive()
        assert session.channel.messages == [{'type': 'transcript', 'text': '初稿'}, {'type': 'transcript', 'text': '最终'}, {'type': 'transcript', 'text': '最终文本'}, {'type': 'completed', 'text': '最终文本'}]
    asyncio.run(run())


def test_ready_when_channel_arrives_already_open():
    import json
    class Channel:
        readyState = 'open'
        def __init__(self): self.messages = []
        def send(self, value): self.messages.append(json.loads(value))
        def on(self, name): return lambda callback: callback
    session = RecognitionSession(None, {'TENCENTCLOUD_APPID': '1', 'TENCENTCLOUD_SECRET_ID': 'test', 'TENCENTCLOUD_SECRET_KEY': 'test'})
    session.ready = True
    channel = Channel()
    session.attach(channel)
    assert channel.messages == [{'type': 'ready'}]
