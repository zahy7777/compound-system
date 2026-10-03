function item(event, timer, keyOf) {
  const key = keyOf(event.system.source_id), snapshot = timer.snapshot(key)
  return {id: key, title: event.user.event || '尚未填写正文', elapsedMs: timer.elapsed(key), timerState: snapshot?.state ?? 'idle'}
}

function areaSnapshot(area, timer, keyOf, matches = () => true, excludedLoops = new Set()) {
  const direct = [], loops = []
  function visit(node) {
    if (node.tag.kind === '闭环') {
      if (excludedLoops.has(String(node.loop?.id ?? node.tag.text))) return
      loops.push({id: String(node.loop?.id ?? node.tag.text), name: node.name || '未命名闭环', items: node.members.filter(matches).map(event => item(event, timer, keyOf))})
      return
    }
    direct.push(...node.direct.filter(matches).map(event => item(event, timer, keyOf)))
    node.children.forEach(visit)
  }
  visit(area)
  return {direct, loops}
}

export function createWatchSnapshot(structure, timer, keyOf) {
  const resultTimers = structure.resultEvents.flatMap(({event, label}) => {
    const value = item(event, timer, keyOf)
    if (value.timerState === 'idle' || (value.timerState === 'paused' && !value.elapsedMs)) return []
    return [{...value, title: event.user.event || label || '未命名计时'}]
  })
  const area = name => structure.areas.find(value => value.name === name)
  const environment = globalThis.location?.pathname.includes('/prod/') ? 'PROD' : 'DEV'
  const slicedLoops = new Set()
  function collect(node) {
    if (node.tag.kind === '闭环' && node.members.some(event => event.meta?.some(tag => tag.kind === '区域切片'))) {
      slicedLoops.add(String(node.loop?.id ?? node.tag.text))
    }
    node.children.forEach(collect)
  }
  collect(area('待办'))
  const todoPages = structure.slicePanels.map(panel => ({name: panel.slice ?? '默认待办', slice: panel.slice,
    area: areaSnapshot(panel.areas.find(value => value.name === '待办'), timer, keyOf,
      event => (event.meta?.find(tag => tag.kind === '区域切片')?.text ?? null) === panel.slice,
      panel.slice === null ? slicedLoops : new Set())}))
  return {environment, generatedAt: Date.now() / 1000, resultTimers, running: areaSnapshot(area('运行'), timer, keyOf), todo: areaSnapshot(area('待办'), timer, keyOf), todoPages}
}

export function postWatchSnapshot(snapshot) {
  window.webkit?.messageHandlers?.compoundWatchSnapshot?.postMessage(snapshot)
}
