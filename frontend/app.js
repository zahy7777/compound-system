const kinds = JSON.parse(document.querySelector('#protocol').textContent)
const areas = ['结果', '待办', '运行', '归档']
const loopRule = Object.values(kinds['闭环'].patterns)[0]
const loopPattern = new RegExp(loopRule.pattern.replaceAll('(?P<', '(?<'))
let facts = [], busy = false, editing = null, drag = null
const emptyItems = new Set(), emptyLoops = new Map()
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
const tagsOf = (fact, kind) => fact.meta.filter(tag => tag.kind === kind).map(tag => tag.text)
const areaOf = fact => tagsOf(fact, '业务区域')[0]
const loopOf = fact => {
  const text = tagsOf(fact, '闭环')[0]
  return text ? {text, ...loopPattern.exec(text).groups} : null
}
function loopText(id, name) { return loopRule.template.replace('{id}', id).replace('{name}', name) }
function version(fact, meta = fact.meta, deleted = false) {
  return {system: {source_id: fact.system.source_id, deleted}, user: {...fact.user}, meta: meta.map(tag => ({...tag}))}
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
async function load() {
  disable(true)
  try { facts = (await request('/read', [[]]))[0]; render(); status('已读取') }
  catch (error) { status(error.message, true) }
  finally { disable(false) }
}
async function write(values, after = () => {}) {
  disable(true)
  try {
    await request('/write', values)
    facts = (await request('/read', [[]]))[0]
    after()
    render()
    status('已保存')
    return true
  } catch (error) { status(error.message, true); return false }
  finally { disable(false) }
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
function openEvent(fact = null, area = '待办', item = null, loop = null) {
  editing = fact
  document.querySelector('#editor-error').textContent = ''
  document.querySelector('#editor-title').textContent = fact ? '编辑小事' : '新建小事'
  document.querySelector('#event').value = fact?.user.event || ''
  tagRows.replaceChildren()
  const meta = fact ? fact.meta : [{kind: '业务区域', text: area},
    ...(item ? [{kind: '复利事项', text: item}] : []), ...(loop ? [{kind: '闭环', text: loop.text}] : [])]
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
async function createItem() {
  const name = await ask('复利事项名称', '')
  if (name) { emptyItems.add(name); render() }
}
async function createLoop(area, item = null) {
  const name = await ask('闭环名称', '')
  if (!name) return
  const id = crypto.randomUUID().replaceAll('-', '')
  emptyLoops.set(id, {id, name, text: loopText(id, name), area, item})
  render()
}
function itemMembers(name) { return facts.filter(fact => tagsOf(fact, '复利事项').includes(name)) }
function loopMembers(id) { return facts.filter(fact => loopOf(fact)?.id === id) }
async function renameItem(name) {
  const next = await ask('新的复利事项名称', name)
  if (!next || next === name) return
  const values = itemMembers(name).map(fact => version(fact,
    replaceKind(fact.meta, '复利事项', tagsOf(fact, '复利事项').map(text => text === name ? next : text))))
  await write(values, () => {
    emptyItems.delete(name); emptyItems.add(next)
    emptyLoops.forEach(loop => { if (loop.item === name) loop.item = next })
  })
}
async function renameLoop(loop) {
  const name = await ask('新的闭环名称', loop.name)
  if (!name || name === loop.name) return
  const text = loopText(loop.id, name)
  await write(loopMembers(loop.id).map(fact => version(fact, replaceKind(fact.meta, '闭环', [text]))), () => {
    if (emptyLoops.has(loop.id)) Object.assign(emptyLoops.get(loop.id), {name, text})
  })
}
async function deleteItem(name) {
  const members = itemMembers(name)
  if (!await ask(`删除复利事项「${name}」及其全部 ${members.length} 条小事？`)) return
  await write(members.map(fact => version(fact, fact.meta, true)), () => {
    emptyItems.delete(name)
    for (const [id, loop] of emptyLoops) if (loop.item === name) emptyLoops.delete(id)
  })
}
async function deleteLoop(loop) {
  const members = loopMembers(loop.id)
  if (!await ask(`删除闭环「${loop.name}」及其全部 ${members.length} 条小事？`)) return
  await write(members.map(fact => version(fact, fact.meta, true)), () => emptyLoops.delete(loop.id))
}
function sourceRecords(source) {
  if (source.kind === 'event') return facts.filter(fact => fact.system.source_id === source.id)
  if (source.kind === 'loop') return loopMembers(source.id).filter(fact => areaOf(fact) === source.area)
  return itemMembers(source.name).filter(fact => areaOf(fact) === source.area)
}
async function move(source, target) {
  const values = sourceRecords(source).map(fact => {
    let meta = replaceKind(fact.meta, '业务区域', [target.area])
    if (target.kind === 'loop') meta = replaceKind(meta, '闭环', [target.text])
    if (target.kind === 'none') meta = replaceKind(meta, '闭环', [])
    if (target.kind === 'item') meta = replaceKind(meta, '复利事项', [target.name])
    return version(fact, meta)
  })
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
function factCard(fact) {
  const card = el('article', undefined, 'fact')
  card.dataset.source = fact.system.source_id
  card.append(el('div', fact.user.event || '（空正文）', 'fact-body'))
  card.append(el('div', fact.meta.filter(tag => tag.kind !== '业务区域').map(tag =>
    tag.kind === '闭环' ? `闭环：${loopOf(fact).name}` : `${tag.kind}：${tag.text}`).join(' · '), 'badges'))
  const actions = el('div', undefined, 'actions')
  actions.append(button('编辑', () => openEvent(fact)), button('删除', async () => {
    if (await ask('删除这条小事？')) await write([version(fact, fact.meta, true)])
  }))
  for (const area of areas.filter(area => area !== areaOf(fact))) {
    actions.append(button(area === '运行' ? '运行' : area === '归档' ? '归档' : `移入${area}`,
      () => move({kind: 'event', id: fact.system.source_id}, {kind: 'area', area})))
  }
  card.append(actions)
  draggable(card, {kind: 'event', id: fact.system.source_id})
  return card
}
function loopGroup(loop, area, members, item) {
  const group = el('section', undefined, 'group loop')
  group.dataset.loop = loop.id
  const head = el('div', undefined, 'group-head')
  const same = allLoops().filter(other => other.name === loop.name)
  head.append(el('strong', loop.name + (same.length > 1 ? `（同名 ${same.findIndex(other => other.id === loop.id) + 1}）` : '')),
    button('+小事', () => openEvent(null, area, item, loop)),
    button('改名闭环', () => renameLoop(loop)), button('删除闭环', () => deleteLoop(loop)))
  draggable(head, {kind: 'loop', id: loop.id, area})
  group.append(head, ...members.map(factCard))
  if (!members.length) group.append(el('p', '空闭环：仅当前页面保留', 'empty'))
  drop(group, {kind: 'loop', area, text: loop.text})
  return group
}
function allLoops() {
  const loops = new Map(emptyLoops)
  for (const fact of facts) {
    const loop = loopOf(fact)
    if (loop && !loops.has(loop.id)) loops.set(loop.id, loop)
    else if (loop) Object.assign(loops.get(loop.id), loop)
  }
  return [...loops.values()]
}
function grouped(container, members, area, item = null) {
  const loops = allLoops().filter(loop => members.some(fact => loopOf(fact)?.id === loop.id) ||
    (emptyLoops.has(loop.id) && loop.area === area && loop.item === item))
  for (const loop of loops) container.append(loopGroup(loop, area, members.filter(fact => loopOf(fact)?.id === loop.id), item))
  const none = el('div', undefined, 'drop-none')
  none.append(el('span', '无闭环（拖到这里解除闭环）'), ...members.filter(fact => !loopOf(fact)).map(factCard))
  drop(none, {kind: 'none', area})
  container.append(none)
}
function render() {
  workspace.replaceChildren()
  const items = [...new Set([...emptyItems, ...facts.flatMap(fact => tagsOf(fact, '复利事项'))])]
  for (const area of areas) {
    const section = el('section', undefined, 'area')
    section.dataset.area = area
    section.append(el('h2', area))
    const controls = el('div', undefined, 'actions')
    controls.append(button('+小事', () => openEvent(null, area)), button('+闭环', () => createLoop(area)))
    if (area === '结果') controls.append(button('+复利事项', createItem))
    section.append(controls)
    const members = facts.filter(fact => areaOf(fact) === area)
    if (area === '结果') {
      for (const name of items) {
        const item = el('section', undefined, 'group item')
        item.dataset.item = name
        const head = el('div', undefined, 'group-head')
        head.append(el('strong', name), button('+小事', () => openEvent(null, area, name)),
          button('+闭环', () => createLoop(area, name)), button('改名事项', () => renameItem(name)),
          button('删除事项', () => deleteItem(name)))
        draggable(head, {kind: 'item', name, area})
        item.append(head)
        grouped(item, members.filter(fact => tagsOf(fact, '复利事项').includes(name)), area, name)
        drop(item, {kind: 'item', area, name})
        section.append(item)
      }
      grouped(section, members.filter(fact => tagsOf(fact, '复利事项').length === 0), area)
    } else grouped(section, members, area)
    drop(section, {kind: 'area', area})
    workspace.append(section)
  }
}
void load()
