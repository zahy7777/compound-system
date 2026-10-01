export function createCommands(events, forest, templates, timer, keyOf) {
  const current = async id => {const [all] = await events.read([[]]); const event = all.find(value => value.system.source_id === id); if (!event) throw new Error('小事已不存在，请刷新'); return event}
  const memory = async () => {const value = await forest.read({workspace: true, item_templates: null}); return {...value, workspace: value.workspace ?? {item_template_id: null, forest: forest.defaults()}}}
  const saveForest = (value, next, sync) => forest.write(forest.workspaceRecord(value, next, sync))
  async function finish(id, archive = false) {
    const event = await current(id), key = keyOf(id), snapshot = await timer.write(key, 'paused')
    let meta = events.addElapsed(event, snapshot.elapsed_ms)
    if (archive) meta = events.replace(meta, '业务区域', ['归档'])
    await events.write([events.version(event, {meta})])
    try {await timer.write(key, 'reset')} catch (error) {throw new Error(`小事已保存，但计时重置失败。请刷新后重置计时，勿重复结算：${error.message}`)}
  }
  return {
    async createEvent(draft, start = false) {let record = events.create(draft.text, draft.meta); if (!events.attribute(record, '日期')) record = {...record, meta: events.setAttribute(record, '日期', events.today())}; const result = await events.write([record]); if (start) await timer.write(keyOf(result[0].source_id), 'running')},
    async editEvent(id, draft) {const event = await current(id); await events.write([events.version(event, {text: draft.text, meta: draft.meta ?? event.meta})])},
    async deleteEvent(id) {const event = await current(id); await events.write([events.version(event, {deleted: true})])},
    async setAttribute(id, name, value) {const event = await current(id); await events.write([events.version(event, {meta: events.setAttribute(event, name, value)})])},
    async startTimer(id) {const event = await current(id); if (events.tags(event, '业务区域')[0] !== '运行') await events.write([events.version(event, {meta: events.replace(event.meta, '业务区域', ['运行'])})]); await timer.write(keyOf(id), 'running')},
    pauseTimer: id => timer.write(keyOf(id), 'paused'), resumeTimer: id => timer.write(keyOf(id), 'running'), finishTimer: id => finish(id), archiveEvent: id => finish(id, true),
    async createItem(path, name) {const value = await memory(); await saveForest(value, forest.add(value.workspace.forest, path, {kind: '复利事项', text: name}), true)},
    async createLoop(name) {const value = await memory(), root = value.workspace.forest.findIndex(node => node.tag.kind === '业务区域' && node.tag.text === '待办'); await saveForest(value, forest.add(value.workspace.forest, [root], {kind: '闭环', text: events.loopText(crypto.randomUUID().replaceAll('-', ''), name)}), false)},
    async renameTag(tag, name) {
      const value = await memory(), [all] = await events.read([[]])
      const loopId = tag.kind === '闭环' ? events.loopTag(tag.text).id : null
      const text = loopId ? events.loopText(loopId, name) : name
      const members = all.filter(event => loopId ? events.loop(event)?.id === loopId : events.tags(event, tag.kind).includes(tag.text))
      if (members.length) await events.write(members.map(event => events.version(event, {meta: events.replace(event.meta, tag.kind, events.tags(event, tag.kind).map(old => loopId || old === tag.text ? text : old))})))
      try {await saveForest(value, forest.rename(value.workspace.forest, tag, text), tag.kind === '复利事项')} catch (error) {throw new Error(`成员已改名，森林保存失败：${error.message}`)}
    },
    async deleteTag(tag, path) {
      const value = await memory(), [all] = await events.read([[]])
      const names = tag.kind === '复利事项' ? new Set(forest.paths([forest.at(value.workspace.forest, path)]).map(entry => entry.value.tag.text)) : null
      const members = all.filter(event => names ? events.tags(event, '复利事项').some(name => names.has(name)) : events.loop(event)?.id === events.loopTag(tag.text).id)
      if (members.length) await events.write(members.map(event => events.version(event, {deleted: true})))
      try {await saveForest(value, forest.remove(value.workspace.forest, tag), tag.kind === '复利事项')} catch (error) {throw new Error(`成员已删除，森林保存失败：${error.message}`)}
    },
    async createView(name) {const value = await memory(), result = await forest.write({item_templates: [{id: null, deleted: false, name, forest: []}]}); await forest.write({workspace: {item_template_id: result.item_templates[0].id, forest: forest.switchItems(value.workspace.forest, [])}})},
    async switchView(id) {const value = await memory(), selected = value.item_templates.find(record => record.id === id); await forest.write({workspace: {item_template_id: id, forest: forest.switchItems(value.workspace.forest, selected?.forest ?? [])}})},
    saveLoopTemplate: (id, name, texts) => templates.write([templates.draft(name, texts, id)]),
    async deleteLoopTemplate(id) {const [record] = await templates.read([id]); await templates.write([{id, deleted: true, events: record.events}])},
    async useLoopTemplate(id) {const [record] = await templates.read([id]), text = events.loopText(crypto.randomUUID().replaceAll('-', ''), templates.name(record)); await events.write(record.events.map(draft => events.create(draft.user.event, [{kind: '业务区域', text: '待办'}, {kind: '闭环', text}, {kind: '属性', text: `日期:${events.today()}`}])))} ,
  }
}
