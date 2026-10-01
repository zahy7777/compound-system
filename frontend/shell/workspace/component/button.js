import {icon} from './icons.js'

export const el = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
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
