import {createEvents} from './kernel/event/index.js'
import {createForest} from './kernel/tags_forest/index.js'
import {createTemplates} from './kernel/loop_template/index.js'
import {createSpeech} from './plugin/speech/index.js'
import {createTimer} from './timer/index.js'
import {createProjection} from './shell/projection/index.js'
import {createCommands} from './shell/commands/index.js'
import {createWorkspace} from './shell/workspace/index.js'
import {bindInput} from './shell/input/index.js'
import {createAccess} from './access/index.js'

const access = createAccess()
await access.enter(document.querySelector('#workspace'))

async function call(path, value) {
  const response = await access.request(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)})
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result
}
const keyOf = id => String(id)
const events = createEvents(call, JSON.parse(document.querySelector('#protocol').textContent))
const forest = createForest(call), templates = createTemplates(call), timer = createTimer(call)
const projection = createProjection(forest, events), commands = createCommands(events, forest, templates, timer, keyOf)
const requested = new URLSearchParams(location.search).get('presentation')
const presentation = ['running','todo','mobile'].includes(requested) ? requested : 'full'
const speech = callbacks => createSpeech({...callbacks, request: access.request})
const root = document.querySelector('#workspace'), workspace = createWorkspace(root, timer, keyOf, events, speech, {presentation, desktop: window.compoundDesktop ?? null, logout: access.public ? () => access.logout().catch(error => workspace.status(error.message,true)) : null})
async function refresh() {const structure = await projection.read(workspace.dateRanges()); await timer.read(structure.events.map(event => keyOf(event.system.source_id))); workspace.render(structure)}
bindInput(root, commands, workspace, refresh, events, templates)
setInterval(workspace.tick, 250)
try {await refresh(); workspace.status('已读取')} catch (error) {workspace.status(error.message, true)}
function resume() {if (!document.hidden && !document.querySelector('dialog[open]') && !root.classList.contains('saving')) refresh().catch(error => workspace.status(error.message, true))}
window.addEventListener('focus', resume)
document.addEventListener('visibilitychange', resume)
matchMedia('(max-width:650px)').addEventListener('change', () => {if (!document.querySelector('dialog[open]')) workspace.render()})
