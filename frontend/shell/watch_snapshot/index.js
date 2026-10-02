function item(event, timer, keyOf) {
  const key = keyOf(event.system.source_id), snapshot = timer.snapshot(key)
  return {id: key, title: event.user.event || '尚未填写正文', elapsedMs: timer.elapsed(key), timerState: snapshot?.state ?? 'idle'}
}

function areaSnapshot(area, timer, keyOf) {
  const direct = [], loops = []
  function visit(node) {
    if (node.tag.kind === '闭环') {
      loops.push({id: String(node.loop?.id ?? node.tag.text), name: node.name || '未命名闭环', items: node.members.map(event => item(event, timer, keyOf))})
      return
    }
    direct.push(...node.direct.map(event => item(event, timer, keyOf)))
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
  return {generatedAt: Date.now() / 1000, resultTimers, running: areaSnapshot(area('运行'), timer, keyOf), todo: areaSnapshot(area('待办'), timer, keyOf)}
}

export function postWatchSnapshot(snapshot) {
  window.webkit?.messageHandlers?.compoundWatchSnapshot?.postMessage(snapshot)
}
