# 语音识别

Speech(config) 公开 configured、serve(socket)、close()。入口装配配置及已经通过 access 校验的 aiohttp WebSocket；speech 不读取环境变量、身份、event、森林、timer、数据库或备份。websocket.py 拥有临时音频会话和全文，tencent.py 拥有腾讯鉴权、PCM发送与句段解析。

## 连接协议

- GET `/speech/config` 返回 `{configured}`。GET `/speech/stream` 升级 WebSocket。公网升级前校验登录 Cookie、环境和 Origin。
- 浏览器首条消息 `{type:"authorize",csrf}` 由 access 校验；本机 csrf 为 null，公网为当前会话令牌。5秒内未通过则关闭，成功返回 `{type:"authorized"}`，才启动腾讯连接。令牌不进入 URL。
- speech 在腾讯连接成功后发送 `{type:"ready"}`，浏览器此后才发送音频。
- 二进制为16kHz、16bit、有符号小端、单声道PCM，无文件头。前端按实际 AudioContext 采样率跨帧积分降采样，80ms一块（2560字节），尾块可以更短；单条消息最大32000字节。前端发送积压超过64000字节时失败，避免无限缓存和突发回放。
- 返回 `{type:"transcript",text}` 是识别全文，句段按编号覆盖、拼接。调用者直接替换识别草稿，键盘草稿独立保留。
- 浏览器停止时先停止麦克风、等待处理器发送尾块，再发送文本 `stop`。后端按到达顺序直送所有PCM，不再二次分块或缓存，然后封口，等待最终识别最多10秒，再返回 `{type:"completed",text}`。前端收到最终全文才确认卡片。
- 错误返回 `{type:"error",message}`，取消关闭连接；两者释放音频和腾讯流，均不保存业务数据。关闭应用释放所有会话。

## 前端归属

`frontend/plugin/speech/index.js` 提供 start/stop/cancel 和 onText/onState/onComplete/onError；只使用入口装配的 request/openSocket，不感知登录内部状态。audio.js 管理一个音频上下文、麦克风与结束；processor.js 是独立 AudioWorklet，转换采样和分块；silence.js 使用同一上下文检测停顿，不决定业务保存。

采样转换验证见 `tests/pcm.test.js`；真实WS与释放验证见 `tests/test_speech.py`；认证见 `tests/test_access.py`；卡片与真实AudioWorklet流程见 `tests/browser/speech*.spec.js`。收费腾讯验收由 COMPOUND_TEST_SPEECH=1 显式启用。Windows Playwright WebKit 无 Web Audio，真实 iPhone Safari 的权限、采样、停顿与公网音频必须另验。
