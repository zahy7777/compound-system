import {el, iconButton} from '../component/button.js'

/** 只选择布局与组件；成员挂载和修改留给现有投影与命令。 */
export function mobilePage({selected, select, logout, result, timers, area}) {
  const page = el('section', undefined, 'mobile-page'), header = el('header', undefined, 'mobile-heading'), nav = el('nav', undefined, 'mobile-nav')
  const brand = el('strong', 'Compound'); brand.dataset.paper = 'brand'
  header.append(brand)
  if (logout) header.append(iconButton({icon:'return',label:'退出登录',onClick:logout}))
  nav.setAttribute('aria-label','手机分区')
  for (const name of ['结果','运行','待办','归档']) {
    const button = el('button', name); button.type = 'button'; button.setAttribute('aria-pressed', String(selected === name)); button.onclick = () => select(name); nav.append(button)
  }
  page.append(header,nav)
  if (selected === '结果') page.append(result())
  else {if (selected === '运行') page.append(timers()); page.append(area())}
  return page
}
