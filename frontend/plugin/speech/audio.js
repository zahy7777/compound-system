/** 麦克风与处理器共享一个上下文；PCM 尾包发送完才结束收音。 */
export function createAudio(onChunk, onError) {
  if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) throw new Error('当前浏览器不支持实时录音，请使用键盘输入')
  const context = new AudioContext()
  const resumed = context.resume()
  void resumed.catch(() => {})
  let media, source, node, cancelled = false, flush
  function cancel() {
    cancelled = true; media?.getTracks().forEach(track => track.stop()); media = null
    node?.disconnect(); source?.disconnect()
    if (context.state !== 'closed') void context.close().catch(() => {})
    flush?.reject(new Error('收音已取消')); flush = null
  }
  async function start() {
    await resumed
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false})
    if (cancelled) {stream.getTracks().forEach(track => track.stop()); return}
    media = stream
    await context.audioWorklet.addModule(new URL('speech/processor.js', import.meta.url))
    if (cancelled) return
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'speech-pcm')
    node.port.onmessage = ({data}) => {
      if (cancelled) return
      if (data instanceof ArrayBuffer) onChunk(data)
      else if (data === 'flushed') {flush?.resolve(); flush = null}
    }
    node.onprocessorerror = () => onError('麦克风音频处理失败，草稿保留')
    // 处理器输出静音；连接 destination 让浏览器持续运行处理器。
    source.connect(node); node.connect(context.destination)
  }
  function record() {node.port.postMessage('record')}
  async function finish() {
    media?.getTracks().forEach(track => track.stop()); media = null
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {flush = null; reject(new Error('音频结束未确认，草稿保留'))}, 2000)
      flush = {resolve: () => {clearTimeout(timeout); resolve()}, reject: error => {clearTimeout(timeout); reject(error)}}
      node.port.postMessage('flush')
    })
    node.disconnect(); source.disconnect(); await context.close()
  }
  return {context, get source() {return source}, start, record, finish, cancel}
}
