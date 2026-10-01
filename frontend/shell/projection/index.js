export function createProjection(forest, events) {
  return {async read() {
    const memory = await forest.read({workspace: true, item_templates: null})
    const nodes = memory.workspace?.forest ?? forest.defaults(), entries = forest.paths(nodes)
    const results = await events.read([[], ...entries.map(entry => entry.tags)])
    const matches = new Map(entries.map((entry, index) => [JSON.stringify(entry.path), results[index + 1]]))
    function build(value, path, prefix = []) {
      const tags = [...prefix, value.tag], members = matches.get(JSON.stringify(path)) ?? []
      const children = value.children.map((child, index) => build(child, [...path, index], tags))
      const nested = new Set(children.flatMap(child => child.members.map(event => event.system.source_id)))
      let direct = members.filter(event => !nested.has(event.system.source_id))
      // 森林没有显式节点的闭环，按正式 event 标签生成展示组，不写回森林。
      if (value.tag.kind !== '闭环' && !tags.some(tag => tag.kind === '业务区域' && tag.text === '结果')) {
        const loops = new Map()
        for (const event of direct) {const loop = events.loop(event); if (loop && !loops.has(loop.id)) loops.set(loop.id, loop)}
        for (const loop of loops.values()) {
          const grouped = direct.filter(event => events.loop(event)?.id === loop.id)
          children.push({tag: {kind: '闭环', text: loop.text}, path: null, tags: [...tags, {kind: '闭环', text: loop.text}], members: grouped, direct: grouped, children: [], name: loop.name, loop})
        }
        direct = direct.filter(event => !events.loop(event))
      }
      if (tags.some(tag => tag.kind === '业务区域' && tag.text === '结果')) direct = direct.filter(event => event.user.event !== '')
      const loopOrder = children.filter(child => child.tag.kind === '闭环').map(child => child.tag)
      for (const child of children) child.loopOrder = loopOrder
      return {tag: value.tag, path, tags, members, direct, children, review: members, name: value.tag.kind === '闭环' ? events.loopTag(value.tag.text).name : value.tag.text, loop: value.tag.kind === '闭环' ? events.loopTag(value.tag.text) : null}
    }
    const resultEvents = results[0].filter(event => events.tags(event, '业务区域')[0] === '结果').map(event => {
      let labels = []
      for (const entry of entries) {
        const items = entry.tags.filter(tag => tag.kind === '复利事项').map(tag => tag.text)
        if (items.length > labels.length && items.every(text => events.tags(event, '复利事项').includes(text))) labels = items
      }
      return {event, label: (labels.length ? labels : events.tags(event, '复利事项')).join(' / ')}
    })
    const todayMs = resultEvents.filter(({event}) => events.attribute(event, '日期') === events.today()).reduce((total, {event}) => total + events.elapsed(event) * 1000, 0)
    return {areas: nodes.map((value, index) => build(value, [index])), events: results[0], resultEvents, todayMs, views: memory.item_templates, currentView: memory.workspace?.item_template_id ?? null}
  }}
}
