export function createForest(call) {
  const node = (kind, text) => ({tag: {kind, text}, is_fold: false, children: []})
  const paths = (nodes, prefix = [], indices = []) => nodes.flatMap((value, index) => {
    const path = [...indices, index], tags = [...prefix, value.tag]
    return [{value, path, tags}, ...paths(value.children, tags, path)]
  })
  const locate = (forest, path) => path.reduce((current, index) => current[index].children, forest)
  const at = (forest, path) => path.slice(0, -1).reduce((current, index) => current[index].children, forest)[path.at(-1)]
  const itemOnly = nodes => nodes.filter(value => value.tag.kind === '复利事项').map(value => ({tag: {...value.tag}, is_fold: value.is_fold ?? false, children: itemOnly(value.children)}))
  const edit = (forest, change) => {const next = structuredClone(forest); change(next); return next}
  return {
    read: query => call('/readforest', query), write: records => call('/writeforest', records), node, paths, at, itemOnly,
    defaults: () => ['结果', '待办', '运行', '归档'].map(text => node('业务区域', text)),
    add: (forest, path, tag) => edit(forest, next => locate(next, path).push(node(tag.kind, tag.text))),
    setFold: (forest, tags, isFold, order = []) => edit(forest, next => {
      const find = tags => paths(next).find(entry => JSON.stringify(entry.tags) === JSON.stringify(tags))?.value
      let target = find(tags)
      if (!target && tags.at(-1).kind === '闭环') {
        const parent = find(tags.slice(0, -1))
        if (!parent) throw new Error('分支已不存在，请刷新')
        const loops = order.map(tag => parent.children.find(child => child.tag.kind === '闭环' && child.tag.text === tag.text) ?? node(tag.kind, tag.text))
        parent.children = [...parent.children.filter(child => child.tag.kind !== '闭环'), ...loops]
        target = find(tags)
      }
      if (!target) throw new Error('分支已不存在，请刷新')
      target.is_fold = isFold
    }),
    move: (forest, from, to, position) => {
      if (from.every((index, depth) => to[depth] === index)) throw new Error('不能移动到自己或自己的后代')
      const next = structuredClone(forest), source = at(next, from), target = at(next, to)
      const before = paths(next).find(entry => entry.value === source).tags
      const parent = locate(next, from.slice(0, -1)), destination = position === 'inside' ? target.children : locate(next, to.slice(0, -1))
      parent.splice(parent.indexOf(source), 1)
      destination.splice(position === 'inside' ? destination.length : destination.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
      return {forest: next, before, after: paths(next).find(entry => entry.value === source).tags}
    },
    reorderLoops: (forest, area, tags, source, target, position) => edit(forest, next => {
      const root = next.find(value => value.tag.kind === '业务区域' && value.tag.text === area)
      const ordered = tags.map(tag => root.children.find(value => value.tag.kind === '闭环' && value.tag.text === tag.text) ?? node(tag.kind, tag.text))
      const moved = ordered.splice(ordered.findIndex(value => value.tag.text === source), 1)[0]
      ordered.splice(ordered.findIndex(value => value.tag.text === target) + (position === 'after' ? 1 : 0), 0, moved)
      root.children = [...root.children.filter(value => value.tag.kind !== '闭环'), ...ordered]
    }),
    rename: (forest, tag, text) => edit(forest, next => {for (const entry of paths(next)) if (entry.value.tag.kind === tag.kind && entry.value.tag.text === tag.text) entry.value.tag.text = text}),
    remove: (forest, tag) => edit(forest, next => {
      function prune(nodes) {for (let i = nodes.length - 1; i >= 0; i--) {if (nodes[i].tag.kind === tag.kind && nodes[i].tag.text === tag.text) nodes.splice(i, 1); else prune(nodes[i].children)}}
      prune(next)
    }),
    switchItems: (forest, items) => edit(forest, next => {const root = next.find(value => value.tag.kind === '业务区域' && value.tag.text === '结果'); root.children = [...root.children.filter(value => value.tag.kind !== '复利事项'), ...structuredClone(items)]}),
    workspaceRecord: (memory, forest, sync = false) => {
      const record = {workspace: {item_template_id: memory.workspace?.item_template_id ?? null, forest}}
      const current = memory.item_templates.find(value => value.id === record.workspace.item_template_id)
      if (sync && current) record.item_templates = [{id: current.id, deleted: false, name: current.name, forest: itemOnly(forest.find(value => value.tag.text === '结果').children)}]
      return record
    },
  }
}
