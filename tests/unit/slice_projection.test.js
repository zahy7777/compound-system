import test from 'node:test'
import assert from 'node:assert/strict'
import {sliceProjection} from '../../frontend/shell/projection/slices.js'

test('切片末尾投影保留基础全集与森林身份，独立重算成员及汇总', () => {
  const event = (id, slice, seconds) => ({system:{source_id:id},meta:slice ? [{kind:'区域切片',text:slice}] : [],seconds})
  const a = event(1,null,2), b = event(2,'训练',3), orphan = event(3,'丢失',5)
  const totals = members => ({elapsedMs:members.reduce((sum,value) => sum + value.seconds * 1000,0),score:members.length})
  const node = (name,members,children = [],path = [1]) => ({name,tag:{kind:path === null ? '闭环' : '业务区域',text:name},tags:[{kind:'业务区域',text:'待办'}],path,is_fold:true,loopOrder:[],members,direct:children.length ? [] : members,review:members,totals:totals(members),children})
  const loop = node('同一闭环',[a,b,orphan],[],null), empty = {...node('显式空闭环',[],[],[1,0]),tag:{kind:'闭环',text:'空闭环'}}
  const structure = {areas:[node('结果',[b]),node('待办',[a,b,orphan],[loop,empty]),node('运行',[]),node('归档',[])],events:[a,b,orphan],resultEvents:[{event:b,label:'原结果'}],views:[],currentView:null}
  const before = structuredClone(structure)
  const result = sliceProjection(structure,['训练','福利'],{tags:(event,kind) => event.meta.filter(tag => tag.kind === kind).map(tag => tag.text)},totals)
  assert.deepEqual(structure,before)
  for (const key of ['areas','events','resultEvents','views']) assert.equal(result[key],structure[key])
  assert.deepEqual(result.missingSlices,['丢失'])
  assert.deepEqual(result.slicePanels.map(panel => panel.name),['小事','训练','福利'])
  const [defaults,training,welfare] = result.slicePanels.map(panel => panel.areas.find(area => area.name === '待办'))
  assert.deepEqual(defaults.members,[a,orphan]); assert.deepEqual(defaults.totals,{elapsedMs:7000,score:2})
  assert.deepEqual(training.members,[b]); assert.deepEqual(training.totals,{elapsedMs:3000,score:1})
  assert.equal(defaults.children.length,2); assert.equal(training.children.length,1); assert.equal(welfare.children.length,0)
  assert.equal(training.children[0].path,loop.path); assert.equal(training.children[0].tags,loop.tags)
  assert.equal(training.children[0].loopOrder,loop.loopOrder); assert.equal(training.children[0].is_fold,true)
  assert.deepEqual(welfare.totals,{elapsedMs:0,score:0})
})
