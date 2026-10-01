const kinds = JSON.parse(document.querySelector('#protocol').textContent)
const areas = ['结果', '待办', '运行', '归档']
const loopRule = Object.values(kinds['闭环'].patterns)[0]
const loopPattern = new RegExp(loopRule.pattern.replaceAll('(?P<', '(?<'))
let events = [], busy = false, editing = null, drag = null
let forest = [], currentTemplate = null, templates = [], loopTemplates = [], nodeResults = new Map()
const node = (kind, text, children = []) => ({tag: {kind, text}, children})
const defaultForest = () => areas.map(area => node('业务区域', area))
const emptyLoops = new Map()
const timers = new Map()
const elapsedRule = new RegExp(kinds['属性'].patterns['耗时'].pattern.replaceAll('(?P<', '(?<'))
const workspace = document.querySelector('#workspace'), message = document.querySelector('#message')
const editor = document.querySelector('#editor'), tagRows = document.querySelector('#tags')

function el(tag, text, className) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
function button(text, action) {
  const node = el('button', text)
  node.type = 'button'
  node.disabled = busy
  node.onclick = action
  return node
}
const tagsOf = (event, kind) => event.meta.filter(tag => tag.kind === kind).map(tag => tag.text)
const areaOf = event => tagsOf(event, '业务区域')[0]
const loopOf = event => {
  const text = tagsOf(event, '闭环')[0]
  return text ? {text, ...loopPattern.exec(text).groups} : null
}
function loopText(id, name) { return loopRule.template.replace('{id}', id).replace('{name}', name) }
function version(event, meta = event.meta, deleted = false) {
  return {system: {source_id: event.system.source_id, deleted}, user: {...event.user}, meta: meta.map(tag => ({...tag}))}
}
function replaceKind(meta, kind, texts) {
  const next = [...meta.filter(tag => tag.kind !== kind), ...texts.map(text => ({kind, text}))]
  return next.filter((tag, index) => next.findIndex(other => other.kind === tag.kind && other.text === tag.text) === index)
}
function status(text, error = false) {
  message.textContent = text
  message.className = error ? 'error' : ''
  document.querySelector('#editor-error').textContent = error && editor.open ? text : ''
}
function disable(value) {
  busy = value
  document.querySelectorAll('button,input,select,textarea').forEach(node => {node.disabled = value})
  document.querySelectorAll('[draggable]').forEach(node => {node.draggable = !value})
}
async function request(path, value) {
  const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)})
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result
}
function paths(nodes = forest, prefix = []) {
  return nodes.flatMap(value => {
    const tags = [...prefix, value.tag]
    return [{value, tags}, ...paths(value.children, tags)]
  })
}
function itemForest(nodes) {
  return nodes.filter(value => value.tag.kind === '复利事项').map(value => ({tag: {...value.tag}, children: itemForest(value.children)}))
}
async function readEvents() {
  const entries = paths()
  const result = await request('/readevent', [[], ...entries.map(entry => entry.tags)])
  events = result[0]
  const keys = events.map(event => String(event.system.source_id))
  const snapshots = await request('/readtimer', keys)
  timers.clear()
  snapshots.forEach((value,index) => { if (value) timers.set(keys[index],{...value,receivedAt:performance.now()}) })
  nodeResults = new Map(entries.map((entry,index) => [entry.value, result[index+1]]))
}
async function readMemory() {
  const result = await request('/readforest', {workspace: true, item_templates: null})
  forest = result.workspace?.forest ?? defaultForest()
  currentTemplate = result.workspace?.item_template_id ?? null
  templates = result.item_templates
  loopTemplates = await request('/readlooptemplate', null)
}
async function load() {
  disable(true)
  try { await readMemory(); await readEvents(); render(); status('已读取') }
  catch (error) { status(error.message, true) }
  finally { disable(false) }
}
async function write(values, after = () => {}) {
  disable(true); status('正在保存')
  try {
    await request('/writeevent', values)
    after()
    await readEvents()
    render()
    status('已保存')
    return true
  } catch (error) { status(error.message, true); return false }
  finally { disable(false) }
}
async function saveForest(syncItems = false) {
  disable(true); status('正在保存')
  try {
    const body = {workspace: {item_template_id: currentTemplate, forest}}
    if (syncItems && currentTemplate !== null) {
      const template = templates.find(value => value.id === currentTemplate)
      body.item_templates = [{id: template.id, deleted: false, name: template.name,
        forest: itemForest(forest.find(value => value.tag.text === '结果').children)}]
    }
    await request('/writeforest', body)
    await readMemory(); await readEvents(); render(); status('已保存')
    return true
  } catch (error) { status(error.message, true); await readMemory(); await readEvents(); render(); return false }
  finally { disable(false) }
}
function removeNodes(test, nodes = forest) {
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (test(nodes[index])) nodes.splice(index,1)
    else removeNodes(test,nodes[index].children)
  }
}
function tagRow(tag = {kind: '属性', text: ''}) {
  const row = el('div', undefined, 'tag-row'), select = el('select'), input = el('input')
  select.setAttribute('aria-label', '标签种类')
  for (const kind of Object.keys(kinds)) select.append(new Option(kind, kind))
  select.value = tag.kind
  input.value = tag.text
  input.setAttribute('aria-label', '标签文本')
  row.append(select, input, button('移除', () => row.remove()))
  tagRows.append(row)
}
function openEvent(event = null, area = '待办', item = null, loop = null) {
  editing = event
  document.querySelector('#editor-error').textContent = ''
  document.querySelector('#editor-title').textContent = event ? '编辑小事' : '新建小事'
  document.querySelector('#event').value = event?.user.event || ''
  tagRows.replaceChildren()
  const meta = event ? event.meta : [{kind: '业务区域', text: area},
    ...(item ? (Array.isArray(item) ? item : [item]).map(text => ({kind: '复利事项', text})) : []), ...(loop ? [{kind: '闭环', text: loop.text}] : [])]
  meta.forEach(tagRow)
  editor.showModal()
}
document.querySelector('#event-form').onsubmit = async event => {
  event.preventDefault()
  const meta = [...tagRows.children].map(row => ({kind: row.querySelector('select').value, text: row.querySelector('input').value}))
  const value = {system: {source_id: editing?.system.source_id ?? null, deleted: false},
    user: {event: document.querySelector('#event').value}, meta}
  if (await write([value])) editor.close()
}
document.querySelector('#cancel').onclick = () => editor.close()
document.querySelector('#add-tag').onclick = () => tagRow()
document.querySelector('#refresh').onclick = load

function ask(title, value = null) {
  const dialog = document.querySelector('#action-dialog'), input = document.querySelector('#action-name')
  document.querySelector('#action-title').textContent = title
  document.querySelector('#action-label').hidden = value === null
  input.disabled = value === null
  input.value = value ?? ''
  dialog.returnValue = ''
  document.querySelector('#action-form').onsubmit = event => {
    event.preventDefault()
    if (value !== null && !input.value.trim()) return
    dialog.close('ok')
  }
  document.querySelector('#action-cancel').onclick = () => dialog.close()
  return new Promise(resolve => {
    dialog.onclose = () => resolve(dialog.returnValue === 'ok' ? (value === null ? true : input.value.trim()) : null)
    dialog.showModal()
    if (value !== null) input.focus()
  })
}
async function createItem(parent = null) {
  const name = await ask('复利事项名称', '')
  if (!name) return
  const children = parent?.children ?? forest.find(value => value.tag.text === '结果').children
  children.push(node('复利事项',name))
  await saveForest(true)
}
async function createLoop(area, item = null, parent = null) {
  const name = await ask('闭环名称', '')
  if (!name) return
  const id = crypto.randomUUID().replaceAll('-', '')
  const children = parent?.children ?? forest.find(value => value.tag.text === area).children
  children.push(node('闭环',loopText(id,name)))
  await saveForest()
}
function itemMembers(name) { return events.filter(event => tagsOf(event, '复利事项').includes(name)) }
function loopMembers(id) { return events.filter(event => loopOf(event)?.id === id) }
async function renameItem(name) {
  const next = await ask('新的复利事项名称', name)
  if (!next || next === name) return
  const values = itemMembers(name).map(event => version(event,
    replaceKind(event.meta, '复利事项', tagsOf(event, '复利事项').map(text => text === name ? next : text))))
  if (!await write(values)) return
  for (const entry of paths()) if (entry.value.tag.kind === '复利事项' && entry.value.tag.text === name) entry.value.tag.text = next
  await saveForest(true)
}
async function renameLoop(loop) {
  const name = await ask('新的闭环名称', loop.name)
  if (!name || name === loop.name) return
  const text = loopText(loop.id, name)
  if (!await write(loopMembers(loop.id).map(event => version(event, replaceKind(event.meta, '闭环', [text]))))) return
  for (const entry of paths()) if (entry.value.tag.kind === '闭环' && loopPattern.exec(entry.value.tag.text)?.groups.id === loop.id) entry.value.tag.text = text
  await saveForest()
}
async function deleteItem(name) {
  const members = itemMembers(name)
  if (!await ask(`删除复利事项「${name}」及其全部 ${members.length} 条小事？`)) return
  const deletedNames = new Set()
  for (const entry of paths()) if (entry.value.tag.kind === '复利事项' && entry.value.tag.text === name)
    for (const child of paths([entry.value])) if (child.value.tag.kind === '复利事项') deletedNames.add(child.value.tag.text)
  const selected = events.filter(event => tagsOf(event,'复利事项').some(text => deletedNames.has(text)))
  if (!await write(selected.map(event => version(event,event.meta,true)))) return
  removeNodes(value => value.tag.kind === '复利事项' && value.tag.text === name)
  await saveForest(true)
}
async function deleteLoop(loop) {
  const members = loopMembers(loop.id)
  if (!await ask(`删除闭环「${loop.name}」及其全部 ${members.length} 条小事？`)) return
  if (!await write(members.map(event => version(event,event.meta,true)))) return
  removeNodes(value => value.tag.kind === '闭环' && loopPattern.exec(value.tag.text)?.groups.id === loop.id)
  await saveForest()
}
function sourceRecords(source) {
  if (source.kind === 'event') return events.filter(event => event.system.source_id === source.id)
  if (source.kind === 'loop') return loopMembers(source.id).filter(event => areaOf(event) === source.area)
  return itemMembers(source.name).filter(event => areaOf(event) === source.area)
}
async function move(source, target) {
  const values = sourceRecords(source).map(event => {
    let meta = replaceKind(event.meta, '业务区域', [target.area])
    if (target.kind === 'loop') meta = replaceKind(meta, '闭环', [target.text])
    if (target.kind === 'none') meta = replaceKind(meta, '闭环', [])
    if (target.kind === 'item') meta = replaceKind(meta, '复利事项', target.items ?? [target.name])
    return version(event, meta)
  })
  if (source.kind === 'item' && target.kind === 'item') { await reparentItem(source.name,target.name); return }
  if (values.length) await write(values)
}
function draggable(node, source) {
  node.draggable = true
  node.ondragstart = event => {
    event.stopPropagation()
    drag = source
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', JSON.stringify(source))
  }
  node.ondragend = () => { drag = null; document.querySelectorAll('.drag-over').forEach(node => node.classList.remove('drag-over')) }
}
function drop(node, target) {
  node.ondragover = event => { if (!busy) {event.preventDefault(); event.stopPropagation(); node.classList.add('drag-over')} }
  node.ondragleave = event => { if (!node.contains(event.relatedTarget)) node.classList.remove('drag-over') }
  node.ondrop = event => {
    event.preventDefault(); event.stopPropagation(); node.classList.remove('drag-over')
    if (!busy && drag) { const source = drag; drag = null; void move(source, target) }
  }
}
function eventCard(event) {
  const card = el('article', undefined, 'event')
  card.dataset.source = event.system.source_id
  card.append(el('div', event.user.event || '（空正文）', 'event-body'))
  card.append(el('div', event.meta.filter(tag => tag.kind !== '业务区域').map(tag =>
    tag.kind === '闭环' ? `闭环：${loopOf(event).name}` : `${tag.kind}：${tag.text}`).join(' · '), 'badges'))
  const actions = el('div', undefined, 'actions')
  actions.append(button('编辑', () => openEvent(event)), button('删除', async () => {
    if (await ask('删除这条小事？')) await write([version(event, event.meta, true)])
  }))
  for (const area of areas.filter(area => area !== areaOf(event))) {
    actions.append(button(area === '归档' ? '归档' : `移入${area}`,
      () => move({kind: 'event', id: event.system.source_id}, {kind: 'area', area})))
  }
  card.append(actions, timerControls(event))
  draggable(card, {kind: 'event', id: event.system.source_id})
  return card
}
function formatElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds/1000)
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value => String(value).padStart(2,'0')).join(':')
}
function repaintTimers() {
  for (const display of document.querySelectorAll('.timer-display')) {
    const timer = timers.get(display.dataset.key)
    const elapsed = timer.elapsed_ms + (timer.state === 'running' ? performance.now()-timer.receivedAt : 0)
    display.textContent = formatElapsed(elapsed)
  }
}
function timerControls(event) {
  const key = String(event.system.source_id), timer = timers.get(key), row = el('div',undefined,'actions timer-controls')
  if (!timer || (timer.state === 'paused' && timer.elapsed_ms === 0)) {
    row.append(button('运行',() => changeTimer(key,'running')))
  } else {
    const display = el('span',undefined,'timer-display');display.dataset.key=key
    display.textContent = formatElapsed(timer.elapsed_ms)
    row.append(display,button(timer.state === 'running' ? '暂停' : '继续',() => changeTimer(key,timer.state === 'running' ? 'paused' : 'running')),
      button('结束',() => finishTimer(key)))
  }
  return row
}
async function changeTimer(key,state) {
  disable(true);status('正在保存')
  try {
    const result = await request('/writetimer',{key,state})
    timers.set(key,{...result,receivedAt:performance.now()})
    render();repaintTimers();status('已保存')
  } catch(error) {status(error.message,true)} finally {disable(false)}
}
async function finishTimer(key) {
  disable(true);status('正在保存')
  try {
    const timer = await request('/writetimer',{key,state:'paused'})
    timers.set(key,{...timer,receivedAt:performance.now()})
    const event = events.find(value => String(value.system.source_id) === key)
    const previous = event.meta.find(tag => tag.kind === '属性' && elapsedRule.test(tag.text))
    const previousSeconds = previous ? Number(elapsedRule.exec(previous.text).groups.value) : 0
    const seconds = (previousSeconds + timer.elapsed_ms/1000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
    const meta = event.meta.filter(tag => tag !== previous)
    meta.push({kind:'属性',text:`耗时:${seconds}s`})
    await request('/writeevent',[version(event,meta)])
    const reset = await request('/writetimer',{key,state:'reset'})
    timers.set(key,{...reset,receivedAt:performance.now()})
    await readEvents();render();status('已保存')
  } catch(error) {render();status(error.message,true)} finally {disable(false)}
}
setInterval(repaintTimers,250)
function loopGroup(loop, area, members, item) {
  const group = el('section', undefined, 'group loop')
  group.dataset.loop = loop.id
  const head = el('div', undefined, 'group-head')
  const same = allLoops().filter(other => other.name === loop.name)
  head.append(el('strong', loop.name + (same.length > 1 ? `（同名 ${same.findIndex(other => other.id === loop.id) + 1}）` : '')),
    button('+小事', () => openEvent(null, area, item, loop)),
    button('改名闭环', () => renameLoop(loop)), button('删除闭环', () => deleteLoop(loop)), button('保存为模板', () => saveLoopTemplate(loop)))
  draggable(head, {kind: 'loop', id: loop.id, area})
  group.append(head, ...members.map(eventCard))
  if (!members.length) group.append(el('p', '空闭环：已保存到森林', 'empty'))
  drop(group, {kind: 'loop', area, text: loop.text})
  return group
}
function allLoops() {
  const loops = new Map(emptyLoops)
  for (const event of events) {
    const loop = loopOf(event)
    if (loop && !loops.has(loop.id)) loops.set(loop.id, loop)
    else if (loop) Object.assign(loops.get(loop.id), loop)
  }
  return [...loops.values()]
}
function grouped(container, members, area, item = null) {
  const loops = allLoops().filter(loop => members.some(event => loopOf(event)?.id === loop.id))
  for (const loop of loops) container.append(loopGroup(loop, area, members.filter(event => loopOf(event)?.id === loop.id), item))
  const none = el('div', undefined, 'drop-none')
  none.append(el('span', '无闭环（拖到这里解除闭环）'), ...members.filter(event => !loopOf(event)).map(eventCard))
  drop(none, {kind: 'none', area})
  container.append(none)
}
function directMembers(value) {
  const members = nodeResults.get(value) ?? []
  const nested = new Set(value.children.flatMap(child => (nodeResults.get(child) ?? []).map(event => event.system.source_id)))
  return members.filter(event => !nested.has(event.system.source_id))
}
function renderNode(value, area, itemPath = []) {
  if (value.tag.kind === '闭环') {
    const text = value.tag.text, loop = {text, ...loopPattern.exec(text).groups}
    return loopGroup(loop,area,nodeResults.get(value) ?? [],itemPath)
  }
  const name = value.tag.text, nextPath = [...itemPath,name]
  const group = el('section',undefined,'group item'); group.dataset.item = name
  const head = el('div',undefined,'group-head')
  head.append(el('strong',name),button('+小事',() => openEvent(null,area,nextPath)),
    button('+子事项',() => createItem(value)),button('+闭环',() => createLoop(area,nextPath,value)),
    button('改名事项',() => renameItem(name)),button('删除事项',() => deleteItem(name)),
    button('上移',() => reorder(value,-1)),button('下移',() => reorder(value,1)),button('提升',() => promote(value)))
  draggable(head,{kind:'item',name,area})
  group.append(head)
  grouped(group,directMembers(value),area,nextPath)
  for (const child of value.children) group.append(renderNode(child,area,nextPath))
  drop(group,{kind:'item',area,name,items:nextPath})
  return group
}
function siblings(value,nodes=forest,parent=null) {
  if (nodes.includes(value)) return {nodes,parent}
  for (const node of nodes) { const found = siblings(value,node.children,node); if (found) return found }
}
async function reorder(value,direction) {
  const {nodes} = siblings(value), index = nodes.indexOf(value), target = index+direction
  if (target < 0 || target >= nodes.length) return
  nodes.splice(index,1);nodes.splice(target,0,value);await saveForest(true)
}
async function promote(value) {
  const source = siblings(value)
  if (!source.parent || source.parent.tag.kind !== '复利事项') return
  const destination = siblings(source.parent)
  await reparent(value,destination.parent)
}
async function reparentItem(name,targetName) {
  const source = paths().find(entry => entry.value.tag.kind === '复利事项' && entry.value.tag.text === name)
  const target = paths().find(entry => entry.value.tag.kind === '复利事项' && entry.value.tag.text === targetName)
  if (!source || !target || paths([source.value]).some(entry => entry.value === target.value)) return
  await reparent(source.value,target.value)
}
async function reparent(value,target) {
  const sourcePath = paths().find(entry => entry.value === value).tags.filter(tag => tag.kind === '复利事项').map(tag => tag.text)
  const targetPath = target ? paths().find(entry => entry.value === target).tags.filter(tag => tag.kind === '复利事项').map(tag => tag.text) : []
  const values = itemMembers(value.tag.text).map(event => version(event,replaceKind(event.meta,'复利事项',
    [...targetPath,...tagsOf(event,'复利事项').filter(text => !sourcePath.slice(0,-1).includes(text))])))
  if (!await write(values)) return
  siblings(value).nodes.splice(siblings(value).nodes.indexOf(value),1)
  ;(target?.children ?? forest.find(node => node.tag.text === '结果').children).push(value)
  await saveForest(true)
}
function render() {
  workspace.replaceChildren();emptyLoops.clear()
  for (const entry of paths()) if (entry.value.tag.kind === '闭环') {
    const text = entry.value.tag.text, loop = {text,...loopPattern.exec(text).groups}
    const area = entry.tags.find(tag => tag.kind === '业务区域')?.text
    const items = entry.tags.filter(tag => tag.kind === '复利事项').map(tag => tag.text)
    emptyLoops.set(loop.id,{...loop,area,item:items.length ? items : null})
  }
  for (const root of forest) {
    const area = root.tag.text, section = el('section',undefined,'area');section.dataset.area=area
    section.append(el('h2',area))
    const controls = el('div',undefined,'actions')
    controls.append(button('+小事',() => openEvent(null,area)),button('+闭环',() => createLoop(area)))
    if (area === '结果') controls.append(button('+复利事项',() => createItem()))
    section.append(controls)
    // 显式森林节点负责查询和布局；未显式保存的闭环按 event 标签显示。
    const members = directMembers(root)
    grouped(section,members,area)
    for (const child of root.children) section.append(renderNode(child,area))
    drop(section,{kind:'area',area});workspace.append(section)
  }
  renderTemplates()
}
function renderTemplates() {
  const select = document.querySelector('#view-select');select.replaceChildren(new Option('默认视图',''))
  for (const template of templates) select.append(new Option(template.name,String(template.id)))
  select.value = currentTemplate === null ? '' : String(currentTemplate)
  const list = document.querySelector('#loop-templates');list.replaceChildren()
  for (const template of loopTemplates) {
    const row = el('div',undefined,'actions'), name = template.events[0].meta[0].text
    row.dataset.template = template.id
    row.append(el('strong',name),button('编辑模板',() => editLoopTemplate(template)),
      button('使用模板',() => useLoopTemplate(template)),button('删除模板',async () => {
        if (!await ask(`删除模板「${name}」？`)) return
        await saveTemplateRecord({...template,deleted:true})
      }))
    list.append(row)
  }
}
document.querySelector('#view-select').onchange = async event => {
  currentTemplate = event.target.value ? Number(event.target.value) : null
  const root = forest.find(value => value.tag.text === '结果')
  root.children = [...root.children.filter(value => value.tag.kind !== '复利事项'),
    ...(currentTemplate === null ? [] : structuredClone(templates.find(value => value.id === currentTemplate).forest))]
  await saveForest()
}
document.querySelector('#new-view').onclick = async () => {
  const name = await ask('事项视图名称','');if (!name) return
  disable(true)
  try {
    const result = await request('/writeforest',{item_templates:[{id:null,deleted:false,name,forest:[]}]})
    currentTemplate = result.item_templates[0].id
    const root = forest.find(value => value.tag.text === '结果')
    root.children = root.children.filter(value => value.tag.kind !== '复利事项')
    await saveForest()
  } catch(error) {status(error.message,true)} finally {disable(false)}
}
document.querySelector('#rename-view').onclick = async () => {
  const template = templates.find(value => value.id === currentTemplate);if (!template) return
  const name = await ask('事项视图名称',template.name);if (!name) return
  disable(true)
  try { await request('/writeforest',{item_templates:[{id:template.id,deleted:false,name,forest:template.forest}]});await load() }
  catch(error) {status(error.message,true)} finally {disable(false)}
}
document.querySelector('#delete-view').onclick = async () => {
  const template = templates.find(value => value.id === currentTemplate)
  if (!template || !await ask(`删除视图「${template.name}」？小事保留。`)) return
  disable(true)
  try {
    await request('/writeforest',{workspace:{item_template_id:null,forest},item_templates:[{id:template.id,deleted:true,name:template.name,forest:template.forest}]})
    await load();status('已保存')
  } catch(error) {status(error.message,true)} finally {disable(false)}
}
let editingTemplate = null
function draft(text,name) {
  return {system:{version_id:null,source_id:null,deleted:false},user:{event:text},meta:[{kind:'闭环',text:name}]}
}
function editLoopTemplate(template=null) {
  editingTemplate = template
  document.querySelector('#template-name').value=template?.events[0].meta[0].text ?? ''
  document.querySelector('#template-events').replaceChildren()
  for (const event of template?.events ?? [draft('','')]) draftRow(event.user.event)
  document.querySelector('#template-error').textContent=''
  document.querySelector('#template-dialog').showModal()
}
function draftRow(text='') {
  const row=el('div',undefined,'actions'),input=el('textarea');input.value=text;input.setAttribute('aria-label','模板小事正文')
  row.append(input,button('移除小事',() => row.remove()));document.querySelector('#template-events').append(row)
}
async function saveTemplateRecord(value) {
  const record = {id:value.id,deleted:value.deleted,events:value.events}
  disable(true)
  try {await request('/writelooptemplate',[record]);loopTemplates=await request('/readlooptemplate',null);renderTemplates();status('已保存');return true}
  catch(error){status(error.message,true);document.querySelector('#template-error').textContent=error.message;return false}
  finally{disable(false)}
}
document.querySelector('#new-loop-template').onclick=() => editLoopTemplate()
document.querySelector('#add-draft').onclick=() => draftRow()
document.querySelector('#cancel-template').onclick=() => document.querySelector('#template-dialog').close()
document.querySelector('#template-form').onsubmit=async event => {
  event.preventDefault()
  const name=document.querySelector('#template-name').value.trim()
  const drafts=[...document.querySelectorAll('#template-events textarea')].map(input => draft(input.value,name))
  if (await saveTemplateRecord({id:editingTemplate?.id ?? null,deleted:false,events:drafts})) document.querySelector('#template-dialog').close()
}
async function saveLoopTemplate(loop) {
  const members=loopMembers(loop.id)
  editLoopTemplate({id:null,events:(members.length ? members.map(event => draft(event.user.event,loop.name)) : [draft('',loop.name)])})
}
async function useLoopTemplate(template) {
  const area=document.querySelector('#template-area').value,name=template.events[0].meta[0].text
  const text=loopText(crypto.randomUUID().replaceAll('-',''),name)
  await write(template.events.map(event => ({system:{source_id:null,deleted:false},user:{...event.user},
    meta:[{kind:'业务区域',text:area},{kind:'闭环',text}]})))
}
void load()
