export function bindInput(root, commands, workspace, refresh, events, templates) {
  let saving = false
  async function run(action) {
    if (saving) return false
    saving = true; workspace.busy(true); workspace.status('正在保存')
    try {await action(); await refresh(); workspace.status('已保存'); return true}
    catch (error) {
      let message = error.message
      try {await refresh()} catch (readError) {message += `；刷新失败：${readError.message}`}
      workspace.status(message, true); return false
    }
    finally {saving = false; workspace.busy(false)}
  }
  async function openTemplates() {
    try {workspace.templateManager(await templates.read(null), {use: id => run(() => commands.useLoopTemplate(id)), save: (id, name, texts) => run(() => commands.saveLoopTemplate(id, name, texts)), remove: id => run(() => commands.deleteLoopTemplate(id)), reopen: openTemplates})}
    catch (error) {workspace.status(error.message, true)}
  }
  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button || saving) return
    const value = workspace.context(button.dataset.context), action = button.dataset.action
    switch (action) {
      case 'fold': workspace.fold(value.foldKey); break
      case 'add-view': workspace.nameDialog('新增事项视图', '', name => run(() => commands.createView(name))); break
      case 'add-item': workspace.nameDialog('复利事项名称', '', name => run(() => commands.createItem(value.path, name))); break
      case 'add-loop': workspace.nameDialog('闭环名称', '', name => run(() => commands.createLoop(name))); break
      case 'rename': workspace.nameDialog('重命名', value.node.name, name => run(() => commands.renameTag(value.node.tag, name))); break
      case 'delete-tag': workspace.confirm(`删除「${value.node.name}」及全部区域成员？`, () => run(() => commands.deleteTag(value.node.tag, value.node.path))); break
      case 'record': case 'record-start': {
        const start = action === 'record-start', meta = start ? events.replace(value.tags, '业务区域', ['运行']) : value.tags
        workspace.editor({text: '', meta}, draft => run(() => commands.createEvent(draft, start)), start); break
      }
      case 'edit': workspace.editor({text: value.event.user.event, meta: value.event.meta}, draft => run(() => commands.editEvent(value.event.system.source_id, draft)), false, true); break
      case 'delete': workspace.confirm('删除这条小事？', () => run(() => commands.deleteEvent(value.id))); break
      case 'start': void run(() => commands.startTimer(value.id)); break
      case 'pause': void run(() => commands.pauseTimer(value.id)); break
      case 'resume': void run(() => commands.resumeTimer(value.id)); break
      case 'finish': void run(() => commands.finishTimer(value.id)); break
      case 'archive': void run(() => commands.archiveEvent(value.id)); break
      case 'duration': workspace.nameDialog('修改耗时（秒）', String(events.elapsed(value.event)), seconds => run(() => commands.setAttribute(value.event.system.source_id, '耗时', seconds === '' ? null : `${seconds}s`)), true); break
      case 'score': workspace.rating('选择评分', score => run(() => commands.setAttribute(value.event.system.source_id, '评分', score))); break
      case 'review': workspace.review(value.events, value.name); break
      case 'templates': void openTemplates(); break
    }
  })
  root.addEventListener('change', event => {if (event.target.id === 'view-select') void run(() => commands.switchView(event.target.value ? Number(event.target.value) : null))})
  root.addEventListener('input', event => {if (event.target.id === 'search') workspace.search(event.target.value)})
}
