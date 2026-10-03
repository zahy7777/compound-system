import {el, iconButton, controls} from './component/button.js'
import {eventRow} from './component/event_row.js'
import {loopGroup} from './component/loop_group.js'
import {dateRange} from './component/date_range/index.js'
import {capture} from './component/capture/index.js'
import {shortcutPage} from './presentation/index.js'
import {shortcutSettings} from './desktop_settings/index.js'
import {mobilePage} from './mobile/index.js'
export function createWorkspace(root, timer, keyOf, events, createSpeech, {presentation = 'full', desktop = null, logout = null} = {}) {
  let structure, search = '', contextId = 0, requestFold
  let mobileArea = '待办'
  const contexts = new Map()
  const ranges = {结果: 'today', 归档: 'today'}
  // 按原顺序分配列，各列独立向下贴合；内容与列宽变化都重新测量。
  const sliceLayout = new ResizeObserver(() => {
    const container = root.querySelector('.slice-panels')
    if (!container) return
    const strip = container.querySelector(':scope > .running-strip')
    if (strip) {
      strip.style.gridColumn = '1 / -1'
      strip.style.gridRowEnd = `span ${Math.ceil(strip.getBoundingClientRect().height + (parseFloat(getComputedStyle(container).rowGap) || 0))}`
    }
    const panels = Array.from(container.querySelectorAll(':scope > .small-page'))
    for (const panel of panels) panel.style.gridColumn = ''
    const style = getComputedStyle(container), columns = style.gridTemplateColumns.split(' ').length, gap = parseFloat(style.columnGap)
    panels.forEach((panel, index) => {
      panel.style.gridColumn = String(index % columns + 1)
      panel.style.gridRowEnd = `span ${Math.ceil(panel.getBoundingClientRect().height + gap)}`
    })
  })
  function register(value) {const id = String(++contextId); contexts.set(id, value); return id}
  function draggable(element, value, drop = false) {const id = register(value); element.draggable = true; element.dataset.drag = id; if (drop) element.dataset.drop = id}
  function dropTarget(element, value) {element.dataset.drop = register(value)}
  function control(label, action, value = {}, symbol = null, text = '') {
    const button = iconButton({icon: symbol, label, text})
    button.dataset.action = action; button.dataset.context = register(value)
    return button
  }
  function clock(event) {const node = el('span', duration(timer.elapsed(keyOf(event.system.source_id))), 'timer-display'); node.dataset.key = keyOf(event.system.source_id); return node}
  function eventCard(event, hostTags, slice) {
    const id = event.system.source_id, area = events.tags(event, '业务区域')[0], snapshot = timer.snapshot(keyOf(id))
    const active = snapshot && (snapshot.state === 'running' || snapshot.elapsed_ms > 0)
    const buttons = {edit: control('修改事实', 'edit', {event}, 'pencil'), delete: control('删除事实', 'delete', {id}, 'minus')}
    if (area === '结果' || area === '运行') buttons.play = control(active && snapshot.state === 'running' ? '暂停' : active ? '继续' : '开始计时', active && snapshot.state === 'running' ? 'pause' : 'start', {id}, active && snapshot.state === 'running' ? 'pause' : 'play')
    if (area === '待办') buttons.play = control('开始计时', 'run', {id, event}, 'play')
    if (area === '归档') buttons.run = control('移入运行', 'run', {id, event}, 'rotate')
    if (area === '运行') {buttons.archive = control('归档', 'archive', {id, event}, 'archive'); buttons.todo = control('返回待办', 'todo', {id, event}, 'return')}
    const score = events.attribute(event, '评分')
    const card = eventRow({body: event.user.event || '尚未填写正文', badge: area === '结果' ? events.loop(event)?.name ?? '' : '', stats: [events.elapsed(event) > 0 ? duration(events.elapsed(event) * 1000) : '', score ? `${score}分` : ''].filter(Boolean).join(' · '), clock: area === '运行' ? clock(event) : null, running: area === '运行', paused: snapshot?.state !== 'running', buttons})
    draggable(card, {kind: 'event', area, slice, ids: [id], items: hostTags.filter(tag => tag.kind === '复利事项').map(tag => tag.text), loop: events.loop(event)?.text})
    card.dataset.source = id; card.dataset.visualKey = `event:${id}`; return card
  }
  function duration(ms) {
    const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60
    return `${hours ? `${hours}时` : ''}${hours || minutes ? `${minutes}分` : ''}${seconds % 60}秒`
  }
  function resultTimers() {
    const strip = el('section', undefined, 'running-strip'); strip.setAttribute('aria-label', '运行计时条')
    for (const {event, label} of structure.resultEvents) {
      const id = event.system.source_id, snapshot = timer.snapshot(keyOf(id))
      if (!snapshot || (snapshot.state === 'paused' && !snapshot.elapsed_ms)) continue
      const running = snapshot.state === 'running', row = el('div'); row.dataset.timerSource = id; row.dataset.timerState = snapshot.state
      const caption = el('div', undefined, 'result-timer-label'); caption.append(el('span', undefined, running ? 'live-dot' : 'paused-dot'), el('span', event.user.event || label), el('small', running ? '计时中' : '已暂停'))
      row.append(caption, clock(event), controls(control(running ? '暂停' : '继续', running ? 'pause' : 'resume', {id}, running ? 'pause' : 'play', running ? '暂停' : '继续'), control('结束', 'finish', {id, event}, 'stop', '结束'))); strip.append(row)
    }
    strip.hidden = !strip.children.length; return strip
  }
  function branch(node, area, slice) {
    const foldChange = {tags: node.tags, isFold: !node.is_fold, order: node.loopOrder}
    if (node.tag.kind === '闭环') {
      const buttons = area === '待办' ? [control('在闭环下新增待办', 'record', {tags: node.tags, slice}, 'plus'), control('重命名闭环', 'rename', {node}, 'pencil'), control('删除闭环组', 'delete-tag', {node, slice}, 'minus')] : []
      const {section, head, content} = loopGroup({key: node.loop.id, label: el('span', node.name), count: el('small', `${node.members.length} 件`), buttons, collapsed: node.is_fold, onToggle: () => requestFold(foldChange)})
      if (area !== '结果') draggable(head, {kind: 'loop', area, slice, tag: node.tag, ids: node.members.map(event => event.system.source_id), order: node.loopOrder}, true)
      section.dataset.loop = node.loop.id
      content.append(...node.direct.map(event => eventCard(event, node.tags, slice)), ...node.children.map(child => branch(child, area, slice)))
      if (!node.direct.length && !node.children.length && area === '待办') content.append(el('p', '这个闭环下还没有小事。', 'empty'))
      if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true
      return section
    }
    const section = el('section', undefined, 'item'), head = el('div', undefined, 'group-head'); section.dataset.item = node.name; section.dataset.visualKey = `item:${node.tags.map(tag => `${tag.kind}:${tag.text}`).join('/')}`
    if (area === '结果') draggable(head, {kind: 'item', area, path: node.path, items: node.tags.filter(tag => tag.kind === '复利事项').map(tag => tag.text)}, true)
    const fold = control(node.is_fold ? '展开' : '收起', 'fold', foldChange, 'chevron'); fold.className = node.is_fold ? 'fold closed' : 'fold'
    const name = control(node.name, 'fold', foldChange, null, node.name); name.className = 'branch-name'; name.dataset.paper = 'branch-name'
    const records = controls(control('开始计时', 'record-start', {tags: node.tags}, 'play'), control('记录一条', 'record', {tags: node.tags}, 'write', '记录一条')); records.classList.add('branch-actions'); delete records.dataset.paper
    const review = control('回顾投入', 'review', {events: node.review, name: node.name}, 'chart')
    const totals = el('span', undefined, 'branch-totals'); totals.setAttribute('aria-label','事项总耗时总评分'); totals.append(el('span',duration(node.totals.elapsedMs)),el('span',`${node.totals.score}分`))
    const stats = el('div', undefined, 'branch-time'); stats.append(totals,review)
    head.append(fold, name, records, stats)
    const tools = controls(control('新增子事项', 'add-item', {path: node.path}, 'plus'), control('重命名事项', 'rename', {node}, 'pencil'), control('删除事项分支', 'delete-tag', {node}, 'minus'))
    tools.classList.add('structure-actions'); head.append(tools)
    const content = el('div', undefined, 'branch-content'); content.hidden = node.is_fold
    content.append(...node.direct.map(event => eventCard(event, node.tags, slice)), ...node.children.map(child => branch(child, area, slice)))
    section.append(head, content)
    if (search && !section.textContent.toLowerCase().includes(search.toLowerCase())) section.hidden = true
    return section
  }
  function areaPanel(area, slice) {
    const section = el('section', undefined, 'area'); section.dataset.area = area.name
    if (slice !== undefined) dropTarget(section, {kind: 'slice', area: area.name, slice})
    const heading = el('div', undefined, 'section-heading'), title = el('div', undefined, 'stage-title'); title.append(el(area.name === '结果' ? 'h2' : 'h3', area.name)); heading.append(title)
    if (area.name === '结果' || area.name === '归档') title.append(dateRange(area.name,ranges[area.name]))
    if (area.name === '结果') {
      const tools = controls(), summary = el('span', undefined, 'result-summary'); summary.append(el('small', '投入'), el('strong', duration(area.totals.elapsedMs)))
      const review = control('投入回顾', 'review', {events: area.review, name: '结果投入'}, 'chart', '投入回顾'), add = control('新增根事项', 'add-item', {path: area.path}, 'plus', '新增根事项'); add.className = 'primary'
      tools.append(summary, review, add); heading.append(tools)
    }
    if (area.name === '待办') title.append(control('新增待办', 'record', {tags: area.tags, slice}, 'plus'), control('选择或管理模板', 'templates', {slice}, 'clipboard'), control('新增闭环', 'add-loop', {tags: area.tags, slice}, 'folder'))
    if (area.name === '运行') title.append(el('span', undefined, 'live-dot'), control('快速运行', 'record-start', {tags: area.tags, slice}, 'play'))
    if (area.name !== '结果') heading.append(el('small', `${area.members.length} 件`, 'count'))
    section.append(heading, ...area.direct.map(event => eventCard(event, area.tags, slice)), ...area.children.map(child => branch(child, area.name, slice)))
    if (!area.direct.length && !area.children.length) section.append(el('p', area.name === '结果' ? '从一个值得长期投入的事项开始。' : area.name === '运行' ? '暂无运行中的小事' : area.name === '待办' ? '暂无待办小事' : '暂无匹配的归档', 'empty'))
    return section
  }
  function slicePanel(panel) {
    const section = el('section', undefined, 'small-page'); section.dataset.slice = panel.slice ?? ''; section.setAttribute('aria-label', panel.name)
    const heading = el('div', undefined, 'slice-heading'), title = el('h2', panel.name)
    dropTarget(title, {kind: 'slice', slice: panel.slice})
    const buttons = controls()
    if (panel.slice !== null) buttons.append(control('修改切片', 'rename-slice', {slice: panel.slice}, 'pencil'), control('删除切片', 'delete-slice', {slice: panel.slice}, 'minus'))
    buttons.append(control('新增切片', 'add-slice', {slice: panel.slice}, 'plus'))
    heading.append(title, buttons); section.append(heading)
    if (panel.slice === null && structure.missingSlices.length) section.append(el('p', `缺失切片：${structure.missingSlices.join('、')}。相关小事暂显示在这里，新增同名切片即可归位。`, 'slice-warning'))
    for (const name of ['运行', '待办', '归档']) section.append(areaPanel(panel.areas.find(area => area.name === name), panel.slice))
    return section
  }
  function render(next = structure) {
    sliceLayout.disconnect()
    structure = next; contexts.clear(); root.replaceChildren()
    const mobile = presentation === 'mobile' || (presentation === 'full' && matchMedia('(max-width:650px)').matches)
    root.dataset.presentation = mobile ? 'mobile' : presentation
    if (!mobile && presentation !== 'full') {
      root.append(shortcutPage(presentation, structure, {areaPanel, resultTimers, settings: desktop ? () => shortcutSettings(modal, desktop) : null})); return
    }
    function resultPage() {
      const left = el('div', undefined, 'result-page'), toolbar = el('section', undefined, 'workspace-controls')
      toolbar.append(el('h1', '日拱一卒，复利人生'))
      const row = el('div', undefined, 'toolbar'), select = el('select'); select.id = 'view-select'; select.setAttribute('aria-label', '事项视图')
      select.append(new Option('默认视图', '')); for (const view of structure.views) select.append(new Option(view.name, String(view.id)))
      select.value = structure.currentView === null ? '' : String(structure.currentView)
      const input = el('input'); input.id = 'search'; input.placeholder = '搜索事项或小事'; input.setAttribute('aria-label', '搜索'); input.value = search
      row.append(select, control('新增视图', 'add-view', {}, 'plus'), input); toolbar.append(row)
      left.append(toolbar, areaPanel(structure.areas.find(area => area.name === '结果')))
      return left
    }
    if (mobile) root.append(mobilePage({selected: mobileArea, select: name => {mobileArea = name; render()}, logout, result: resultPage, timers: resultTimers, area: () => areaPanel(structure.areas.find(area => area.name === mobileArea))}))
    else {
      const right = el('section', undefined, 'slice-panels'); right.setAttribute('aria-label', '小事面板')
      right.append(resultTimers())
      right.append(...structure.slicePanels.map(slicePanel))
      root.append(resultPage(), right)
      sliceLayout.observe(right)
      for (const panel of right.children) sliceLayout.observe(panel)
    }
    if (search) for (const card of root.querySelectorAll('.event')) card.hidden = !card.textContent.toLowerCase().includes(search.toLowerCase())
  }
  function tick() {for (const node of root.querySelectorAll('.timer-display')) node.textContent = duration(timer.elapsed(node.dataset.key))}
  function status(text, error = false) {const node = document.querySelector('#message'); node.textContent = text; node.className = error ? 'error' : ''; for (const dialog of document.querySelectorAll('dialog[open]')) dialog.querySelector('.dialog-error').textContent = error ? text : ''}
  function busy(value) {root.classList.toggle('saving', value); document.querySelectorAll('button,input,select,textarea').forEach(node => {node.disabled = value})}
  function clearDrop() {for (const node of document.querySelectorAll('.drop-inside,.drop-before,.drop-after')) node.classList.remove('drop-inside','drop-before','drop-after')}
  function modal(title) {
    const dialog = el('dialog'), form = el('form'), heading = el('div', undefined, 'dialog-heading')
    dialog.setAttribute('aria-label', title); heading.append(el('h2', title)); heading.append(iconButton({icon: 'close', label: '关闭', onClick: () => dialog.close()}))
    form.append(heading); const error = el('p', '', 'dialog-error'); error.setAttribute('role', 'alert'); form.append(error); dialog.append(form)
    dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog)
    return {dialog, form, show: () => dialog.showModal()}
  }
  function nameDialog(title, initial, submit) {
    const {dialog, form, show} = modal(title), input = el('input'); input.value = initial; input.required = true; input.setAttribute('aria-label', title)
    const footer = el('footer'), cancel = el('button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); footer.append(cancel, el('button', '确定'))
    form.append(input, footer); form.onsubmit = async event => {event.preventDefault(); if (await submit(input.value.trim())) dialog.close()}; show(); input.focus()
  }
  function confirm(title, submit) {const {dialog, form, show} = modal(title); const footer = el('footer'), cancel = el('button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); footer.append(cancel, el('button', '确定')); form.append(footer); form.onsubmit = async event => {event.preventDefault(); if (await submit()) dialog.close()}; show()}
  function editor(initial, submit, {steps, editing = false, elapsedMs} = {}) {
    const title = editing ? '修改事实' : steps[0] === 'score' ? '选择评分' : elapsedMs !== undefined ? '结束计时' : '写下一条事实'
    capture(modal(title), {text: initial.text, attributes: initial.meta.filter(tag => tag.kind === '属性').map(tag => tag.text).join('\n'), seconds: events.elapsed({meta: initial.meta})}, {
      steps, editing, createSpeech,
      context: initial.meta.filter(tag => tag.kind !== '属性').map(tag => tag.kind === '闭环' ? events.loopTag(tag.text).name : tag.text).join(' / '),
      measured: elapsedMs === undefined ? '' : `累计耗时：${duration(events.elapsed({meta: initial.meta}) * 1000 + elapsedMs)}`,
    }, draft => {
      let meta = [...initial.meta.filter(tag => tag.kind !== '属性'), ...draft.attributes.split('\n').filter(Boolean).map(text => ({kind: '属性', text}))]
      if (steps.includes('duration')) meta = events.setAttribute({meta}, '耗时', `${draft.seconds}s`)
      if (steps.includes('score')) meta = events.setAttribute({meta}, '评分', draft.score)
      return submit({text: draft.text, meta})
    })
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
      const template = record?.id ?? crypto.randomUUID()
      const label = el('div'), caption = el('span'), count = el('small'), nameInput = el('input'); nameInput.setAttribute('aria-label', '模板名称'); nameInput.placeholder = '闭环模板名称'; nameInput.value = name; label.append(caption, nameInput)
      function title() {caption.textContent = name || '未命名模板'; count.textContent = `${texts.length} 件`}
      function rename() {caption.hidden = true; nameInput.hidden = false; nameInput.value = name; nameInput.focus()}
      function acceptName() {name = nameInput.value.trim(); caption.hidden = false; nameInput.hidden = true; title()}
      nameInput.oninput = () => {name = nameInput.value.trim(); title()}; nameInput.onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); acceptName()}}
      const more = iconButton({icon: 'plus', label: '+ 增加模板事项'}), change = iconButton({icon: 'pencil', label: '重命名模板', onClick: rename}), remove = iconButton({icon: 'minus', label: '删除模板'})
      const group = loopGroup({key: `template:${template}`, label, count, buttons: [more,change,remove], onToggle: () => {folded = !folded; group.setCollapsed(folded)}})
      const {section, content} = group; section.classList.add('template-draft'); section.dataset.template = template; content.classList.add('template-items')
      function rows(editIndex = -1) {
        content.replaceChildren()
        texts.forEach((text, index) => {
          const body = el('div'), textNode = el('span', text || '空正文', 'event-body'), input = el('input'); input.value = text; input.setAttribute('aria-label', '模板小事正文'); input.hidden = index !== editIndex; textNode.hidden = !input.hidden
          const edit = iconButton({icon: index === editIndex ? 'check' : 'pencil', label: '修改模板事项'}), drop = iconButton({icon: 'minus', label: '删除模板事项'})
          input.oninput = () => {texts[index] = input.value}; input.onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); rows()}}
          edit.onclick = () => rows(index === editIndex ? -1 : index); drop.onclick = () => {texts.splice(index,1); rows(); title()}
          body.append(textNode,input); const row = eventRow({body, buttons: {edit, delete: drop}}); row.classList.add('draft-row'); draggable(row, {kind: 'template-item', template, index, move: (target, position) => {
            let destination = target + (position === 'after' ? 1 : 0)
            if (destination > index) destination--
            if (destination === index) return
            texts.splice(destination, 0, texts.splice(index, 1)[0]); rows(); title()
          }}, true); row.setAttribute('aria-label', `拖动排序：${text || '空正文'}`); content.append(row); if (!input.hidden) input.focus()
        })
        if (!texts.length) content.append(el('p', '还没有事项，点击右侧加号添加。', 'empty'))
        const save = iconButton({icon: 'save', label: '保存模板', text: '保存模板'}); save.classList.add('template-save')
        save.onclick = async () => {acceptName(); if (await capabilities.save(record?.id ?? null,name,texts)) {dialog.close(); dialog.remove(); await capabilities.reopen()}}
        content.append(save)
      }
      more.onclick = () => {acceptName(); editor({text: '', meta: []}, draft => {texts.push(draft.text); folded = false; group.setCollapsed(false); rows(); title(); return true}, {steps: ['text']})}
      remove.onclick = () => {if (!record) section.remove(); else confirm('删除这个闭环模板？', async () => {if (await capabilities.remove(record.id)) {dialog.close(); dialog.remove(); await capabilities.reopen(); return true} return false})}
      management.append(section)
      nameInput.hidden = true; title(); rows(); if (!record) rename()
    }
    const manageHead = el('div', undefined, 'template-manage-heading'), add = iconButton({icon: 'plus', label: '+ 增加模板', text: '增加模板', onClick: () => draft()}); manageHead.append(el('h3', '管理模板'), add)
    const scroll = el('div', undefined, 'template-scroll'); scroll.append(picker,manageHead,management); form.append(scroll); records.forEach(draft); form.onsubmit = event => event.preventDefault(); show()
  }
  return {dateRanges: () => ({...ranges}), setDateRange: (area,value) => {ranges[area] = value}, render, tick, busy, status, nameDialog, confirm, editor, review, templateManager, clearDrop, showDrop: (element, position) => element.classList.add(`drop-${position}`), context: id => contexts.get(id), onFold: callback => {requestFold = callback}, search: value => {search = value; const focused = document.activeElement?.id === 'search'; render(); if (focused) {const input = root.querySelector('#search'); input.focus(); input.setSelectionRange(value.length, value.length)}}}
}
