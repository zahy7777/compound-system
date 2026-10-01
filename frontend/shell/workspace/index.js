import {icon} from './icons.js'
const el = (tag, text, className) => {const value = document.createElement(tag); if (text !== undefined) value.textContent = text; if (className) value.className = className; return value}
export function createWorkspace(root, timer, keyOf, events) {
  let structure, search = '', contextId = 0
  const contexts = new Map(), folded = new Set()
  function control(label, action, value = {}, symbol = null, text = '') {
    const button = el('button'); if (symbol) button.append(icon(symbol)); if (text) button.append(el('span', text)); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label)
    button.dataset.action = action; const id = String(++contextId); contexts.set(id, value); button.dataset.context = id
    return button
  }
  function controls(...buttons) {const row = el('div', undefined, 'actions'); row.append(...buttons); return row}
  function clock(event) {const node = el('span', duration(timer.elapsed(keyOf(event.system.source_id))), 'timer-display'); node.dataset.key = keyOf(event.system.source_id); return node}
  function eventCard(event) {
    const id = event.system.source_id, area = events.tags(event, '业务区域')[0], snapshot = timer.snapshot(keyOf(id))
    const active = snapshot && (snapshot.state === 'running' || snapshot.elapsed_ms > 0)
    const card = el('article', undefined, `event ${area === '运行' ? `running ${snapshot?.state === 'running' ? '' : 'paused'}` : ''}`); card.dataset.source = id
    const body = el('div', undefined, 'event-content'); body.append(el('div', event.user.event || '尚未填写正文', 'event-body'))
    if (area === '归档') body.append(el('small', `${duration(events.elapsed(event) * 1000)}${events.attribute(event, '评分') ? ` · ${events.attribute(event, '评分')}分` : ''}`, 'badges'))
    const actions = controls()
    if (area === '运行') card.append(body, clock(event))
    else card.append(body)
    if (area === '结果' || area === '运行') actions.append(control(active && snapshot.state === 'running' ? '暂停' : active ? '继续' : '开始计时', active && snapshot.state === 'running' ? 'pause' : 'start', {id}, active && snapshot.state === 'running' ? 'pause' : 'play'))
    if (area === '待办' || area === '归档') actions.append(control('移入运行', 'run', {id, event}, area === '归档' ? 'rotate' : 'play'))
    if (area === '运行') actions.append(control('归档', 'archive', {id, event}, 'archive'), control('返回待办', 'todo', {id, event}, 'rotate'))
    if (area === '结果') actions.append(control('修改耗时', 'duration', {event}, null, duration(events.elapsed(event) * 1000)), control('评分', 'score', {event}, null, events.attribute(event, '评分') ?? '未评分'))
    actions.append(control('修改事实', 'edit', {event}, 'pencil'), control('删除事实', 'delete', {id}, 'trash'))
    card.append(actions); return card
  }
  function duration(ms) {
    const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60
    return `${hours ? `${hours}时` : ''}${hours || minutes ? `${minutes}分` : ''}${seconds % 60}秒`
  }
  function resultTimers() {
    const strip = el('section', undefined, 'running-strip'); strip.setAttribute('aria-label', '结果计时条')
    for (const {event, label} of structure.resultEvents) {
      const id = event.system.source_id, snapshot = timer.snapshot(keyOf(id))
      if (!snapshot || (snapshot.state === 'paused' && !snapshot.elapsed_ms)) continue
      const running = snapshot.state === 'running', row = el('div'); row.dataset.timerSource = id; row.dataset.timerState = snapshot.state
      const caption = el('div', undefined, 'result-timer-label'); caption.append(el('span', undefined, running ? 'live-dot' : 'paused-dot'), el('span', event.user.event || label), el('small', running ? '计时中' : '已暂停'))
      row.append(caption, clock(event), controls(control(running ? '暂停' : '继续', running ? 'pause' : 'resume', {id}, running ? 'pause' : 'play', running ? '暂停' : '继续'), control('结束', 'finish', {id, event}, 'stop', '结束'))); strip.append(row)
    }
    strip.hidden = !strip.children.length; return strip
  }
  function branch(node, area) {
    const isLoop = node.tag.kind === '闭环', section = el('section', undefined, isLoop ? 'loop' : 'item')
    section.dataset[isLoop ? 'loop' : 'item'] = isLoop ? node.loop.id : node.name
    const foldKey = JSON.stringify(node.tags), head = el('div', undefined, 'group-head')
    const fold = control(folded.has(foldKey) ? '展开' : '收起', 'fold', {foldKey}, 'chevron'); fold.className = folded.has(foldKey) ? 'fold closed' : 'fold'
    if (isLoop) {const name = control(node.name, 'fold', {foldKey}, 'chevron', node.name); name.className = 'loop-name'; name.setAttribute('aria-expanded', !folded.has(foldKey)); head.append(name, el('small', `${node.members.length} 件`, 'count'))}
    else {
      const name = control(node.name, 'fold', {foldKey}, null, node.name); name.className = 'branch-name'
      const records = controls(control('记录一条', 'record', {tags: node.tags}, 'write', '记录一条'), control('开始计时', 'record-start', {tags: node.tags}, 'play')); records.classList.add('branch-actions')
      const review = control('回顾投入', 'review', {events: node.review, name: node.name}, 'chart'); review.className = 'branch-time'
      head.append(fold, name, records, review)
    }
    const tools = controls()
    if (isLoop && area === '待办') tools.append(control('在闭环下新增待办', 'record', {tags: node.tags}, 'plus'))
    if (!isLoop) tools.append(control('新增子事项', 'add-item', {path: node.path}, 'plus'))
    if (!isLoop || area === '待办') tools.append(control(isLoop ? '重命名闭环' : '重命名事项', 'rename', {node}, 'pencil'), control(isLoop ? '删除闭环组' : '删除事项分支', 'delete-tag', {node}, 'minus'))
    tools.classList.add(isLoop ? 'loop-actions' : 'structure-actions'); head.append(tools)
    const content = el('div', undefined, 'branch-content'); content.hidden = folded.has(foldKey)
    content.append(...node.direct.map(eventCard), ...node.children.map(child => branch(child, area)))
    if (!node.direct.length && !node.children.length && isLoop && area === '待办') content.append(el('p', '这个闭环下还没有小事。', 'empty'))
    section.append(head, content)
    if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true
    return section
  }
  function areaPanel(area) {
    const section = el('section', undefined, 'area'); section.dataset.area = area.name
    const heading = el('div', undefined, 'section-heading'), title = el('div', undefined, 'stage-title'); title.append(el(area.name === '结果' ? 'h2' : 'h3', area.name === '结果' ? '结果.' : area.name)); heading.append(title)
    if (area.name === '结果') {
      const tools = controls(), summary = el('span', undefined, 'result-summary'); summary.append(el('small', '今日投入'), el('strong', duration(structure.todayMs)))
      const review = control('投入回顾', 'review', {events: area.review, name: '结果投入'}, 'chart', '投入回顾'), add = control('新增根事项', 'add-item', {path: area.path}, 'plus', '新增根事项'); add.className = 'primary'
      tools.append(summary, review, add); heading.append(tools)
    }
    if (area.name === '待办') title.append(control('新增待办', 'record', {tags: area.tags}, 'plus'), control('选择或管理模板', 'templates', {}, 'clipboard'), control('新增闭环', 'add-loop', {}, 'folder'))
    if (area.name === '运行') title.append(el('span', undefined, 'live-dot'), control('快速运行', 'record-start', {tags: area.tags}, 'play'))
    if (area.name !== '结果') heading.append(el('small', `${area.members.length} 件`, 'count'))
    section.append(heading, ...area.direct.map(eventCard), ...area.children.map(child => branch(child, area.name)))
    if (!area.direct.length && !area.children.length) section.append(el('p', area.name === '结果' ? '从一个值得长期投入的事项开始。' : area.name === '运行' ? '暂无运行中的小事' : area.name === '待办' ? '暂无待办小事' : '暂无匹配的归档', 'empty'))
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
    row.append(select, control('新增视图', 'add-view', {}, 'plus'), input); toolbar.append(row)
    left.append(toolbar, resultTimers(), areaPanel(structure.areas.find(area => area.name === '结果')))
    const right = el('section', undefined, 'small-page'); right.append(el('h2', '小事.'))
    for (const name of ['运行', '待办', '归档']) right.append(areaPanel(structure.areas.find(area => area.name === name)))
    root.append(left, right)
    if (search) for (const card of root.querySelectorAll('.event')) card.hidden = !card.textContent.toLowerCase().includes(search.toLowerCase())
  }
  function tick() {for (const node of root.querySelectorAll('.timer-display')) node.textContent = duration(timer.elapsed(node.dataset.key))}
  function status(text, error = false) {const node = document.querySelector('#message'); node.textContent = text; node.className = error ? 'error' : ''; for (const dialog of document.querySelectorAll('dialog[open]')) dialog.querySelector('.dialog-error').textContent = error ? text : ''}
  function busy(value) {document.querySelectorAll('button,input,select,textarea').forEach(node => {node.disabled = value})}
  function modal(title) {
    const dialog = el('dialog'), form = el('form'), heading = el('div', undefined, 'dialog-heading')
    dialog.setAttribute('aria-label', title); heading.append(el('h2', title)); const close = el('button'); close.append(icon('close')); close.type = 'button'; close.setAttribute('aria-label', '关闭'); close.onclick = () => dialog.close(); heading.append(close)
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
  function editor(initial, submit, options = {}) {
    const {start = false, editing = false, ending = false} = options
    const {dialog, form, show} = modal(editing ? '修改事实' : ending ? '结束计时' : start ? '开始一件事' : '写下一条事实'); dialog.classList.add('capture')
    form.append(el('p', initial.meta.filter(tag => tag.kind !== '属性').map(tag => tag.kind === '闭环' ? events.loopTag(tag.text).name : tag.text).join(' / '), 'context'))
    const text = el('textarea'); text.setAttribute('aria-label', '小事正文'); text.value = initial.text; text.placeholder = '写下刚才做了什么，或接下来准备做什么。'; text.rows = 6
    const details = el('details'), attributes = el('textarea'); attributes.setAttribute('aria-label', '属性标签'); attributes.rows = 3; attributes.value = initial.meta.filter(tag => tag.kind === '属性').map(tag => tag.text).join('\n'); details.append(el('summary', '属性'), attributes, el('small', '每行一个已登记属性：评分、耗时、日期、备注。'))
    let selectedSeconds = events.elapsed({meta: initial.meta})
    const durationSection = el('section', undefined, 'duration-picker')
    if (options.duration) {
      durationSection.append(el('p', '02 / 耗时（分钟）', 'eyebrow'))
      const choices = el('div', undefined, 'duration-options'), custom = el('input'); custom.type = 'number'; custom.min = '0'; custom.step = '0.000001'; custom.value = String(selectedSeconds / 60); custom.setAttribute('aria-label', '自定义耗时（分钟）')
      for (const minutes of [1,3,5,10,15,20,30]) {const button = el('button', `${minutes} 分钟`); button.type = 'button'; button.onclick = () => {selectedSeconds = minutes * 60; custom.value = String(minutes); for (const choice of choices.children) choice.setAttribute('aria-pressed', choice === button)}; choices.append(button)}
      custom.oninput = () => {selectedSeconds = Number((Number(custom.value) * 60).toFixed(6)); for (const choice of choices.children) choice.setAttribute('aria-pressed', false)}
      durationSection.append(choices, custom)
    }
    if (ending) durationSection.append(el('p', `累计耗时：${duration((selectedSeconds * 1000) + options.elapsedMs)}`, 'context'))
    const footer = el('footer'), save = el('button', editing ? '保存修改' : start ? '保存并开始' : '保存并选择评分'); footer.append(save); form.append(el('p', '01 / 事实', 'eyebrow'), text, durationSection, details, footer)
    form.onsubmit = async event => {
      event.preventDefault(); const draft = {text: text.value, meta: [...initial.meta.filter(tag => tag.kind !== '属性'), ...attributes.value.split('\n').filter(Boolean).map(value => ({kind: '属性', text: value}))]}
      if (options.duration) draft.meta = events.setAttribute({meta: draft.meta}, '耗时', `${selectedSeconds}s`)
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
    const {dialog, form, show} = modal('选择模板'); dialog.classList.add('template-dialog')
    const heading = form.querySelector('.dialog-heading'), headingTitle = el('div'); headingTitle.append(el('small', '闭环模板'), heading.querySelector('h2')); heading.prepend(headingTitle)
    const picker = el('div', undefined, 'template-picker'), management = el('div', undefined, 'template-manage')
    for (const record of records) {
      const button = el('button'); button.type = 'button'; button.setAttribute('aria-label', `${record.events[0].meta[0].text} · ${record.events.length} 条`)
      button.append(el('strong', record.events[0].meta[0].text), el('small', `${record.events.length} 项`))
      button.onclick = async () => {if (await capabilities.use(record.id)) dialog.close()}; picker.append(button)
    }
    function draft(record = null) {
      let name = record?.events[0].meta[0].text ?? '', texts = record?.events.map(event => event.user.event) ?? [], folded = false
      const section = el('section', undefined, 'template-draft'); section.dataset.template = record?.id ?? 'new'
      const head = el('div', undefined, 'group-head'), content = el('div', undefined, 'template-items')
      const label = el('button', undefined, 'loop-name'), count = el('small', '', 'count'), nameInput = el('input'); label.type = 'button'; nameInput.setAttribute('aria-label', '模板名称'); nameInput.placeholder = '闭环模板名称'; nameInput.value = name
      function title() {label.replaceChildren(icon('chevron'), el('span', name || '未命名模板')); label.setAttribute('aria-expanded', !folded); count.textContent = `${texts.length} 件`}
      function rename() {label.hidden = true; nameInput.hidden = false; nameInput.value = name; nameInput.focus()}
      function acceptName() {name = nameInput.value.trim(); label.hidden = false; nameInput.hidden = true; title()}
      nameInput.onchange = acceptName; nameInput.onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); acceptName()}}
      label.onclick = () => {folded = !folded; content.hidden = folded; title()}
      const buttons = controls(), more = el('button'), change = el('button'), remove = el('button')
      for (const [button, symbol, caption] of [[more,'plus','+ 增加模板事项'],[change,'pencil','重命名模板'],[remove,'trash','删除模板']]) {button.type = 'button'; button.append(icon(symbol)); button.setAttribute('aria-label', caption); button.title = caption}
      change.onclick = rename
      function rows(editIndex = -1) {
        content.replaceChildren()
        texts.forEach((text, index) => {
          const row = el('div', undefined, 'draft-row'), textNode = el('span', text || '空正文', 'template-item-content'), input = el('input'); input.value = text; input.setAttribute('aria-label', '模板小事正文'); input.hidden = index !== editIndex; textNode.hidden = !input.hidden
          const edit = el('button'), drop = el('button'); edit.type = drop.type = 'button'; edit.append(icon(index === editIndex ? 'check' : 'pencil')); drop.append(icon('trash')); edit.setAttribute('aria-label', '修改模板事项'); drop.setAttribute('aria-label', '删除模板事项')
          input.oninput = () => {texts[index] = input.value}; input.onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); rows()}}
          edit.onclick = () => rows(index === editIndex ? -1 : index); drop.onclick = () => {texts.splice(index,1); rows(); title()}
          row.append(textNode,input,controls(edit,drop)); content.append(row); if (!input.hidden) input.focus()
        })
        if (!texts.length) content.append(el('p', '还没有事项，点击右侧加号添加。', 'empty'))
        const save = el('button', undefined, 'template-save'); save.type = 'button'; save.append(icon('save'), el('span', '保存模板')); save.setAttribute('aria-label', '保存模板')
        save.onclick = async () => {acceptName(); if (await capabilities.save(record?.id ?? null,name,texts)) {dialog.close(); dialog.remove(); await capabilities.reopen()}}
        content.append(save)
      }
      more.onclick = () => {texts.push(''); folded = false; content.hidden = false; rows(texts.length-1); title()}
      remove.onclick = () => {if (!record) section.remove(); else confirm('删除这个闭环模板？', async () => {if (await capabilities.remove(record.id)) {dialog.close(); dialog.remove(); await capabilities.reopen(); return true} return false})}
      buttons.classList.add('template-group-actions'); buttons.append(more,change,remove); head.append(label,nameInput,count,buttons); section.append(head,content); management.append(section)
      nameInput.hidden = true; title(); rows(); if (!record) rename()
    }
    const manageHead = el('div', undefined, 'template-manage-heading'), add = el('button'); add.type = 'button'; add.setAttribute('aria-label', '+ 增加模板'); add.append(icon('plus'),el('span','增加模板')); add.onclick = () => draft(); manageHead.append(el('h3', '管理模板'), add)
    const scroll = el('div', undefined, 'template-scroll'); scroll.append(picker,manageHead,management); form.append(scroll); records.forEach(draft); form.onsubmit = event => event.preventDefault(); show()
  }
  return {render, tick, busy, status, nameDialog, confirm, rating, editor, review, templateManager, context: id => contexts.get(id), fold: key => {if (folded.has(key)) folded.delete(key); else folded.add(key); render()}, search: value => {search = value; const focused = document.activeElement?.id === 'search'; render(); if (focused) {const input = root.querySelector('#search'); input.focus(); input.setSelectionRange(value.length, value.length)}}}
}
