export function sliceCommands(events, slices) {
  async function replace(name, target, names) {
    slices.check(names)
    const [members] = await events.read([[{kind: '区域切片', text: name}]])
    if (members.length) await events.write(members.map(event => events.version(event, {meta: events.replace(event.meta, '区域切片', target === null ? [] : [target])})))
    try {await slices.write(names)}
    catch (error) {throw new Error(`小事已更新，切片列表保存失败：${error.message}`)}
  }
  return {
    async createSlice(after, name) {
      const names = await slices.read(), index = after === null ? -1 : names.indexOf(after)
      if (after !== null && index === -1) throw new Error('切片已不存在，请刷新')
      names.splice(index + 1, 0, name)
      await slices.write(names)
    },
    async renameSlice(name, target) {
      const names = await slices.read(), index = names.indexOf(name)
      if (index === -1) throw new Error('切片已不存在，请刷新')
      names[index] = target
      await replace(name, target, names)
    },
    async deleteSlice(name) {
      const names = await slices.read()
      if (!names.includes(name)) throw new Error('切片已不存在，请刷新')
      await replace(name, null, names.filter(value => value !== name))
    },
  }
}
