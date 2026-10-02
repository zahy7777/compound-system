import test from 'node:test'
import assert from 'node:assert/strict'
import {createCommands} from '../../frontend/shell/commands/index.js'

function harness() {
  let event = {system: {source_id: 7, deleted: false}, user: {event: '手表小事'}, meta: [{kind: '业务区域', text: '待办'}, {kind: '属性', text: '耗时:2s'}]}
  const timerCalls = []
  const replace = (meta, kind, texts) => [...meta.filter(tag => tag.kind !== kind), ...texts.map(text => ({kind, text}))]
  const elapsed = value => Number(value.meta.find(tag => tag.kind === '属性' && tag.text.startsWith('耗时:'))?.text.slice(3, -1) ?? 0)
  const setElapsed = (value, seconds) => replace(value.meta, '属性', [`耗时:${seconds}s`])
  const events = {
    read: async () => [[event]],
    write: async ([value]) => { event = {...value, system: {...value.system, source_id: 7}}; return [{source_id: 7}] },
    version: (value, changes) => ({system: {source_id: value.system.source_id, deleted: changes.deleted ?? false}, user: {event: changes.text ?? value.user.event}, meta: structuredClone(changes.meta ?? value.meta)}),
    replace,
    attribute: (value, name) => name === '耗时' ? String(elapsed(value)) : null,
    elapsed,
    setAttribute: (value, name, raw) => name === '耗时' ? setElapsed(value, Number(String(raw).slice(0, -1))) : value.meta,
    addElapsed: (value, ms) => setElapsed(value, elapsed(value) + ms / 1000),
    today: () => '2026-10-02',
  }
  const states = new Map()
  const timer = {
    read: async keys => keys.map(key => states.get(key) ?? null),
    write: async (key, state) => {
      timerCalls.push([key, state])
      const value = {key, state: state === 'reset' ? 'paused' : state, elapsed_ms: state === 'paused' ? 1500 : 0}
      states.set(key, value)
      return value
    },
  }
  const commands = createCommands(events, {}, {}, timer, String)
  return {commands, timerCalls, event: () => event}
}

test('Watch运行动作复用command移动事实并启动计时', async () => {
  const value = harness()
  await value.commands.run(7)
  assert.equal(value.event().meta.find(tag => tag.kind === '业务区域').text, '运行')
  assert.deepEqual(value.timerCalls, [['7', 'running']])
})

test('Watch归档动作按暂停、累计耗时、写事实、reset顺序执行', async () => {
  const value = harness()
  await value.commands.run(7)
  value.timerCalls.length = 0
  await value.commands.archive(7)
  assert.equal(value.event().meta.find(tag => tag.kind === '业务区域').text, '归档')
  assert.equal(value.event().meta.find(tag => tag.text.startsWith('耗时:')).text, '耗时:3.5s')
  assert.deepEqual(value.timerCalls, [['7', 'paused'], ['7', 'reset']])
})
