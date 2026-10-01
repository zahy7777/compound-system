import {el} from '../button.js'
import {textCard, durationCard, scoreCard} from './cards.js'

export function capture({dialog, form, show}, initial, {steps, editing = false, context = '', measured = '', createSpeech}, submit) {
  const draft = {...initial, keyboard: initial.text, speech: ''}, factories = {text: textCard, duration: durationCard, score: scoreCard}, cards = {}, progress = el('div', undefined, 'capture-steps')
  let index = 0, advancing = false, voiceState = 'idle', speech
  function confirm() {
    if (advancing || voiceState === 'finishing') return
    if (voiceState === 'recording' || voiceState === 'connecting') speech.stop()
    else void next()
  }
  async function next() {
    if (advancing || !dialog.open) return
    advancing = true
    try {
      if (index < steps.length - 1) {index++; render(); return}
      if (await submit({...draft})) dialog.close()
    } finally {advancing = false}
  }
  for (const name of Object.keys(factories)) cards[name] = factories[name](draft, name === 'text' ? confirm : next, editing)
  const text = cards.text.querySelector('textarea'), recognized = cards.text.querySelector('.recognized-text'), status = cards.text.querySelector('.voice-status')
  if (createSpeech && steps.includes('text')) {
    speech = createSpeech({
      onText(value) {draft.speech = value; draft.text = value + draft.keyboard; recognized.textContent = value; recognized.hidden = !value},
      onState(state, {level = 0, countdown = 0, unconfigured = false} = {}) {
        voiceState = state; cards.text.querySelector('.voice-orb').style.setProperty('--voice-scale', 1 + level * .2)
        status.textContent = unconfigured ? '语音未配置，直接键盘输入。' : countdown ? `说完了？${countdown} 秒后确认` : {idle: '可以键盘补充，Enter 确认。', connecting: '正在连接麦克风…', recording: '正在听，也可以键盘补充；Enter 确认。', finishing: '正在确认最后的文字…'}[state]
      },
      onComplete() {void next()},
      onError(message) {status.textContent = message; status.setAttribute('role', 'alert')},
    })
    dialog.addEventListener('close', () => speech.cancel(), {once: true})
  }
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {event.preventDefault(); confirm()}
  })
  form.append(el('p', context, 'context'), progress, ...(measured ? [el('p', measured, 'measured-time')] : []), ...Object.values(cards))
  function render() {
    progress.replaceChildren(...steps.map((name, step) => el('span', `${step + 1} ${{text:'正文',duration:'耗时',score:'评分'}[name]}`, step === index ? 'current' : '')))
    for (const [name, card] of Object.entries(cards)) card.hidden = name !== steps[index]
    cards[steps[index]].querySelector('textarea,button')?.focus()
  }
  dialog.classList.add('capture'); form.onsubmit = event => {event.preventDefault()}; show(); render(); if (speech && !editing) void speech.start()
}
