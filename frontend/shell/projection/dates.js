export function datesInRange(range, today) {
  if (!range || range === 'all') return null
  const [year, month, day] = today.split('-').map(Number), end = new Date(year, month - 1, day, 12), start = new Date(end)
  if (range === 'week') start.setDate(day - (end.getDay() + 6) % 7)
  if (range === 'month') start.setDate(1)
  if (range === 'quarter') {start.setDate(1); start.setMonth(Math.floor((month - 1) / 3) * 3)}
  // 查询当前自然周/月/季度的全部日期，包含已登记的未来日期。
  if (range === 'week') {end.setTime(start.getTime()); end.setDate(start.getDate() + 6)}
  if (range === 'month') end.setMonth(month, 0)
  if (range === 'quarter') end.setMonth(start.getMonth() + 3, 0)
  const dates = []
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`)
  return dates
}
