import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const source = readFileSync(new URL('../frontend/plugin/speech/processor.js', import.meta.url), 'utf8')
for (const rate of [16000, 44100, 48000]) {
  test(`${rate}Hz 跨帧转换：时长、单声道、小端幅度、尾包顺序`, () => {
    const messages = []
    let Processor
    runInNewContext(source, {
      sampleRate: rate,
      AudioWorkletProcessor: class {port = {postMessage: data => messages.push(data)}},
      registerProcessor(name, value) {Processor = value},
    })
    const processor = new Processor()
    const duration = .123
    const count = Math.floor(rate * duration)
    processor.port.onmessage({data: 'record'})
    for (let i = 0; i < count; i += 128) {
      const size = Math.min(128, count - i)
      processor.process([[new Float32Array(size).fill(.75), new Float32Array(size).fill(.25)]])
    }
    processor.port.onmessage({data: 'flush'})
    assert.equal(messages.at(-1), 'flushed')
    const chunks = messages.slice(0, -1)
    assert.equal(chunks.reduce((n, chunk) => n + chunk.byteLength, 0), Math.ceil(count * 16000 / rate) * 2)
    for (const chunk of chunks) {
      assert.ok(chunk.byteLength <= 2560)
      const view = new DataView(chunk)
      for (let i = 0; i < chunk.byteLength; i += 2) assert.ok(Math.abs(view.getInt16(i, true) - 16384) <= 1)
    }
  })
}
