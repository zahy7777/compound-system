import {appearanceSettings} from './settings.js'
import {bindFeedback} from './feedback.js'
import {createPaper} from './paper/index.js'

const storageKey = 'compound:appearance'
const defaults = {theme:'default',motion:true,sound:false,volume:35}
function validated(value) {
  return {theme:value?.theme === 'persona' ? 'persona' : 'default',motion:typeof value?.motion === 'boolean' ? value.motion : true,sound:typeof value?.sound === 'boolean' ? value.sound : false,volume:Number.isFinite(value?.volume) ? Math.max(0,Math.min(100,value.volume)) : 35}
}

/** 主题只拥有本机外观事实；装饰插槽使用不透明视觉身份。 */
export function createTheme() {
  let preferences = {...defaults}, error = '', panel
  try {preferences = validated(JSON.parse(localStorage.getItem(storageKey)))} catch {error = '本机外观偏好无法读取，本次使用默认主题。'}
  const paper = createPaper(document.body)
  const read = () => ({...preferences,error})
  function apply() {
    document.documentElement.dataset.theme = preferences.theme
    document.querySelector('meta[name=theme-color]').content = preferences.theme === 'persona' ? '#de1529' : '#432065'
    paper.enable(preferences.theme === 'persona')
    panel?.sync()
  }
  function update(value) {
    preferences = validated({...preferences,...value}); error = ''
    try {localStorage.setItem(storageKey,JSON.stringify(preferences))} catch {error = '本机外观偏好无法保存；当前页面仍可使用，重新打开后不会保留。'}
    apply()
  }
  const entry = document.createElement('button'); entry.type = 'button'; entry.className = 'theme-entry'; entry.textContent = '外观'; entry.setAttribute('aria-label','外观设置')
  entry.onclick = () => {
    if (panel?.dialog.open) {panel.dialog.focus(); return}
    panel = appearanceSettings(read,update)
  }
  document.body.append(entry)
  const releaseFeedback = bindFeedback(read)
  function storage(event) {
    if (event.key !== storageKey && event.key !== null) return
    try {preferences = validated(JSON.parse(event.newValue)); error = ''; apply()} catch {error = '其他窗口的外观偏好无法读取。'; panel?.sync()}
  }
  window.addEventListener('storage',storage)
  apply()
  return {read, update, dispose() {paper.dispose(); releaseFeedback(); window.removeEventListener('storage',storage); panel?.dialog.close(); entry.remove()}}
}
