export function createCommands(events, forest, templates, timer, keyOf) {
  const current = async id => {const [all] = await events.read([[]]); const event = all.find(value => value.system.source_id === id); if (!event) throw new Error('小事已不存在，请刷新'); return event}
  const memory = async () => {const value = await forest.read({workspace: true, item_templates: null}); return {...value, workspace: value.workspace ?? {item_template_id: null, forest: forest.defaults()}}}
  const saveForest = (value, next, sync) => forest.write(forest.workspaceRecord(value, next, sync))
  async function writeEvent(id, changes, timerState = null) {
    const previous = id === null ? null : await current(id)
    const elapsedMs = changes.elapsedMs ?? (timerState === 'reset' ? (await timer.write(keyOf(id), 'paused')).elapsed_ms : undefined)
    let record = previous ? events.version(previous, changes) : events.create(changes.text, changes.meta)
    if (!previous && !events.attribute(record, '日期')) record.meta = events.setAttribute(record, '日期', events.today())
    if (elapsedMs !== undefined) record.meta = events.addElapsed({...record, meta: events.setAttribute(record, '耗时', `${events.elapsed(previous)}s`)}, elapsedMs)
    if (previous && timerState === 'running') await timer.write(keyOf(id), 'running')
    const [identity] = await events.write([record])
    if (timerState && !(previous && timerState === 'running')) {
      try {await timer.write(keyOf(identity.source_id), timerState)}
      catch (error) {throw new Error(`事实已保存，计时状态写入失败，勿重复提交：${error.message}`)}
    }
    return identity
  }
  return {
    writeEvent,
    writeTimer: (id, state) => timer.write(keyOf(id), state),
    async writeEventTags(ids, replacements) {
      const [all] = await events.read([[]]), selected = new Set(ids)
      const records = all.filter(event => selected.has(event.system.source_id)).map(event => {
        let meta = event.meta
        for (const [kind, texts] of Object.entries(replacements)) meta = events.replace(meta, kind, texts)
        return events.version(event, {meta})
      })
      if (records.length) await events.write(records)
    },
    async moveItem(from, to, position) {
      const value = await memory(), moved = forest.move(value.workspace.forest, from, to, position)
      const [members] = await events.read([moved.before])
      const before = moved.before.filter(tag => tag.kind === '复利事项').map(tag => tag.text), after = moved.after.filter(tag => tag.kind === '复利事项').map(tag => tag.text)
      if (members.length) await events.write(members.map(event => events.version(event, {meta: events.replace(event.meta, '复利事项', [...after, ...events.tags(event, '复利事项').filter(text => !before.includes(text))])})))
      try {await saveForest(value, moved.forest, true)} catch (error) {throw new Error(`${members.length ? '成员已迁移，' : ''}森林保存失败：${error.message}`)}
    },
    async reorderLoops(area, tags, source, target, position) {const value = await memory(); await saveForest(value, forest.reorderLoops(value.workspace.forest, area, tags, source, target, position), false)},
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
