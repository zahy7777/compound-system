import {el, controls} from './button.js'

export function eventRow({body, stats = '', clock, running = false, paused = false, buttons = {}}) {
  const row = el('article', undefined, `event${running ? ` running${paused ? ' paused' : ''}` : ''}`)
  const content = el('div', undefined, 'event-content')
  content.append(typeof body === 'string' ? el('div', body, 'event-body') : body)
  const tools = el('div', undefined, 'event-tools'), details = el('small', stats, 'event-stats')
  if (clock) tools.append(clock)
  details.hidden = !stats; tools.append(details)
  const actions = controls()
  for (const name of ['play', 'archive', 'todo', 'run', 'edit', 'delete']) {
    if (buttons[name]) {buttons[name].dataset.slot = name; actions.append(buttons[name])}
  }
  tools.append(actions); row.append(content, tools)
  return row
}
