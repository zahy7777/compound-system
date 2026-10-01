import {el} from '../button.js'
import {textCard, durationCard, scoreCard} from './cards.js'

export function capture({dialog, form, show}, initial, {steps, editing = false, context = '', measured = ''}, submit) {
  const draft = {...initial}, factories = {text: textCard, duration: durationCard, score: scoreCard}, cards = {}, progress = el('div', undefined, 'capture-steps')
  let index = 0
  async function next() {
    if (index < steps.length - 1) {index++; render(); return}
    if (await submit({...draft})) dialog.close()
  }
  for (const name of Object.keys(factories)) cards[name] = factories[name](draft, next, editing)
  form.append(el('p', context, 'context'), progress, ...(measured ? [el('p', measured, 'measured-time')] : []), ...Object.values(cards))
  function render() {
    progress.replaceChildren(...steps.map((name, step) => el('span', `${step + 1} ${{text:'正文',duration:'耗时',score:'评分'}[name]}`, step === index ? 'current' : '')))
    for (const [name, card] of Object.entries(cards)) card.hidden = name !== steps[index]
    cards[steps[index]].querySelector('textarea,button')?.focus()
  }
  dialog.classList.add('capture'); form.onsubmit = event => {event.preventDefault()}; show(); render()
}
