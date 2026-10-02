import {icon} from './icons.js'

const paperSlots = new Set(['event-body','event-tools','branch-time','actions','count','empty','result-summary','timer-display','result-timer-label','review-total','review-row','context','voice-status','card-question','measured-time','loop-name','icon-button','slice-warning'])
export const el = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  const slot = className?.split(' ').find(name => paperSlots.has(name)) ?? (['h1','h2','h3'].includes(tag) ? tag : null)
  if (slot) {node.dataset.paper = slot; if (text !== undefined) node.dataset.paperKey = String(text)}
  return node
}

export function iconButton({icon: symbol, label, text = '', onClick}) {
  const button = el('button', undefined, 'icon-button')
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label)
  if (symbol) button.append(icon(symbol))
  if (text) button.append(el('span', text))
  if (onClick) button.onclick = onClick
  return button
}

export function controls(...buttons) {
  const row = el('div', undefined, 'actions'); row.append(...buttons); return row
}
