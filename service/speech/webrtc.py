"""一条浏览器录音连接仅持有内存音频和转录，结束后释放。"""
import asyncio
import json
import av
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
from aiortc.mediastreams import MediaStreamError
from .tencent import (TencentAsrCredentials, TencentRecognitionStream, TencentRecognitionSlice,
                      TencentRecognitionCompleted, TencentAsrError)


class Speech:
    def __init__(self, config, ice_servers):
        self.config = config
        self.ice_servers = ice_servers
        self.sessions = set()

    @property
    def configured(self):
        return all(self.config.get(key) for key in
                   ("TENCENTCLOUD_APPID", "TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY"))

    async def offer(self, sdp, type):
        rtc = RTCPeerConnection(RTCConfiguration(iceServers=[RTCIceServer(**item) for item in self.ice_servers]))
        session = RecognitionSession(rtc, self.config)
        self.sessions.add(session)

        @rtc.on("datachannel")
        def channel_arrived(channel):
            session.attach(channel)

        @rtc.on("track")
        def track_arrived(track):
            if track.kind == "audio":
                session.audio_task = asyncio.create_task(session.consume(track))

        @rtc.on("connectionstatechange")
        async def state_changed():
            if rtc.connectionState in {"failed", "closed"}:
                await session.close()
                self.sessions.discard(session)

        try:
            await rtc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=type))
            await rtc.setLocalDescription(await rtc.createAnswer())
            return {"sdp": rtc.localDescription.sdp, "type": rtc.localDescription.type}
        except Exception:
            await session.close()
            self.sessions.discard(session)
            raise

    async def close(self):
        await asyncio.gather(*(s.close() for s in list(self.sessions)), return_exceptions=True)
        self.sessions.clear()


class RecognitionSession:
    def __init__(self, rtc, config):
        self.rtc = rtc
        self.stream = TencentRecognitionStream(TencentAsrCredentials(
            config["TENCENTCLOUD_APPID"], config["TENCENTCLOUD_SECRET_ID"], config["TENCENTCLOUD_SECRET_KEY"]),
            engine=config.get("TENCENT_ASR_ENGINE") or "16k_zh")
        self.channel = None
        self.audio_task = None
        self.receive_task = None
        self.ready = False
        self.finishing = False
        self.closed = False
        self.segments = {}

    def attach(self, channel):
        self.channel = channel
        if self.ready:
            self.emit({"type": "ready"})

        @channel.on("open")
        def opened():
            if self.ready:
                self.emit({"type": "ready"})

        @channel.on("message")
        def message(payload):
            if payload == "stop":
                asyncio.create_task(self.finish())

    def emit(self, message):
        if self.channel and self.channel.readyState == "open":
            self.channel.send(json.dumps(message, ensure_ascii=False))

    async def consume(self, track):
        try:
            await self.stream.connect()
            self.ready = True
            self.receive_task = asyncio.create_task(self.receive())
            self.emit({"type": "ready"})
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            while not self.finishing:
                frame = await track.recv()
                for converted in resampler.resample(frame):
                    await self.stream.write_pcm(bytes(converted.planes[0])[:converted.samples * 2])
        except MediaStreamError:
            if not self.finishing:
                await self.finish()
        except TencentAsrError:
            self.emit({"type": "error", "message": "腾讯语音识别失败，请检查配置、网络或账户余额；草稿仍可文字编辑"})
            await self.close()
        except (ValueError, RuntimeError, OSError):
            self.emit({"type": "error", "message": "麦克风音频处理失败，已收到的文字保留，请重新录音"})
            await self.close()

    async def receive(self):
        try:
            while True:
                event = await self.stream.receive()
                if isinstance(event, TencentRecognitionSlice):
                    self.segments[event.index] = event.text
                    self.emit({"type": "transcript", "text": "".join(self.segments[k] for k in sorted(self.segments))})
                elif isinstance(event, TencentRecognitionCompleted):
                    self.emit({"type": "completed", "text": "".join(self.segments[k] for k in sorted(self.segments))})
                    return
        except TencentAsrError:
            self.emit({"type": "error", "message": "语音识别连接中断，请重试或使用文字录入"})

    async def finish(self):
        if self.finishing or self.closed:
            return
        self.finishing = True
        try:
            if self.audio_task and self.audio_task is not asyncio.current_task():
                self.audio_task.cancel()
                await asyncio.gather(self.audio_task, return_exceptions=True)
            await self.stream.finish()
            if self.receive_task:
                await asyncio.wait_for(asyncio.shield(self.receive_task), 10)
        except (TencentAsrError, TimeoutError):
            self.emit({"type": "error", "message": "识别结束未确认，请校对已经收到的文字"})
        finally:
            await self.stream.close()

    async def close(self):
        if self.closed:
            return
        self.closed = True
        current = asyncio.current_task()
        tasks = [task for task in (self.audio_task, self.receive_task) if task and task is not current]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.stream.close()
        if self.rtc.connectionState != "closed":
            await self.rtc.close()
