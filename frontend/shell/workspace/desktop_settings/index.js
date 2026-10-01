import {el} from '../component/button.js'

export async function shortcutSettings(modal, desktop) {
  const {dialog, form, show} = modal('快捷键设置'), error = form.querySelector('.dialog-error')
  show()
  try {
    const config = await desktop.readSettings(), draft = {...config.shortcuts}
    form.append(el('p', `当前环境：${config.environment}。点击后按下组合键。`, 'context'))
    for (const [name, title] of [['running','运行界面'],['todo','待办界面']]) {
      const row = el('label', title, 'shortcut-setting'), button = el('button', draft[name]); button.type = 'button'
      button.onclick = () => {button.textContent = '请按快捷键…'; button.dataset.recording = 'true'; button.focus()}
      button.onkeydown = event => {
        if (!button.dataset.recording || event.isComposing) return
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Escape') {delete button.dataset.recording; button.textContent = draft[name]; return}
        if (['Control','Shift','Alt','Meta'].includes(event.key)) return
        const key = event.code === 'Space' ? 'Space' : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key
        draft[name] = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+')
        button.textContent = draft[name]; delete button.dataset.recording
      }
      row.append(button); form.append(row)
    }
    const save = el('button', '保存快捷键', 'primary'); save.type = 'submit'; form.append(save)
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true
      try {await desktop.saveSettings(draft); dialog.close()} catch (failure) {error.textContent = failure.message} finally {save.disabled = false}
    }
  } catch (failure) {error.textContent = failure.message}
}
