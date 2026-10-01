/** 只检测音量和停顿；不判断录入是否应该保存。 */
export function detectSilence(stream, onLevel, onSilence) {
  const context = new AudioContext(), analyser = context.createAnalyser()
  analyser.fftSize = 1024; context.createMediaStreamSource(stream).connect(analyser); void context.resume()
  const samples = new Float32Array(analyser.fftSize)
  let frame, speakingSince = 0, heard = false, lastVoice = performance.now(), noise = .003
  function tick() {
    analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length), now = performance.now()
    if (rms > Math.max(.012, noise * 3)) {
      if (!speakingSince) speakingSince = now
      if (now - speakingSince >= 200) heard = true
      lastVoice = now
    } else {
      speakingSince = 0
      if (!heard) noise = noise * .98 + Math.min(rms, .01) * .02
    }
    const silence = now - lastVoice
    onLevel(Math.min(1, rms * 12), heard && silence >= 1500 ? Math.max(0, Math.ceil((2500 - silence) / 1000)) : 0)
    if (heard && silence >= 2500) {onSilence(); return}
    frame = requestAnimationFrame(tick)
  }
  tick()
  return () => {cancelAnimationFrame(frame); void context.close()}
}
