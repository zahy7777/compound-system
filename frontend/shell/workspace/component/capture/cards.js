import {el} from '../button.js'
import {icon} from '../icons.js'

export function textCard(draft, next, editing) {
  const card = el('section', undefined, 'capture-card text-card'), orb = el('div', undefined, 'voice-orb')
  orb.append(icon('mic', 40)); orb.setAttribute('aria-hidden', 'true')
  const text = el('textarea'); text.setAttribute('aria-label', '小事正文'); text.rows = 5; text.value = draft.text; text.placeholder = '写下这次做了什么，或接下来准备做什么。'; text.oninput = () => {draft.text = text.value}
  const details = el('details'), attributes = el('textarea'); attributes.setAttribute('aria-label', '属性标签'); attributes.rows = 3; attributes.value = draft.attributes; attributes.oninput = () => {draft.attributes = attributes.value}
  details.append(el('summary', '属性'), attributes, el('small', '每行一个已登记属性：日期、评分、耗时、备注。'))
  const save = el('button', editing ? '保存修改' : '保存', 'primary'); save.type = 'button'; save.onclick = next
  card.append(orb, el('p', '直接输入文字，留下这件事。', 'voice-status'), text, details, save)
  return card
}

export function durationCard(draft, next) {
  const card = el('section', undefined, 'capture-card duration-card'), options = el('div', undefined, 'duration-options'), custom = el('div', undefined, 'duration-custom')
  card.append(el('p', '这次投入了多久？', 'card-question'))
  for (const minutes of [1,3,5,10,15,20,30]) {
    const button = el('button'); button.type = 'button'; button.setAttribute('aria-label', `${minutes} 分钟`); button.append(el('strong', String(minutes)), el('span', '分钟')); button.onclick = () => {draft.seconds = minutes * 60; void next()}; options.append(button)
  }
  const customButton = el('button', '自定义'); customButton.type = 'button'; customButton.onclick = () => {options.hidden = true; custom.hidden = false; input.focus()}; options.append(customButton)
  const input = el('input'); input.type = 'number'; input.min = '0'; input.step = '0.000001'; input.value = String(draft.seconds / 60); input.setAttribute('aria-label', '自定义耗时（分钟）')
  const ruler = el('input'); ruler.type = 'range'; ruler.min = '0'; ruler.max = '180'; ruler.step = '1'; ruler.value = String(draft.seconds / 60); ruler.setAttribute('aria-label', '时长尺')
  input.oninput = () => {ruler.value = input.value}; ruler.oninput = () => {input.value = ruler.value}
  const confirm = el('button', '确认耗时', 'primary'); confirm.type = 'button'; confirm.onclick = () => {if (!input.reportValidity()) return; draft.seconds = Number((Number(input.value) * 60).toFixed(6)); void next()}
  custom.append(el('p', '自定义投入（分钟）', 'card-question'), ruler, input, confirm); custom.hidden = true
  const none = el('button', '不记录耗时', 'text-button'); none.type = 'button'; none.onclick = () => {draft.seconds = 0; void next()}
  card.append(options, custom, none); return card
}

export function scoreCard(draft, next) {
  const card = el('section', undefined, 'capture-card score-card'), options = el('div', undefined, 'score-options'), captions = ['很吃力','不太顺','一般','挺好','很满意']
  card.append(el('p', '这次投入感觉如何？', 'card-question'))
  for (let score = 1; score <= 5; score++) {
    const button = el('button'); button.type = 'button'; button.setAttribute('aria-label', `${score} · ${captions[score - 1]}`); button.append(el('strong', String(score)), el('span', captions[score - 1])); button.onclick = () => {draft.score = String(score); void next()}; options.append(button)
  }
  const none = el('button', '不评分，完成', 'text-button'); none.type = 'button'; none.onclick = () => {draft.score = null; void next()}
  card.append(options, none); return card
}
