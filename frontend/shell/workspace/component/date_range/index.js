import {el} from '../button.js'

export function dateRange(area, value) {
  const select = el('select', undefined, 'date-range')
  select.dataset.dateArea = area; select.setAttribute('aria-label', `${area}日期范围`)
  for (const [key, name] of [['today','今天'],['week','本周'],['month','本月'],['quarter','本季度'],['all','全部']]) select.append(new Option(name, key))
  select.value = value
  return select
}
