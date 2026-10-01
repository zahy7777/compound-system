export function createForest(call) {
  const node = (kind, text) => ({tag: {kind, text}, children: []})
  const paths = (nodes, prefix = [], indices = []) => nodes.flatMap((value, index) => {
    const path = [...indices, index], tags = [...prefix, value.tag]
    return [{value, path, tags}, ...paths(value.children, tags, path)]
  })
  const locate = (forest, path) => path.reduce((current, index) => current[index].children, forest)
  const at = (forest, path) => path.slice(0, -1).reduce((current, index) => current[index].children, forest)[path.at(-1)]
  const itemOnly = nodes => nodes.filter(value => value.tag.kind === '复利事项').map(value => ({tag: {...value.tag}, children: itemOnly(value.children)}))
  const edit = (forest, change) => {const next = structuredClone(forest); change(next); return next}
  return {
    read: query => call('/readforest', query), write: records => call('/writeforest', records), node, paths, at, itemOnly,
    defaults: () => ['结果', '待办', '运行', '归档'].map(text => node('业务区域', text)),
    add: (forest, path, tag) => edit(forest, next => locate(next, path).push({tag: {...tag}, children: []})),
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
