const el = (tag, text, className) => {const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value}
export function createWorkspace(root, timer, keyOf, events) {
  let structure, search = '', contextId = 0
  const contexts = new Map(), folded = new Set()
  function control(label, action, value = {}, icon = label) {
    const button = el('button', icon); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label)
    button.dataset.action = action; const id = String(++contextId); contexts.set(id, value); button.dataset.context = id
    return button
  }
  function controls(...buttons) {const row = el('div', undefined, 'actions'); row.append(...buttons); return row}
  function clock(event) {const node = el('span', timer.format(timer.elapsed(keyOf(event.system.source_id))), 'timer-display'); node.dataset.key = keyOf(event.system.source_id); return node}
  function eventCard(event) {
    const id = event.system.source_id, card = el('article', undefined, 'event'); card.dataset.source = id
    const body = el('div', undefined, 'event-content'); body.append(el('div', event.user.event || '尚未填写正文', 'event-body'))
    const badges = event.meta.filter(tag => tag.kind === '属性').map(tag => tag.text).join(' · ')
    if (badges) body.append(el('small', badges, 'badges'))
    const snapshot = timer.snapshot(keyOf(id)), active = snapshot && (snapshot.state === 'running' || snapshot.elapsed_ms > 0)
    const area = events.tags(event, '业务区域')[0]
    const actions = controls()
    if (active) actions.append(clock(event), control(snapshot.state === 'running' ? '暂停' : '继续', snapshot.state === 'running' ? 'pause' : 'resume', {id}, snapshot.state === 'running' ? 'Ⅱ' : '▶'), control('结束', 'finish', {id}, '■'))
    else actions.append(control(area === '归档' ? '恢复运行' : '运行', 'start', {id}, '▶'))
    if (area === '运行') actions.append(control('归档', 'archive', {id}, '✓'))
    actions.append(control('修改耗时', 'duration', {event}, `${events.elapsed(event)}s`), control('评分', 'score', {event}, events.attribute(event, '评分') ?? '☆'), control('修改事实', 'edit', {event}, '✎'), control('删除事实', 'delete', {id}, '×'))
    card.append(body, actions); return card
  }
  function branch(node, area) {
    const isLoop = node.tag.kind === '闭环', section = el('section', undefined, isLoop ? 'loop' : 'item')
    section.dataset[isLoop ? 'loop' : 'item'] = isLoop ? node.loop.id : node.name
    const foldKey = JSON.stringify(node.tags), head = el('div', undefined, 'group-head')
    head.append(control(folded.has(foldKey) ? '展开' : '收起', 'fold', {foldKey}, folded.has(foldKey) ? '▸' : '▾'), el('strong', node.name), el('small', `${node.members.length}`, 'count'))
    if (!isLoop || area === '待办') head.append(control(isLoop ? '在闭环下新增待办' : '记录一条', 'record', {tags: node.tags}, '+'))
    if (!isLoop) head.append(control('开始计时', 'record-start', {tags: node.tags}, '▶'), control('回顾投入', 'review', {events: node.review, name: node.name}, '◷'), control('新增子事项', 'add-item', {path: node.path}, '⊕'))
    if (!isLoop || area === '待办') head.append(control(isLoop ? '重命名闭环' : '重命名事项', 'rename', {node}, '✎'), control(isLoop ? '删除闭环组' : '删除事项分支', 'delete-tag', {node}, '×'))
    const content = el('div', undefined, 'branch-content'); content.hidden = folded.has(foldKey)
    content.append(...node.direct.map(eventCard), ...node.children.map(child => branch(child, area)))
    if (!node.direct.length && !node.children.length) content.append(el('p', '暂无小事', 'empty'))
    section.append(head, content)
    if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true
    return section
  }
  function areaPanel(area) {
    const section = el('section', undefined, 'area'); section.dataset.area = area.name
    const heading = el('div', undefined, 'section-heading'); heading.append(el(area.name === '结果' ? 'h2' : 'h3', area.name === '结果' ? '结果.' : area.name), el('span', String(area.members.length), 'count'))
    if (area.name === '结果') heading.append(control('投入回顾', 'review', {events: structure.events, name: '全部投入'}, '◷ 投入回顾'), control('新增根事项', 'add-item', {path: area.path}, '+'))
    if (area.name === '待办') heading.append(control('新增待办', 'record', {tags: area.tags}, '+'), control('选择或管理模板', 'templates', {}, '▤'), control('新增闭环', 'add-loop', {}, '⊕'))
    if (area.name === '运行') heading.append(control('快速运行', 'record-start', {tags: area.tags}, '▶'))
    section.append(heading, ...area.direct.map(eventCard), ...area.children.map(child => branch(child, area.name)))
    if (!area.direct.length && !area.children.length) section.append(el('p', area.name === '结果' ? '从一个值得长期投入的事项开始。' : '暂无小事', 'empty'))
    return section
  }
  function render(next = structure) {
    structure = next; contexts.clear(); root.replaceChildren()
    const left = el('div', undefined, 'result-page'), toolbar = el('section', undefined, 'workspace-controls')
    toolbar.append(el('small', 'COMPOUND', 'eyebrow'), el('h1', '让每一次投入积累下来'))
    const row = el('div', undefined, 'toolbar'), select = el('select'); select.id = 'view-select'; select.setAttribute('aria-label', '事项视图')
    select.append(new Option('默认视图', '')); for (const view of structure.views) select.append(new Option(view.name, String(view.id)))
    select.value = structure.currentView === null ? '' : String(structure.currentView)
    const input = el('input'); input.id = 'search'; input.placeholder = '搜索事项或小事'; input.setAttribute('aria-label', '搜索'); input.value = search
    row.append(select, control('新增视图', 'add-view', {}, '+'), input); toolbar.append(row)
    left.append(toolbar, areaPanel(structure.areas.find(area => area.name === '结果')))
    const right = el('section', undefined, 'small-page'); right.append(el('h2', '小事.'))
    for (const name of ['运行', '待办', '归档']) right.append(areaPanel(structure.areas.find(area => area.name === name)))
    root.append(left, right)
    if (search) for (const card of root.querySelectorAll('.event')) card.hidden = !card.textContent.toLowerCase().includes(search.toLowerCase())
  }
  function tick() {for (const node of root.querySelectorAll('.timer-display')) node.textContent = timer.format(timer.elapsed(node.dataset.key))}
  function status(text, error = false) {const node = document.querySelector('#message'); node.textContent = text; node.className = error ? 'error' : ''; for (const dialog of document.querySelectorAll('dialog[open]')) dialog.querySelector('.dialog-error').textContent = error ? text : ''}
  function busy(value) {document.querySelectorAll('button,input,select,textarea').forEach(node => {node.disabled = value})}
  function modal(title) {
    const dialog = el('dialog'), form = el('form'), heading = el('div', undefined, 'dialog-heading')
    dialog.setAttribute('aria-label', title); heading.append(el('h2', title)); const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭'); close.onclick = () => dialog.close(); heading.append(close)
    form.append(heading); const error = el('p', '', 'dialog-error'); error.setAttribute('role', 'alert'); form.append(error); dialog.append(form)
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog)
    return {dialog, form, show: () => dialog.showModal()}
  }
  function nameDialog(title, initial, submit, numeric = false) {
    const {dialog, form, show} = modal(title), input = el('input'); input.value = initial; input.required = !numeric; input.setAttribute('aria-label', title)
    if (numeric) {input.type = 'number'; input.min = '0'; input.step = '0.000001'}
    const footer = el('footer'), cancel = el('button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); footer.append(cancel, el('button', '确定'))
    form.append(input, footer); form.onsubmit = async event => {event.preventDefault(); if (await submit(input.value.trim())) dialog.close()}; show(); input.focus()
  }
  function confirm(title, submit) {const {dialog, form, show} = modal(title); const footer = el('footer'), cancel = el('button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); footer.append(cancel, el('button', '确定')); form.append(footer); form.onsubmit = async event => {event.preventDefault(); if (await submit()) dialog.close()}; show()}
  function rating(title, submit) {
    const {dialog, form, show} = modal(title), row = el('div', undefined, 'rating-options')
    const captions = ['很吃力', '不太顺', '一般', '挺好', '很满意']
    for (let i = 1; i <= 5; i++) {const button = el('button', `${i} · ${captions[i - 1]}`); button.type = 'button'; button.onclick = async () => {if (await submit(String(i))) dialog.close()}; row.append(button)}
    const none = el('button', '不评分，完成'); none.type = 'button'; none.onclick = async () => {if (await submit(null)) dialog.close()}; form.append(row, none); form.onsubmit = event => event.preventDefault(); show()
  }
  function editor(initial, submit, start = false, editing = false) {
    const {dialog, form, show} = modal(editing ? '修改事实' : start ? '开始一件事' : '写下一条事实'); dialog.classList.add('capture')
    form.append(el('p', initial.meta.filter(tag => tag.kind !== '属性').map(tag => tag.kind === '闭环' ? events.loopTag(tag.text).name : tag.text).join(' / '), 'context'))
    const text = el('textarea'); text.setAttribute('aria-label', '小事正文'); text.value = initial.text; text.placeholder = '写下刚才做了什么，或接下来准备做什么。'; text.rows = 6
    const details = el('details'), attributes = el('textarea'); attributes.setAttribute('aria-label', '属性标签'); attributes.rows = 3; attributes.value = initial.meta.filter(tag => tag.kind === '属性').map(tag => tag.text).join('\n'); details.append(el('summary', '属性'), attributes, el('small', '每行一个已登记属性：评分、耗时、日期、备注。'))
    const footer = el('footer'), save = el('button', editing ? '保存修改' : start ? '保存并开始' : '保存并选择评分'); footer.append(save); form.append(el('p', '01 / 事实', 'eyebrow'), text, details, footer)
    form.onsubmit = async event => {
      event.preventDefault(); const draft = {text: text.value, meta: [...initial.meta.filter(tag => tag.kind !== '属性'), ...attributes.value.split('\n').filter(Boolean).map(value => ({kind: '属性', text: value}))]}
      const commit = async score => {if (score !== undefined) draft.meta = events.setAttribute({meta: draft.meta}, '评分', score); if (await submit(draft)) {dialog.close(); return true} return false}
      if (editing || start) await commit(undefined); else rating('选择评分', commit)
    }; show(); text.focus()
  }
  function review(records, name) {
    const {dialog, form, show} = modal(`${name} · 投入回顾`)
    const total = records.reduce((sum, event) => sum + events.elapsed(event), 0); form.append(el('strong', timer.format(total * 1000), 'review-total'), el('p', `${records.length} 条小事`))
    for (const event of records) {const row = el('div', undefined, 'review-row'); row.append(el('span', event.user.event || '尚未填写正文'), el('span', `${events.elapsed(event)}s`)); form.append(row)}
    form.onsubmit = event => event.preventDefault(); show()
  }
  function templateManager(records, capabilities) {
    const {dialog, form, show} = modal('闭环模板'), picker = el('div', undefined, 'template-picker'), management = el('div')
    async function use(id) {if (await capabilities.use(id)) dialog.close()}
    for (const record of records) {const button = el('button', `${record.events[0].meta[0].text} · ${record.events.length} 条`); button.type = 'button'; button.onclick = () => use(record.id); picker.append(button)}
    form.append(el('p', '选择模板加入待办', 'context'), picker, el('h3', '管理模板'))
    function draft(record = null) {
      const section = el('section', undefined, 'template-draft'); section.dataset.template = record?.id ?? 'new'
      const name = el('input'); name.setAttribute('aria-label', '模板名称'); name.placeholder = '闭环模板名称'; name.value = record?.events[0].meta[0].text ?? ''
      const rows = el('div', undefined, 'template-events')
      function add(text = '') {const row = el('div', undefined, 'draft-row'), input = el('textarea'); input.rows = 2; input.value = text; input.setAttribute('aria-label', '模板小事正文'); const remove = el('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', '删除模板事项'); remove.onclick = () => row.remove(); row.append(input, remove); rows.append(row)}
      for (const event of record?.events ?? [{user: {event: ''}}]) add(event.user.event)
      const buttons = controls(), more = el('button', '+ 增加模板事项'), save = el('button', '保存模板'), remove = el('button', '删除模板')
      for (const button of [more, save, remove]) button.type = 'button'
      more.onclick = () => add(); save.onclick = async () => {if (await capabilities.save(record?.id ?? null, name.value.trim(), [...rows.querySelectorAll('textarea')].map(input => input.value))) {dialog.close(); dialog.remove(); await capabilities.reopen()}}
      remove.onclick = () => {if (!record) section.remove(); else confirm('删除这个闭环模板？', async () => {if (await capabilities.remove(record.id)) {dialog.close(); dialog.remove(); await capabilities.reopen(); return true} return false})}
      buttons.append(more, save, remove); section.append(name, rows, buttons); management.append(section)
    }
    const add = el('button', '+ 增加模板'); add.type = 'button'; add.onclick = () => draft(); form.append(add, management); records.forEach(draft); form.onsubmit = event => event.preventDefault(); show()
  }
  return {render, tick, busy, status, nameDialog, confirm, rating, editor, review, templateManager, context: id => contexts.get(id), fold: key => {if (folded.has(key)) folded.delete(key); else folded.add(key); render()}, search: value => {search = value; const focused = document.activeElement?.id === 'search'; render(); if (focused) {const input = root.querySelector('#search'); input.focus(); input.setSelectionRange(value.length, value.length)}}}
}
