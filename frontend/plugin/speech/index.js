import {detectSilence} from './silence.js'

/** 一次收音会话只产出完整转录，不拥有业务正文或保存动作。 */
export function createSpeech({onText, onState, onComplete, onError}) {
  let peer, media, channel, stopMeter, deadline, generation = 0, state = 'idle'
  function phase(value, detail = {}) {state = value; onState(value, detail)}
  function cancel() {
    generation++; clearTimeout(deadline); stopMeter?.(); stopMeter = null
    media?.getTracks().forEach(track => track.stop()); media = null
    peer?.close(); peer = null; channel = null; phase('idle')
  }
  function fail(message) {cancel(); onError(message)}
  function stop() {
    if (state === 'finishing') return
    if (channel?.readyState !== 'open') {cancel(); onComplete(); return}
    phase('finishing'); stopMeter?.(); stopMeter = null; clearTimeout(deadline)
    channel.send('stop'); deadline = setTimeout(() => fail('识别结束未确认，草稿保留，请校对后保存'), 12000)
  }
  async function start() {
    cancel(); const current = generation; phase('connecting')
    try {
      const response = await fetch('/speech/config'), config = await response.json()
      if (current !== generation) return
      if (!response.ok) throw new Error(config.error || '无法读取语音配置')
      if (!config.configured) {phase('idle', {unconfigured: true}); return}
      const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false})
      if (current !== generation) {stream.getTracks().forEach(track => track.stop()); return}
      media = stream; peer = new RTCPeerConnection({iceServers: config.iceServers})
      const connection = peer; stream.getTracks().forEach(track => connection.addTrack(track, stream))
      channel = connection.createDataChannel('transcription')
      deadline = setTimeout(() => fail('语音连接超时，仍可键盘输入'), 20000)
      let listening = false
      channel.onmessage = event => {
        if (current !== generation) return
        const message = JSON.parse(event.data)
        if (message.type === 'ready' && state !== 'finishing' && !listening) {
          listening = true; clearTimeout(deadline); phase('recording')
          stopMeter = detectSilence(stream, (level, countdown) => onState('recording', {level, countdown}), stop)
        }
        if (message.type === 'transcript') onText(message.text)
        if (message.type === 'completed') {onText(message.text); cancel(); onComplete()}
        if (message.type === 'error') fail(message.message)
      }
      connection.onconnectionstatechange = () => {
        if (current === generation && ['failed', 'disconnected'].includes(connection.connectionState)) fail('语音连接中断，草稿保留，仍可键盘输入')
      }
      await connection.setLocalDescription(await connection.createOffer())
      if (current !== generation) return
      if (connection.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {connection.removeEventListener('icegatheringstatechange', changed); reject(new Error('语音连接超时'))}, 10000)
        function changed() {if (connection.iceGatheringState === 'complete') {clearTimeout(timeout); connection.removeEventListener('icegatheringstatechange', changed); resolve()}}
        connection.addEventListener('icegatheringstatechange', changed)
      })
      if (current !== generation) return
      const answerResponse = await fetch('/speech/offer', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sdp: connection.localDescription.sdp, type: connection.localDescription.type})})
      const answer = await answerResponse.json()
      if (current !== generation) return
      if (!answerResponse.ok) throw new Error(answer.error || '语音连接失败')
      await connection.setRemoteDescription(answer)
    } catch (error) {if (current === generation) fail(error.message)}
  }
  return {start, stop, cancel}
}
