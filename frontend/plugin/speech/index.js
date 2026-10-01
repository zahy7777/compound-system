import {createAudio} from './audio.js'
import {detectSilence} from './silence.js'

/** 一次收音会话只产出完整转录，不拥有业务正文或保存动作。 */
export function createSpeech({onText, onState, onComplete, onError, request, openSocket}) {
  let socket, audio, stopMeter, deadline, controller, generation = 0, state = 'idle'
  function phase(value, detail = {}) {state = value; onState(value, detail)}
  function cancel() {
    generation++; clearTimeout(deadline); controller?.abort(); controller = null
    stopMeter?.(); stopMeter = null; audio?.cancel(); audio = null
    if (socket) {socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); socket = null}
    phase('idle')
  }
  function fail(message) {cancel(); onError(message)}
  async function stop() {
    if (state === 'finishing') return
    if (state !== 'recording') {cancel(); onComplete(); return}
    const current = generation
    phase('finishing'); stopMeter?.(); stopMeter = null; clearTimeout(deadline)
    deadline = setTimeout(() => fail('识别结束未确认，草稿保留，请校对后保存'), 12000)
    try {
      await audio.finish()
      if (current === generation) socket.send('stop')
    } catch (error) {if (current === generation) fail(error.message)}
  }
  async function start() {
    cancel(); const current = generation; phase('connecting')
    try {
      // 在用户手势中激活上下文，Safari 不必等待网络请求后再解锁音频。
      audio = createAudio(chunk => {
        if (current !== generation || !['recording', 'finishing'].includes(state)) return
        if (socket?.readyState !== WebSocket.OPEN) {fail('语音连接中断，草稿保留'); return}
        if (socket.bufferedAmount > 64_000) {fail('语音网络拥堵，草稿保留，请重新录音'); return}
        socket.send(chunk)
      }, message => {if (current === generation) fail(message)})
      const response = await request('/speech/config'), config = await response.json()
      if (current !== generation) return
      if (!response.ok) throw new Error(config.error || '无法读取语音配置')
      if (!config.configured) {cancel(); phase('idle', {unconfigured: true}); return}
      const recorder = audio
      await recorder.start()
      if (current !== generation) return
      controller = new AbortController()
      const connected = await openSocket('/speech/stream', {signal: controller.signal})
      if (current !== generation) {connected.close(); return}
      socket = connected
      deadline = setTimeout(() => fail('语音连接超时，仍可键盘输入'), 10000)
      socket.onmessage = event => {
        if (current !== generation) return
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'ready' && state === 'connecting') {
            clearTimeout(deadline); phase('recording'); recorder.record()
            stopMeter = detectSilence(recorder.context, recorder.source,
              (level, countdown) => onState('recording', {level, countdown}), stop)
          }
          if (message.type === 'transcript') onText(message.text)
          if (message.type === 'completed') {onText(message.text); cancel(); onComplete()}
          if (message.type === 'error') fail(message.message)
        } catch {fail('语音返回无效消息，草稿保留')}
      }
      socket.onerror = socket.onclose = () => {
        if (current === generation) fail('语音连接中断，草稿保留，仍可键盘输入')
      }
    } catch (error) {if (current === generation) fail(error.message)}
  }
  return {start, stop, cancel}
}
