const element = (tag, text, className) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

/** 只收集主题偏好，不调用业务命令或保存业务草稿。 */
export function appearanceSettings(read, update) {
  const dialog = element('dialog', undefined, 'theme-settings'), form = element('form')
  dialog.setAttribute('aria-label', '外观设置')
  const heading = element('div', undefined, 'dialog-heading'), close = element('button', '×')
  close.type = 'button'; close.setAttribute('aria-label', '关闭外观设置'); close.onclick = () => dialog.close()
  heading.append(element('h2', '外观设置'), close)
  const theme = element('select'); theme.setAttribute('aria-label', '主题')
  theme.append(new Option('默认主题', 'default'), new Option('异闻录 · 高卷杏', 'persona'))
  const motion = element('input'); motion.type = 'checkbox'; motion.setAttribute('aria-label', '点击动效')
  const sound = element('input'); sound.type = 'checkbox'; sound.setAttribute('aria-label', '点击音效')
  const volume = element('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.setAttribute('aria-label', '音量')
  const note = element('p', '', 'theme-note'); note.setAttribute('role', 'status')
  const error = element('p', '', 'dialog-error'); error.setAttribute('role', 'alert')
  function sync() {
    const preferences = read()
    theme.value = preferences.theme; motion.checked = preferences.motion; sound.checked = preferences.sound; volume.value = String(preferences.volume)
    note.textContent = preferences.error || '切换立即生效，仅保存本机外观偏好。系统减少动态效果设置优先。'
  }
  function change(value) {update(value); sync()}
  for (const [label, control] of [['主题', theme], ['点击动效', motion], ['点击音效', sound], ['音量', volume]]) {
    const row = element('label', undefined, 'theme-setting'); row.append(element('span', label), control); form.append(row)
  }
  theme.onchange = () => change({theme:theme.value})
  motion.onchange = () => change({motion:motion.checked})
  sound.onchange = () => change({sound:sound.checked})
  volume.oninput = () => change({volume:Number(volume.value)})
  form.prepend(heading, error); form.append(note); form.onsubmit = event => event.preventDefault(); dialog.append(form)
  dialog.addEventListener('close', () => dialog.remove(), {once:true})
  sync(); document.body.append(dialog); dialog.showModal(); close.focus()
  return {dialog, sync}
}
