import test from 'node:test'
import assert from 'node:assert/strict'
import {createWatchSnapshot} from '../../frontend/shell/watch_snapshot/index.js'

const event = (id, title) => ({system: {source_id: id}, user: {event: title}})
const node = (kind, name, {direct = [], members = direct, children = [], loop = null} = {}) => ({
  tag: {kind, text: name}, name, direct, members, children, loop,
})

test('watch snapshot exposes active results, direct tasks, loops, and todo', () => {
  const timers = new Map([
    ['1', {state: 'running', elapsed: 1200}],
    ['2', {state: 'paused', elapsed: 4000}],
  ])
  const timer = {
    snapshot: key => timers.has(key) ? {state: timers.get(key).state, elapsed_ms: timers.get(key).elapsed} : undefined,
    elapsed: key => timers.get(key)?.elapsed ?? 0,
  }
  const result = event(1, '长期结果')
  const direct = event(2, '无闭环小事')
  const loopItem = event(3, '闭环内小事')
  const todo = event(4, '下一件待办')
  const structure = {
    resultEvents: [{event: result, label: '结果'}],
    areas: [
      node('业务区域', '运行', {children: [
        node('复利事项', '事项', {direct: [direct], children: [node('闭环', '闭环', {members: [loopItem], loop: {id: 'loop-1'}})]}),
      ]}),
      node('业务区域', '待办', {direct: [todo]}),
    ],
  }

  const snapshot = createWatchSnapshot(structure, timer, String)
  assert.equal(snapshot.resultTimers[0].title, '长期结果')
  assert.equal(snapshot.running.direct[0].title, '无闭环小事')
  assert.deepEqual(snapshot.running.loops[0], {
    id: 'loop-1', name: '闭环', items: [{id: '3', title: '闭环内小事', elapsedMs: 0, timerState: 'idle'}],
  })
  assert.equal(snapshot.todo.direct[0].title, '下一件待办')
})
