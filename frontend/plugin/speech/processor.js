/** 按真实输入采样率积分降采样，跨帧保留相位，输出 16kHz 小端 PCM。 */
class SpeechPCM extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.remaining = this.ratio
    this.sum = 0
    this.active = false
    this.buffer = new ArrayBuffer(2560)
    this.view = new DataView(this.buffer)
    this.offset = 0
    this.port.onmessage = ({data}) => {
      if (data === 'record') this.active = true
      if (data === 'flush') {
        this.active = false
        if (this.remaining < this.ratio) this.append(this.sum / (this.ratio - this.remaining))
        this.emit(); this.port.postMessage('flushed')
      }
    }
  }
  append(value) {
    value = Math.max(-1, Math.min(1, value))
    this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true)
    this.offset += 2
    if (this.offset === this.buffer.byteLength) this.emit()
  }
  emit() {
    if (!this.offset) return
    const chunk = this.buffer.slice(0, this.offset)
    this.port.postMessage(chunk, [chunk]); this.offset = 0
  }
  process(inputs) {
    if (!this.active) return true
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0
      for (const channel of channels) value += channel[i] / channels.length
      let weight = 1
      while (weight > 1e-9) {
        const take = Math.min(weight, this.remaining)
        this.sum += value * take; this.remaining -= take; weight -= take
        if (this.remaining < 1e-9) {
          this.append(this.sum / this.ratio); this.sum = 0; this.remaining = this.ratio
        }
      }
    }
    return true
  }
}
registerProcessor('speech-pcm', SpeechPCM)
