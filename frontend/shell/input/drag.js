export function bindDrag(root, workspace, submit) {
  let source = null
  function destination(event) {
    const element = event.target.closest('[data-drop]')
    if (!source || !element) return null
    const target = workspace.context(element.dataset.drop)
    if (target.kind === 'item') {
      if (source.kind === 'item') {
        if (source.area !== '结果') return null
        if (source.path.every((index, depth) => target.path[depth] === index)) return null
        const bounds = element.getBoundingClientRect(), offset = event.clientY - bounds.top, edge = Math.min(9, bounds.height * .25)
        return {element, target, position: offset < edge ? 'before' : offset > bounds.height - edge ? 'after' : 'inside'}
      }
      if (source.area !== '结果' && source.area !== '归档') return null
      if (source.kind === 'event' && source.area === '结果' && JSON.stringify([...source.items].sort()) === JSON.stringify([...target.items].sort())) return null
      return {element, target, position: 'inside'}
    }
    if (target.kind !== 'loop' || source.area !== target.area) return null
    if (source.kind === 'event') return source.loop === target.tag.text ? null : {element, target, position: 'inside'}
    if (source.kind !== 'loop' || source.tag.text === target.tag.text) return null
    const bounds = element.getBoundingClientRect()
    return {element, target, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'}
  }
  root.addEventListener('dragstart', event => {
    const element = event.target.closest('[data-drag]')
    const control = event.target.closest('button,input,textarea')
    if (!element || (control && !control.matches('.branch-name')) || root.classList.contains('saving')) {event.preventDefault(); return}
    source = workspace.context(element.dataset.drag); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', source.kind)
  })
  root.addEventListener('dragover', event => {
    const landing = destination(event); workspace.clearDrop()
    if (!landing) return
    event.preventDefault(); event.dataTransfer.dropEffect = 'move'; workspace.showDrop(landing.element, landing.position)
  })
  root.addEventListener('dragleave', event => {if (!root.contains(event.relatedTarget)) workspace.clearDrop()})
  root.addEventListener('drop', event => {
    const found = destination(event); if (found) {event.preventDefault(); void submit(source, found.target, found.position)}
    source = null; workspace.clearDrop()
  })
  root.addEventListener('dragend', () => {source = null; workspace.clearDrop()})
}
