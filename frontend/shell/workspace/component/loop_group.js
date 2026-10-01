import {el, controls} from './button.js'

export function loopGroup({label, count, buttons = [], collapsed = false, onToggle}) {
  const section = el('section', undefined, 'loop'), head = el('div', undefined, 'group-head')
  const tab = el('div', undefined, 'loop-tab'), content = el('div', undefined, 'branch-content')
  head.setAttribute('role', 'button'); head.tabIndex = 0; head.setAttribute('aria-label', '折叠闭环')
  label.classList.add('loop-name'); count.classList.add('count')
  tab.append(label, count, controls(...buttons)); head.append(tab); section.append(head, content)
  function setCollapsed(value) {
    section.classList.toggle('collapsed', value); content.hidden = value
    head.setAttribute('aria-expanded', !value)
    head.setAttribute('aria-label', value ? '展开闭环' : '折叠闭环')
  }
  function toggle(event) {
    if (event.target.closest('button,input')) return
    if (event.type === 'keydown') {if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault()}
    onToggle()
  }
  head.onclick = toggle; head.onkeydown = toggle; setCollapsed(collapsed)
  return {section, head, content, setCollapsed}
}
