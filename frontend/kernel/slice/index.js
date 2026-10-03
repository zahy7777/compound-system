export function createSlices(call) {
  function check(names) {
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name || name.trim() !== name || name.includes('\n') || name.includes('\r') || name === '小事') || new Set(names).size !== names.length) throw new Error('切片名称不能为空、重复、含首尾空白或换行，也不能使用“小事”')
  }
  return {read: () => call('/readslice', null), write: names => {check(names); return call('/writeslice', names)}, check}
}
