import {el, iconButton} from '../component/button.js'

export function shortcutPage(mode, structure, {areaPanel, resultTimers, settings}) {
  const panel = el('section', undefined, 'shortcut-page'), header = el('div', undefined, 'section-heading')
  header.append(el('h2', mode === 'running' ? '运行.' : '待办.'))
  if (settings) header.append(iconButton({icon: 'settings', label: '快捷键设置', onClick: settings}))
  panel.append(header)
  if (mode === 'running') panel.append(resultTimers())
  panel.append(areaPanel(structure.areas.find(area => area.name === (mode === 'running' ? '运行' : '待办'))))
  return panel
}
