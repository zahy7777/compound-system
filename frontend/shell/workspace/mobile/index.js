import {el, iconButton} from '../component/button.js'

const sections = ['结果','运行','待办','归档']

function navigateBySwipe(page, selected, select) {
  let start
  page.addEventListener('pointerdown', event => {
    const target = event.target
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0 ||
        !(target instanceof Element) || target.closest('.mobile-nav,button,a,input,select,textarea,[role="button"],[contenteditable="true"]')) {
      start = null
      return
    }
    start = {x: event.clientX, y: event.clientY, pointerId: event.pointerId}
  })
  page.addEventListener('pointerup', event => {
    const origin = start
    start = null
    if (!origin || event.pointerId !== origin.pointerId) return
    const dx = event.clientX - origin.x, dy = event.clientY - origin.y
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.25) return
    const next = sections[sections.indexOf(selected) + (dx < 0 ? 1 : -1)]
    if (next) select(next)
  })
  page.addEventListener('pointercancel', () => { start = null })
}

/** 只选择布局与组件；成员挂载和修改留给现有投影与命令。 */
export function mobilePage({selected, select, logout, result, timers, area}) {
  const page = el('section', undefined, 'mobile-page'), header = el('header', undefined, 'mobile-heading'), nav = el('nav', undefined, 'mobile-nav')
  navigateBySwipe(page, selected, select)
  header.append(el('strong', 'Compound'))
  if (logout) header.append(iconButton({icon:'return',label:'退出登录',onClick:logout}))
  nav.setAttribute('aria-label','手机分区')
  for (const name of sections) {
    const button = el('button', name); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === name)); button.onclick = () => select(name); nav.append(button)
  }
  page.append(header,nav)
  if (selected === '结果') page.append(result())
  else {if (selected === '运行') page.append(timers()); page.append(area())}
  return page
}
