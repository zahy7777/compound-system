import {createEvents} from './kernel/event/index.js'
import {createForest} from './kernel/tags_forest/index.js'
import {createTemplates} from './kernel/loop_template/index.js'
import {createSlices} from './kernel/slice/index.js'
import {createSpeech} from './plugin/speech/index.js'
import {createTimer} from './timer/index.js'
import {createProjection} from './shell/projection/index.js'
import {createCommands} from './shell/commands/index.js'
import {createWorkspace} from './shell/workspace/index.js'
import {bindInput} from './shell/input/index.js'
import {createAccess} from './access/index.js'
import {createWatchSnapshot, postWatchSnapshot} from './shell/watch_snapshot/index.js'
import {createTheme} from './theme/index.js'

createTheme()
const access = createAccess()
await access.enter(document.querySelector('#workspace'))
access.provisionWatch().catch(() => {})

async function call(path, value) {
  const response = await access.request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)})
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result
}
const keyOf = id => String(id)
const events = createEvents(call, JSON.parse(document.querySelector('#protocol').textContent))
const forest = createForest(call), templates = createTemplates(call), timer = createTimer(call)
const slices = createSlices(call)
const projection = createProjection(forest, events, slices), commands = createCommands(events, forest, templates, timer, keyOf, slices)
const requested = new URLSearchParams(location.search).get('presentation')
const presentation = ['running','todo','mobile'].includes(requested) ? requested : 'full'
const speech = callbacks => createSpeech({...callbacks, request: access.request, openSocket: access.openSocket})
const root = document.querySelector('#workspace'), workspace = createWorkspace(root, timer, keyOf, events, speech, {presentation, desktop: window.compoundDesktop ?? null, logout: access.public ? () => access.logout().catch(error => workspace.status(error.message,true)) : null})
let structure, reading = Promise.resolve(), backgroundPending = false, pendingRender = false
function publishWatch() {if (structure) postWatchSnapshot(createWatchSnapshot(structure, timer, keyOf))}
async function load(background) {
  if (background && root.classList.contains('saving')) return
  const next = await projection.read(workspace.dateRanges())
  const keys = next.events.map(event => keyOf(event.system.source_id))
  const previous = keys.map(key => timer.snapshot(key))
  const structureChanged = JSON.stringify(next) !== JSON.stringify(structure)
  await timer.read(keys)
  if (background && root.classList.contains('saving')) return
  const timerChanged = keys.some((key, index) => {
    const before = previous[index], after = timer.snapshot(key)
    return before?.state !== after?.state || (after?.state === 'paused' && before?.elapsed_ms !== after.elapsed_ms)
  })
  structure = next
  const changed = structureChanged || timerChanged
  const editing = document.querySelector('dialog[open]') || document.activeElement?.matches('input,textarea') || root.querySelector('.drop-inside,.drop-before,.drop-after')
  if (!background || ((changed || pendingRender) && !editing)) {workspace.render(structure); pendingRender = false}
  else if (changed) pendingRender = true
  if (!background || changed) publishWatch()
}
function refresh() {const next = reading.catch(() => {}).then(() => load(false)); reading = next; return next}
function poll() {
  if (backgroundPending || root.classList.contains('saving')) return
  backgroundPending = true
  const next = reading.catch(() => {}).then(() => load(true))
  reading = next
  void next.catch(error => workspace.status(error.message, true)).finally(() => {backgroundPending = false})
}
const watchActions = {
  run: id => commands.run(id),
  resume: id => commands.writeTimer(id, 'running'),
  pause: id => commands.writeTimer(id, 'paused'),
  archive: id => commands.archive(id),
}
window.compoundWatch = {perform: async (action, rawID) => {
  const id = Number(rawID), execute = watchActions[action]
  if (!execute || !Number.isSafeInteger(id)) throw new Error('不支持的手表操作')
  await execute(id)
  await refresh()
  return createWatchSnapshot(structure, timer, keyOf)
}}
bindInput(root, commands, workspace, refresh, events, templates)
setInterval(workspace.tick, 250)
setInterval(() => {publishWatch(); poll()}, 1000)
try {await refresh(); workspace.status('已读取')} catch (error) {workspace.status(error.message, true)}
function resume() {if (!document.hidden && !document.querySelector('dialog[open]') && !root.classList.contains('saving')) refresh().catch(error => workspace.status(error.message, true))}
window.addEventListener('focus', resume)
document.addEventListener('visibilitychange', resume)
matchMedia('(max-width:650px)').addEventListener('change', () => {if (!document.querySelector('dialog[open]')) workspace.render()})
