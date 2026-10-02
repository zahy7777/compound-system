/** 只反馈用户激活，不解释按钮业务含义，不拦截默认行为。 */
export function bindFeedback(read) {
  let audio
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  function click(event) {
    const target = event.target.closest?.('button,[role=button],summary')
    if (!event.isTrusted || !target || target.matches(':disabled') || target.closest('.theme-settings')) return
    const preferences = read()
    if (preferences.theme !== 'persona') return
    if (preferences.motion && !reduced.matches) {
      const box = target.getBoundingClientRect(), impact = document.createElement('div')
      impact.className = 'theme-impact'; impact.setAttribute('aria-hidden', 'true')
      const dialog = target.closest('dialog'), origin = dialog?.getBoundingClientRect()
      if (dialog) impact.style.position = 'absolute'
      impact.style.left = `${(event.detail ? event.clientX : box.x + box.width / 2) - (origin?.x ?? 0) + (dialog?.scrollLeft ?? 0) - (dialog?.clientLeft ?? 0) - 22}px`
      impact.style.top = `${(event.detail ? event.clientY : box.y + box.height / 2) - (origin?.y ?? 0) + (dialog?.scrollTop ?? 0) - (dialog?.clientTop ?? 0) - 22}px`
      const host = dialog || document.body
      host.append(impact)
      const animation = impact.animate([{transform:'scale(.35) rotate(-18deg)',opacity:1},{transform:'scale(1.4) rotate(12deg)',opacity:0}],{duration:230,easing:'cubic-bezier(.2,.8,.2,1)'})
      void animation.finished.catch(() => {}).finally(() => impact.remove())
    }
    if (preferences.sound && preferences.volume > 0) {
      try {
        audio ??= new AudioContext()
        void audio.resume().catch(() => {})
        const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime
        oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(760, now); oscillator.frequency.exponentialRampToValueAtTime(180, now + .055)
        gain.gain.setValueAtTime(.0001,now); gain.gain.exponentialRampToValueAtTime(preferences.volume / 100 * .12, now + .004); gain.gain.exponentialRampToValueAtTime(.0001,now + .075)
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + .08)
        oscillator.onended = () => {oscillator.disconnect(); gain.disconnect()}
      } catch (error) {console.error('点击音效不可用', error)}
    }
  }
  document.addEventListener('click', click, true)
  return () => {document.removeEventListener('click',click,true); if (audio) void audio.close()}
}
