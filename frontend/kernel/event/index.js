export function createEvents(call, kinds) {
  const patterns = Object.fromEntries(Object.entries(kinds['属性'].patterns).map(([name, rule]) => [name, new RegExp(rule.pattern.replaceAll('(?P<', '(?<'))]))
  const loopRule = Object.values(kinds['闭环'].patterns)[0]
  const loopPattern = new RegExp(loopRule.pattern.replaceAll('(?P<', '(?<'))
  const tags = (event, kind) => event.meta.filter(tag => tag.kind === kind).map(tag => tag.text)
  const version = (event, changes = {}) => ({system: {source_id: event.system.source_id, deleted: changes.deleted ?? false}, user: {event: changes.text ?? event.user.event}, meta: structuredClone(changes.meta ?? event.meta)})
  const replace = (meta, kind, texts) => [...meta.filter(tag => tag.kind !== kind), ...[...new Set(texts)].map(text => ({kind, text}))]
  const attribute = (event, name) => {
    const tag = event.meta.find(tag => tag.kind === '属性' && patterns[name].test(tag.text))
    return tag ? patterns[name].exec(tag.text).groups.value : null
  }
  const setAttribute = (event, name, value) => [...event.meta.filter(tag => !(tag.kind === '属性' && patterns[name].test(tag.text))), ...(value === null || value === '' ? [] : [{kind: '属性', text: `${name}:${value}`}])]
  return {
    read: sets => call('/readevent', sets), write: values => call('/writeevent', values), tags, version, replace, attribute, setAttribute,
    create: (text, meta) => ({system: {source_id: null, deleted: false}, user: {event: text}, meta: structuredClone(meta)}),
    loop: event => {const text = tags(event, '闭环')[0]; return text ? {text, ...loopPattern.exec(text).groups} : null},
    loopText: (id, name) => loopRule.template.replace('{id}', id).replace('{name}', name),
    loopTag: text => ({text, ...loopPattern.exec(text).groups}),
    elapsed: event => Number(attribute(event, '耗时') ?? 0),
    addElapsed: (event, ms) => setAttribute(event, '耗时', `${Number((Number(attribute(event, '耗时') ?? 0) + ms / 1000).toFixed(6))}s`),
  }
}
