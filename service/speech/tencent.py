"""腾讯实时语音识别协议：签名、音频节奏与 WebSocket 消息解析。"""
from __future__ import annotations

import base64
from collections import deque
from dataclasses import dataclass
import hashlib
import hmac
import json
import time
from urllib.parse import quote, urlencode
from uuid import uuid4

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, WebSocketException


# 最初的浏览器实测每次约发送 85ms PCM。正式链路保持同一量级，
# 只合并过小的 WebRTC 帧，不再建立二次实时回放队列。
PCM_CHUNK_BYTES = 2_560


class TencentAsrError(RuntimeError):
    """腾讯实时识别无法继续。"""


@dataclass(frozen=True)
class TencentAsrCredentials:
    app_id: str
    secret_id: str
    secret_key: str


@dataclass(frozen=True)
class TencentRecognitionSlice:
    index: int
    text: str
    stable: bool
    raw: dict


@dataclass(frozen=True)
class TencentRecognitionCompleted:
    raw: dict


TencentRecognitionEvent = TencentRecognitionSlice | TencentRecognitionCompleted


def signed_websocket_url(
    credentials: TencentAsrCredentials,
    *,
    engine: str,
    now: int | None = None,
    voice_id: str | None = None,
) -> str:
    timestamp = int(time.time()) if now is None else now
    params = {
        "appid": credentials.app_id,
        "convert_num_mode": 1,
        "engine_model_type": engine,
        "expired": timestamp + 300,
        "filter_dirty": 0,
        "filter_modal": 0,
        "filter_punc": 0,
        "needvad": 0,
        "nonce": timestamp,
        "secretid": credentials.secret_id,
        "sub_service_type": 1,
        "timestamp": timestamp,
        "voice_format": 1,
        "voice_id": voice_id or str(uuid4()),
        "word_info": 1,
    }
    query = urlencode(sorted((key, str(value)) for key, value in params.items() if key != "appid"))
    sign_text = f"asr.cloud.tencent.com/asr/v2/{credentials.app_id}?{query}"
    signature = base64.b64encode(
        hmac.new(
            credentials.secret_key.encode("utf-8"),
            sign_text.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("ascii")
    return f"wss://{sign_text}&signature={quote(signature, safe='')}"


class TencentRecognitionStream:
    """一条腾讯识别流；按 PCM 的实际到达速度直接发送。"""

    def __init__(self, credentials: TencentAsrCredentials, *, engine: str):
        self._credentials = credentials
        self._engine = engine
        self._connection: ClientConnection | None = None
        self._audio_buffer = bytearray()
        self._pending_events: deque[TencentRecognitionEvent] = deque()
        self._finishing = False

    async def connect(self) -> None:
        if self._connection is not None:
            return
        try:
            self._connection = await connect(
                signed_websocket_url(self._credentials, engine=self._engine),
                proxy=None,
                compression=None,
                open_timeout=5,
                close_timeout=2,
                ping_interval=20,
                ping_timeout=10,
            )
        except (OSError, TimeoutError, WebSocketException) as error:
            raise TencentAsrError(f"腾讯实时识别连接失败：{error}") from error

    async def write_pcm(self, audio: bytes) -> None:
        if self._connection is None:
            raise TencentAsrError("腾讯实时识别尚未连接")
        if self._finishing:
            raise TencentAsrError("腾讯实时识别已经封口")
        self._audio_buffer.extend(audio)
        while len(self._audio_buffer) >= PCM_CHUNK_BYTES:
            chunk = bytes(self._audio_buffer[:PCM_CHUNK_BYTES])
            del self._audio_buffer[:PCM_CHUNK_BYTES]
            await self._send_pcm(chunk)

    async def finish(self) -> None:
        if self._connection is None or self._finishing:
            return
        self._finishing = True
        if self._audio_buffer:
            await self._send_pcm(bytes(self._audio_buffer))
            self._audio_buffer.clear()
        try:
            await self._connection.send(json.dumps({"type": "end"}))
        except (ConnectionClosed, OSError, WebSocketException) as error:
            raise TencentAsrError(f"腾讯实时识别封口失败：{error}") from error

    async def receive(self) -> TencentRecognitionEvent:
        while True:
            if self._pending_events:
                return self._pending_events.popleft()
            if self._connection is None:
                raise TencentAsrError("腾讯实时识别尚未连接")
            try:
                payload = json.loads(await self._connection.recv())
            except (ConnectionClosed, OSError, WebSocketException, json.JSONDecodeError) as error:
                raise TencentAsrError(f"腾讯实时识别接收失败：{error}") from error
            self._pending_events.extend(_recognition_events(payload))

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
            self._connection = None

    async def _send_pcm(self, audio: bytes) -> None:
        assert self._connection is not None
        try:
            await self._connection.send(audio)
        except (ConnectionClosed, OSError, WebSocketException) as error:
            raise TencentAsrError(f"腾讯实时识别音频发送失败：{error}") from error


def _recognition_events(payload: object) -> list[TencentRecognitionEvent]:
    if not isinstance(payload, dict):
        raise TencentAsrError("腾讯实时识别返回了非对象消息")
    code = payload.get("code", 0)
    if code not in (0, "0", None):
        raise TencentAsrError(
            f"腾讯实时识别错误 {code}：{payload.get('message', '未知错误')}"
        )

    events: list[TencentRecognitionEvent] = []
    result = payload.get("result")
    if isinstance(result, dict):
        slice_type = result.get("slice_type")
        if slice_type in (0, 1, 2):
            try:
                index = int(result.get("index", 0))
            except (TypeError, ValueError) as error:
                raise TencentAsrError("腾讯实时识别返回了无效句段序号") from error
            text = result.get("voice_text_str", "")
            events.append(TencentRecognitionSlice(
                index=index,
                text=text if isinstance(text, str) else "",
                stable=slice_type == 2,
                raw=payload,
            ))
    if payload.get("final") in (1, "1"):
        events.append(TencentRecognitionCompleted(raw=payload))
    return events
