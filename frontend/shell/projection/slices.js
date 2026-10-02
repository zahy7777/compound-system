// 二次投影只裁切展示成员，原森林身份、标签路径与闭环顺序原样保留。
export function sliceProjection(structure, names, events, totals) {
  const known = new Set(names), sliceOf = event => events.tags(event, '区域切片')[0] ?? null
  const missingSlices = [...new Set(structure.events.filter(event => !events.tags(event, '业务区域').includes('结果')).map(sliceOf).filter(name => name !== null && !known.has(name)))]
  function panel(slice) {
    const matches = event => slice === null ? !known.has(sliceOf(event)) : sliceOf(event) === slice
    function filter(node) {
      const members = node.members.filter(matches), children = node.children.flatMap(child => {
        const projected = filter(child)
        return projected.members.length || (slice === null && child.path !== null && !child.members.length) ? [projected] : []
      })
      return {...node, members, direct: node.direct.filter(matches), review: node.review?.filter(matches) ?? members, totals: totals(members), children}
    }
    return {slice, name: slice ?? '小事', areas: structure.areas.filter(area => area.name !== '结果').map(filter)}
  }
  return {...structure, slicePanels: [null, ...names].map(panel), missingSlices}
}
