"""临时 PCM 连接拥有全文转录与结束语义，不感知身份或业务数据。"""
import asyncio
from aiohttp import WSMsgType
from .tencent import (TencentAsrCredentials, TencentRecognitionStream, TencentRecognitionSlice,
                      TencentRecognitionCompleted, TencentAsrError)


class Speech:
    def __init__(self, config):
        self.config = config
        self.sessions = set()

    @property
    def configured(self):
        return all(self.config.get(key) for key in
                   ('TENCENTCLOUD_APPID', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY'))

    async def serve(self, socket):
        session = RecognitionSession(socket, self.config)
        self.sessions.add(session)
        try:
            await session.run()
        finally:
            try:
                await session.close()
            finally:
                self.sessions.discard(session)

    async def close(self):
        await asyncio.gather(*(s.close() for s in list(self.sessions)))


class RecognitionSession:
    def __init__(self, socket, config):
        self.socket = socket
        self.stream = TencentRecognitionStream(TencentAsrCredentials(
            config['TENCENTCLOUD_APPID'], config['TENCENTCLOUD_SECRET_ID'], config['TENCENTCLOUD_SECRET_KEY']),
            engine=config.get('TENCENT_ASR_ENGINE') or '16k_zh')
        self.receive_task = None
        self.segments = {}

    async def run(self):
        try:
            await self.stream.connect()
            await self.socket.send_json({'type': 'ready'})
            self.receive_task = asyncio.create_task(self.receive())
            async for message in self.socket:
                if message.type == WSMsgType.BINARY:
                    if not message.data or len(message.data) % 2:
                        raise ValueError('音频块必须是 16bit 单声道 PCM')
                    await self.stream.write_pcm(message.data)
                elif message.type == WSMsgType.TEXT and message.data == 'stop':
                    await self.stream.finish()
                    await asyncio.wait_for(asyncio.shield(self.receive_task), 10)
                    return
                else:
                    raise ValueError('语音连接只接受 PCM 音频和 stop')
        except (TencentAsrError, TimeoutError):
            await self.error('语音识别连接失败或结束未确认，请校对已有文字；草稿仍可编辑')
        except ValueError as error:
            await self.error(str(error))
        except ConnectionError:
            # 浏览器取消或断网即释放，不发送完成、不保存草稿。
            return

    async def receive(self):
        try:
            while True:
                event = await self.stream.receive()
                if isinstance(event, TencentRecognitionSlice):
                    self.segments[event.index] = event.text
                    await self.socket.send_json({'type': 'transcript', 'text': self.text()})
                elif isinstance(event, TencentRecognitionCompleted):
                    await self.socket.send_json({'type': 'completed', 'text': self.text()})
                    return
        except TencentAsrError:
            await self.error('语音识别连接中断，请重试或使用文字录入')
            await self.socket.close()

    def text(self):
        return ''.join(self.segments[k] for k in sorted(self.segments))

    async def error(self, message):
        if not self.socket.closed:
            await self.socket.send_json({'type': 'error', 'message': message})

    async def close(self):
        try:
            if self.receive_task:
                self.receive_task.cancel()
                await asyncio.gather(self.receive_task, return_exceptions=True)
        finally:
            try:
                await self.stream.close()
            finally:
                await self.socket.close()
