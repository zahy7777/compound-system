import {bindDrag} from './drag.js'

export function bindInput(root, commands, workspace, refresh, events, templates) {
  let saving = false
  async function run(action, success = '已保存') {
    if (saving) return false
    saving = true; workspace.busy(true); workspace.status(success === '已读取' ? '正在读取' : '正在保存')
    try {await action(); await refresh(); workspace.status(success); return true}
    catch (error) {
      let message = error.message
      try {await refresh()} catch (readError) {message += `；刷新失败：${readError.message}`}
      workspace.status(message, true); return false
    }
    finally {saving = false; workspace.busy(false)}
  }
  const fold = value => run(() => commands.setFold(value.tags, value.isFold, value.order))
  workspace.onFold(fold)
  async function openTemplates(slice) {
    try {workspace.templateManager(await templates.read(null), {use: id => run(() => commands.useLoopTemplate(id, slice)), save: (id, name, texts) => run(() => commands.saveLoopTemplate(id, name, texts)), remove: id => run(() => commands.deleteLoopTemplate(id)), reopen: () => openTemplates(slice)})}
    catch (error) {workspace.status(error.message, true)}
  }
  bindDrag(root, workspace, (source, target, position) => run(() => {
    if (target.kind === 'slice' || (target.kind === 'loop' && source.slice !== target.slice)) return commands.writeEventTags(source.ids, {}, target.slice)
    if (source.kind === 'item') return commands.moveItem(source.path, target.path, position)
    if (source.kind === 'loop' && target.kind === 'loop') return commands.reorderLoops(source.area, target.order, source.tag.text, target.tag.text, position)
    const changes = target.kind === 'item' ? {'复利事项': target.items, ...(source.area === '归档' ? {'业务区域': ['结果']} : {})} : {'闭环': [target.tag.text]}
    return commands.writeEventTags(source.ids, changes)
  }))
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button || saving) return
    const value = workspace.context(button.dataset.context), action = button.dataset.action
    switch (action) {
      case 'add-slice': workspace.nameDialog('新增切片', '', name => run(() => commands.createSlice(value.slice, name))); break
      case 'rename-slice': workspace.nameDialog('修改切片名称', value.slice, name => run(() => commands.renameSlice(value.slice, name))); break
      case 'delete-slice': workspace.confirm(`删除切片「${value.slice}」？所有关联小事将回到“小事”，保留正文、业务状态和闭环。`, () => run(() => commands.deleteSlice(value.slice))); break
      case 'fold': void fold(value); break
      case 'add-view': workspace.nameDialog('新增事项视图', '', name => run(() => commands.createView(name))); break
      case 'add-item': workspace.nameDialog('复利事项名称', '', name => run(() => commands.createItem(value.path, name))); break
      case 'add-loop': workspace.nameDialog('闭环名称', '', name => {
        if (!value.slice) return run(() => commands.createLoop(name))
        workspace.editor({text: '', meta: value.tags}, draft => run(() => commands.createLoop(name, draft, value.slice)), {steps: ['text']})
        return true
      }); break
      case 'rename': workspace.nameDialog('重命名', value.node.name, name => run(() => commands.renameTag(value.node.tag, name))); break
      case 'delete-tag': workspace.confirm(`删除「${value.node.name}」及${value.node.tag.kind === '闭环' ? '当前区域' : '全部区域'}成员？`, () => run(() => commands.deleteTag(value.node.tag, value.node.path, value.node.tags.find(tag => tag.kind === '业务区域').text, value.slice))); break
      case 'record': case 'record-start': {
        const start = action === 'record-start'
        if (start && value.tags.some(tag => tag.kind === '业务区域' && tag.text === '结果')) {
          void run(() => commands.writeEvent(null, {text: '', meta: [...value.tags, {kind: '属性', text: '耗时:0s'}]}, 'running'))
        } else workspace.editor({text: '', meta: value.tags}, draft => run(() => commands.writeEvent(null, {...draft, slice: value.slice}, start ? 'running' : null)), {steps: start ? ['text'] : value.tags.some(tag => tag.kind === '业务区域' && tag.text === '结果') ? ['text','duration','score'] : value.tags.some(tag => tag.kind === '闭环' || tag.kind === '业务区域' && tag.text === '待办') ? ['text'] : ['text','score']})
        break
      }
      case 'edit': workspace.editor({text: value.event.user.event, meta: value.event.meta}, draft => run(() => commands.writeEvent(value.event.system.source_id, draft)), {steps: ['text'], editing: true}); break
      case 'delete': workspace.confirm('删除这条小事？', () => run(() => commands.writeEvent(value.id, {deleted: true}))); break
      case 'start': case 'resume': void run(() => commands.writeTimer(value.id, 'running')); break
      case 'run': void run(() => commands.run(value.id)); break
      case 'todo': void run(() => commands.writeEvent(value.id, {meta: events.replace(value.event.meta, '业务区域', ['待办'])})); break
      case 'pause': void run(() => commands.writeTimer(value.id, 'paused')); break
      case 'finish': case 'archive': void (async () => {
        let prepared
        if (await run(async () => {prepared = await commands.writeTimer(value.id, 'paused')})) {
          workspace.editor({text: value.event.user.event, meta: value.event.meta}, draft => run(() => commands.writeEvent(value.id, {...draft, meta: action === 'archive' ? events.replace(draft.meta, '业务区域', ['归档']) : draft.meta, elapsedMs: prepared.elapsed_ms}, 'reset')), {steps: action === 'archive' ? ['score'] : ['text','score'], elapsedMs: prepared.elapsed_ms})
        }
      })(); break
      case 'review': workspace.review(value.events, value.name); break
      case 'templates': void openTemplates(value.slice); break
    }
  })
  root.addEventListener('change', event => {
    if (event.target.id === 'view-select') void run(() => commands.switchView(event.target.value ? Number(event.target.value) : null))
    if (event.target.dataset.dateArea) {const {dateArea} = event.target.dataset, value = event.target.value; void run(() => workspace.setDateRange(dateArea,value), '已读取')}
  })
  root.addEventListener('input', event => {if (event.target.id === 'search') workspace.search(event.target.value)})
}
