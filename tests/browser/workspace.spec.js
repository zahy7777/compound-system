import {test, expect} from '@playwright/test'
const area = (page, name) => page.locator(`.area[data-area="${name}"]`)
const item = (page, name) => page.locator(`.item[data-item="${name}"]`)
const card = (page, text) => page.locator('.event').filter({has: page.locator('.event-body', {hasText: text})})
const dialog = page => page.locator('dialog[open]').last()
async function named(page, target, value) {await target.click(); await dialog(page).locator('input').fill(value); await dialog(page).getByRole('button',{name:'确定',exact:true}).click(); await expect(page.locator('#message')).toHaveText('已保存'); await expect(page.locator('dialog')).toHaveCount(0)}
async function confirmed(page, target) {await target.click(); await dialog(page).getByRole('button',{name:'确定',exact:true}).click(); await expect(page.locator('#message')).toHaveText('已保存'); await expect(page.locator('dialog')).toHaveCount(0)}
async function record(page, target, text, attributes = '', score = null) {
  await target.locator('..').hover(); await target.click(); await page.getByLabel('小事正文',{exact:true}).fill(text)
  if (attributes) {await dialog(page).locator('summary').click(); await page.getByLabel('属性标签').fill(attributes)}
  await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click(); await dialog(page).getByRole('button',{name:score ? `${score} · 挺好` : '不评分，完成',exact:true}).click(); await expect(page.locator('#message')).toHaveText('已保存'); await expect(page.locator('dialog')).toHaveCount(0)
}
const allowed = ['/writeevent','/readevent','/writeforest','/readforest','/writelooptemplate','/readlooptemplate','/writetimer','/readtimer']
let errors, requests

test.beforeEach(async ({page,request}) => {
  errors=[]; requests=[]; page.on('pageerror',error => errors.push(error.message)); page.on('request',request => {if(request.method()==='POST') requests.push(new URL(request.url()).pathname)})
  await page.addInitScript(() => {for(const name of ['prompt','confirm','alert']) window[name]=() => {throw new Error('禁止原生弹窗')}})
  const [events]=await (await request.post('/readevent',{data:[[]]})).json()
  if(events.length) await request.post('/writeevent',{data:events.map(event => ({system:{source_id:event.system.source_id,deleted:true},user:event.user,meta:event.meta}))})
  const memory=await (await request.post('/readforest',{data:{workspace:true,item_templates:null}})).json()
  await request.post('/writeforest',{data:{workspace:{item_template_id:null,forest:['结果','待办','运行','归档'].map(text => ({tag:{kind:'业务区域',text},children:[]}))},item_templates:memory.item_templates.map(value => ({id:value.id,deleted:true,name:value.name,forest:value.forest}))}})
  const templates=await (await request.post('/readlooptemplate',{data:null})).json()
  if(templates.length) await request.post('/writelooptemplate',{data:templates.map(value => ({id:value.id,deleted:true,events:value.events}))})
  await page.goto('/'); await expect(page.locator('#message')).toHaveText('已读取')
})
test.afterEach(async () => {expect(errors).toEqual([]); expect(requests.every(path => allowed.includes(path))).toBe(true)})

test('小事创建评分编辑耗时删除，属性保留',async ({page,request}) => {
  await record(page,area(page,'待办').getByRole('button',{name:'新增待办',exact:true}),'读一章','备注:保留这条属性',4)
  await card(page,'读一章').getByRole('button',{name:'修改事实',exact:true}).click(); await page.getByLabel('小事正文',{exact:true}).fill('读两章'); await dialog(page).locator('summary').click(); await page.getByLabel('属性标签').fill('备注:保留这条属性\n评分:4\n耗时:12.5s'); await dialog(page).getByRole('button',{name:'保存修改',exact:true}).click(); await expect(card(page,'读两章')).toHaveCount(1); const [edited]=await (await request.post('/readevent',{data:[[]]})).json(); expect(edited[0].meta).toEqual(expect.arrayContaining([{kind:'属性',text:'备注:保留这条属性'},{kind:'属性',text:'评分:4'},{kind:'属性',text:'耗时:12.5s'}]))
  await page.getByLabel('搜索',{exact:true}).fill('不存在的内容'); await expect(card(page,'读两章')).not.toBeVisible(); await page.getByLabel('搜索',{exact:true}).fill(''); await expect(card(page,'读两章')).toBeVisible()
  await confirmed(page,card(page,'读两章').getByRole('button',{name:'删除事实',exact:true})); expect((await (await request.post('/readevent',{data:[[]]})).json())[0]).toHaveLength(0)
})

test('两个独立计时器运行暂停继续结束归档，刷新和版本变更不换key',async ({page,request}) => {
  await record(page,area(page,'待办').getByRole('button',{name:'新增待办',exact:true}),'计时甲','耗时:2s',4)
  await record(page,area(page,'待办').getByRole('button',{name:'新增待办',exact:true}),'计时乙')
  const id=await card(page,'计时甲').getAttribute('data-source')
  await card(page,'计时甲').getByRole('button',{name:'移入运行',exact:true}).click(); await expect(area(page,'运行').locator('.event')).toHaveCount(1)
  await card(page,'计时乙').getByRole('button',{name:'移入运行',exact:true}).click(); await expect(area(page,'运行').locator('.event')).toHaveCount(2)
  const count=requests.length; await expect(card(page,'计时甲').locator('.timer-display')).not.toHaveText('0秒',{timeout:4000}); expect(requests).toHaveLength(count)
  await card(page,'计时甲').getByRole('button',{name:'暂停',exact:true}).click(); await expect(card(page,'计时甲').getByRole('button',{name:'继续',exact:true})).toBeVisible(); await expect(card(page,'计时乙').getByRole('button',{name:'暂停',exact:true})).toBeVisible()
  await page.reload(); await expect(page.locator('#message')).toHaveText('已读取'); await expect(card(page,'计时甲').getByRole('button',{name:'继续',exact:true})).toBeVisible()
  await card(page,'计时甲').getByRole('button',{name:'继续',exact:true}).click(); await card(page,'计时甲').getByRole('button',{name:'修改事实',exact:true}).click(); await page.getByLabel('小事正文',{exact:true}).fill('计时甲修订'); await dialog(page).getByRole('button',{name:'保存修改',exact:true}).click(); await expect(card(page,'计时甲修订')).toHaveAttribute('data-source',id)
  await card(page,'计时甲修订').getByRole('button',{name:'归档',exact:true}).click(); await expect(card(page,'计时甲修订').getByRole('button',{name:'移入运行',exact:true})).toBeVisible(); await expect(card(page,'计时甲修订')).toContainText('4分')
  await card(page,'计时乙').getByRole('button',{name:'归档',exact:true}).click(); await expect(area(page,'归档').locator('.event')).toHaveCount(2)
  const [all]=await (await request.post('/readevent',{data:[[]]})).json(); expect(Number(all.find(event => String(event.system.source_id)===id).meta.find(tag => tag.text.startsWith('耗时:')).text.slice(3,-1))).toBeGreaterThan(2)
})

test('嵌套事项、视图隔离、改名与跨区域分支删除',async ({page}) => {
  await named(page,page.getByRole('button',{name:'新增视图',exact:true}),'学习视图'); const view=await page.locator('#view-select').inputValue()
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'学习')
  await named(page,item(page,'学习').locator(':scope > .group-head').getByRole('button',{name:'新增子事项',exact:true}),'阅读')
  await record(page,item(page,'阅读').locator(':scope > .group-head').getByRole('button',{name:'记录一条',exact:true}),'读完一章')
  await item(page,'学习').locator(':scope > .group-head').getByRole('button',{name:'收起',exact:true}).click(); await expect(item(page,'阅读')).not.toBeVisible(); await item(page,'学习').locator(':scope > .group-head').getByRole('button',{name:'展开',exact:true}).click(); await expect(item(page,'阅读')).toBeVisible()
  await named(page,page.getByRole('button',{name:'新增视图',exact:true}),'运动视图'); await expect(item(page,'学习')).toHaveCount(0)
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'运动')
  await page.locator('#view-select').selectOption(view); await expect(item(page,'阅读')).toHaveCount(1); await expect(item(page,'运动')).toHaveCount(0)
  await named(page,item(page,'阅读').locator(':scope > .group-head').getByRole('button',{name:'重命名事项',exact:true}),'精读'); await expect(item(page,'精读').locator('.event')).toHaveCount(1)
  await card(page,'读完一章').getByRole('button',{name:'开始计时',exact:true}).click(); await expect(area(page,'运行').locator('.event')).toHaveCount(0); await expect(area(page,'结果').locator('.event')).toHaveCount(1)
  await page.reload(); await expect(item(page,'精读')).toHaveCount(1)
  await confirmed(page,item(page,'学习').locator(':scope > .group-head').getByRole('button',{name:'删除事项分支',exact:true})); await expect(page.locator('.event')).toHaveCount(0)
})

test('闭环同名隔离、改名、跨区域删除及刷新空节点',async ({page},testInfo) => {
  await named(page,area(page,'待办').getByRole('button',{name:'新增闭环',exact:true}),'每日闭环'); await named(page,area(page,'待办').getByRole('button',{name:'新增闭环',exact:true}),'每日闭环')
  const loops=area(page,'待办').locator('.loop'); await expect(loops).toHaveCount(2); expect(await loops.nth(0).getAttribute('data-loop')).not.toBe(await loops.nth(1).getAttribute('data-loop'))
  await record(page,loops.nth(0).getByRole('button',{name:'在闭环下新增待办',exact:true}),'闭环甲'); await record(page,loops.nth(1).getByRole('button',{name:'在闭环下新增待办',exact:true}),'闭环乙'); await page.screenshot({path:testInfo.outputPath('loops.png'),fullPage:true})
  await named(page,loops.nth(0).getByRole('button',{name:'重命名闭环',exact:true}),'新闭环名'); await card(page,'闭环甲').getByRole('button',{name:'移入运行',exact:true}).click(); await expect(area(page,'运行').locator('.loop')).toHaveCount(1)
  await confirmed(page,area(page,'待办').locator('.loop').filter({hasText:'新闭环名'}).getByRole('button',{name:'删除闭环组',exact:true})); await expect(card(page,'闭环甲')).toHaveCount(0); await expect(card(page,'闭环乙')).toHaveCount(1)
  await named(page,area(page,'待办').getByRole('button',{name:'新增闭环',exact:true}),'空闭环'); await page.reload(); await expect(area(page,'待办')).toContainText('空闭环')
})

test('模板草稿一键保存、编辑、重复实例化及删除',async ({page},testInfo) => {
  await page.getByRole('button',{name:'选择或管理模板',exact:true}).click(); await dialog(page).getByRole('button',{name:'+ 增加模板',exact:true}).click(); await page.getByLabel('模板名称').fill('阅读模板'); await dialog(page).getByRole('button',{name:'+ 增加模板事项',exact:true}).click(); await page.getByLabel('模板小事正文').fill('阅读十页'); await dialog(page).getByRole('button',{name:'+ 增加模板事项',exact:true}).click(); await page.getByLabel('模板小事正文').last().fill('写总结')
  const writes=requests.filter(path => path==='/writelooptemplate').length; expect(writes).toBe(0)
  await dialog(page).getByRole('button',{name:'保存模板',exact:true}).click(); await expect(page.getByLabel('模板名称')).toHaveValue('阅读模板')
  await dialog(page).getByRole('button',{name:'重命名模板',exact:true}).click(); await page.getByLabel('模板名称').fill('精读模板'); await dialog(page).getByRole('button',{name:'修改模板事项',exact:true}).last().click(); await page.getByLabel('模板小事正文').last().fill('写一句总结'); await dialog(page).getByRole('button',{name:'保存模板',exact:true}).click(); await expect(page.getByLabel('模板名称')).toHaveValue('精读模板')
  await dialog(page).getByRole('button',{name:'+ 增加模板事项',exact:true}).click(); await page.getByLabel('模板小事正文').last().fill('临时草稿'); await dialog(page).getByRole('button',{name:'删除模板事项',exact:true}).last().click(); await expect(page.getByLabel('模板小事正文')).toHaveCount(2)
  await dialog(page).getByRole('button',{name:'关闭',exact:true}).click(); await page.reload(); await expect(page.locator('#message')).toHaveText('已读取'); await page.getByRole('button',{name:'选择或管理模板',exact:true}).click(); await expect(page.getByLabel('模板名称')).toHaveValue('精读模板')
  await page.screenshot({path:testInfo.outputPath('template.png'),fullPage:true})
  await dialog(page).getByRole('button',{name:'精读模板 · 2 条',exact:true}).click(); await expect(area(page,'待办').locator('.event')).toHaveCount(2)
  await page.getByRole('button',{name:'选择或管理模板',exact:true}).click(); await dialog(page).getByRole('button',{name:'精读模板 · 2 条',exact:true}).click(); await expect(area(page,'待办').locator('.loop')).toHaveCount(2)
  await page.getByRole('button',{name:'选择或管理模板',exact:true}).click(); await dialog(page).getByRole('button',{name:'删除模板',exact:true}).click(); await dialog(page).getByRole('button',{name:'确定',exact:true}).click(); await expect(page.locator('.template-draft')).toHaveCount(0); await expect(area(page,'待办').locator('.event')).toHaveCount(4)
})

test('写失败保留输入，结束失败保留暂停耗时并可重试',async ({page,request}) => {
  await page.getByRole('button',{name:'新增待办',exact:true}).click(); await page.getByLabel('小事正文',{exact:true}).fill('失败输入'); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click()
  await page.route('**/writeevent',route => route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试写入失败'})})); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click(); await expect(page.locator('#message')).toHaveText('测试写入失败'); await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue('失败输入'); await expect(page.locator('.event')).toHaveCount(0)
  await page.unroute('**/writeevent'); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click(); await expect(card(page,'失败输入')).toHaveCount(1)
  await card(page,'失败输入').getByRole('button',{name:'移入运行',exact:true}).click(); await expect(card(page,'失败输入').locator('.timer-display')).not.toHaveText('0秒',{timeout:4000}); const id=await card(page,'失败输入').getAttribute('data-source')
  await page.route('**/writeevent',route => route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试写入失败'})})); await card(page,'失败输入').getByRole('button',{name:'归档',exact:true}).click(); await expect(page.locator('#message')).toHaveText('测试写入失败'); await expect(card(page,'失败输入').getByRole('button',{name:'继续',exact:true})).toBeVisible()
  const [timer]=await (await request.post('/readtimer',{data:[id]})).json(); expect(timer.state).toBe('paused'); expect(timer.elapsed_ms).toBeGreaterThan(0)
  await page.unroute('**/writeevent'); await card(page,'失败输入').getByRole('button',{name:'归档',exact:true}).click(); await expect(card(page,'失败输入').getByRole('button',{name:'移入运行',exact:true})).toBeVisible()
})

test('结果直接计时、结束统一录入覆盖，空正文不显示且左右完全隔离',async ({page,request},testInfo) => {
  const consoleErrors=[]; page.on('console',message => {if(message.type()==='error') consoleErrors.push(message.text())})
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'长期积累')
  const forestBefore=await (await request.post('/readforest',{data:{workspace:true,item_templates:null}})).json(), startIndex=requests.length
  await item(page,'长期积累').getByRole('button',{name:'开始计时',exact:true}).click()
  await expect(page.locator('dialog')).toHaveCount(0); await expect(page.locator('.running-strip>div')).toHaveCount(1); await expect(page.locator('.event')).toHaveCount(0)
  const [initial]=await (await request.post('/readevent',{data:[[]]})).json(); expect(initial[0].user.event).toBe(''); expect(initial[0].meta).toEqual(expect.arrayContaining([{kind:'业务区域',text:'结果'},{kind:'属性',text:'耗时:0s'}])); expect(initial[0].meta.some(tag=>tag.text.startsWith('评分:'))).toBe(false)
  const source=initial[0].system.source_id
  await expect(page.locator('.running-strip .timer-display')).not.toHaveText('0秒',{timeout:4000})
  await page.locator('.running-strip').getByRole('button',{name:'结束',exact:true}).click(); await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue('')
  await page.getByLabel('小事正文',{exact:true}).fill('完成阅读'); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click(); await dialog(page).getByRole('button',{name:'4 · 挺好',exact:true}).click()
  await expect(card(page,'完成阅读')).toHaveAttribute('data-source',String(source)); await expect(page.locator('.running-strip')).not.toBeVisible(); await expect(area(page,'运行').locator('.event')).toHaveCount(0)
  let [saved]=await (await request.post('/readevent',{data:[[]]})).json(); const previous=Number(saved[0].meta.find(tag=>tag.text.startsWith('耗时:')).text.slice(3,-1)); expect(previous).toBeGreaterThan(0)
  await card(page,'完成阅读').getByRole('button',{name:'开始计时',exact:true}).click(); await page.locator('.running-strip').getByRole('button',{name:'暂停',exact:true}).click(); await expect(page.locator('.running-strip')).toContainText('已暂停')
  await page.locator('.running-strip').getByRole('button',{name:'继续',exact:true}).click(); await expect(page.locator('.running-strip')).toContainText('计时中')
  await page.locator('.running-strip').getByRole('button',{name:'结束',exact:true}).click(); await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue('完成阅读'); await page.getByLabel('小事正文',{exact:true}).fill('完成阅读和笔记'); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click(); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click()
  await expect(card(page,'完成阅读和笔记')).toHaveCount(1); [saved]=await (await request.post('/readevent',{data:[[]]})).json(); expect(saved[0].system.source_id).toBe(source); expect(saved[0].meta.some(tag=>tag.text.startsWith('评分:'))).toBe(false); expect(Number(saved[0].meta.find(tag=>tag.text.startsWith('耗时:')).text.slice(3,-1))).toBeGreaterThanOrEqual(previous)
  expect(requests.slice(startIndex)).not.toContain('/writeforest'); expect(await (await request.post('/readforest',{data:{workspace:true,item_templates:null}})).json()).toEqual(forestBefore)
  await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true}); await page.setViewportSize({width:390,height:844}); await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true); await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true}); expect(consoleErrors).toEqual([])
})

test('结果记录耗时快捷卡片与自定义，保存后选择评分',async ({page,request}) => {
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'练习')
  await item(page,'练习').locator(':scope > .group-head').hover(); await item(page,'练习').getByRole('button',{name:'记录一条',exact:true}).click(); await page.getByLabel('小事正文',{exact:true}).fill('练习三分钟'); await dialog(page).getByRole('button',{name:'3 分钟',exact:true}).click(); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click(); await dialog(page).getByRole('button',{name:'4 · 挺好',exact:true}).click(); await expect(card(page,'练习三分钟')).toHaveCount(1)
  await item(page,'练习').locator(':scope > .group-head').hover(); await item(page,'练习').getByRole('button',{name:'记录一条',exact:true}).click(); await page.getByLabel('小事正文',{exact:true}).fill('练习自定义'); await page.getByLabel('自定义耗时（分钟）').fill('2.5'); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click(); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click(); await expect(card(page,'练习自定义')).toHaveCount(1)
  const [all]=await (await request.post('/readevent',{data:[[]]})).json(); expect(all.find(event=>event.user.event==='练习三分钟').meta).toEqual(expect.arrayContaining([{kind:'属性',text:'耗时:180s'},{kind:'属性',text:'评分:4'}])); expect(all.find(event=>event.user.event==='练习自定义').meta).toContainEqual({kind:'属性',text:'耗时:150s'})
})

test('返回待办只改event，右侧带事项标签也不进入结果计时条',async ({page,request}) => {
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'同名事项')
  const created=await (await request.post('/writeevent',{data:[{system:{source_id:null,deleted:false},user:{event:'右边独立事实'},meta:[{kind:'业务区域',text:'待办'},{kind:'复利事项',text:'同名事项'},{kind:'属性',text:'耗时:300s'}]}]})).json(); const id=created[0].source_id
  await page.reload(); await expect(page.locator('#message')).toHaveText('已读取'); const before=requests.length
  await area(page,'结果').getByRole('button',{name:'投入回顾',exact:true}).click(); await expect(dialog(page)).not.toContainText('右边独立事实'); await expect(dialog(page)).toContainText('0 条小事'); await dialog(page).getByRole('button',{name:'关闭',exact:true}).click()
  await card(page,'右边独立事实').getByRole('button',{name:'移入运行',exact:true}).click(); await expect(card(page,'右边独立事实').getByRole('button',{name:'暂停',exact:true})).toBeVisible(); await expect(page.locator('.running-strip')).not.toBeVisible()
  await card(page,'右边独立事实').getByRole('button',{name:'返回待办',exact:true}).click(); await expect(area(page,'待办').locator('.event')).toHaveCount(1); await expect(card(page,'右边独立事实').locator('.timer-display')).toHaveCount(0); await expect(card(page,'右边独立事实').getByRole('button',{name:'开始计时',exact:true})).toHaveCount(0)
  const [timer]=await (await request.post('/readtimer',{data:[String(id)]})).json(); expect(timer.state).toBe('running'); expect(requests.slice(before)).not.toContain('/writeforest')
})

test('结果两个计时器独立，空正文结束失败保留输入与耗时',async ({page,request}) => {
  await named(page,area(page,'结果').getByRole('button',{name:'新增根事项',exact:true}),'独立计时')
  await item(page,'独立计时').getByRole('button',{name:'开始计时',exact:true}).click(); await expect(page.locator('.running-strip>div')).toHaveCount(1)
  await item(page,'独立计时').getByRole('button',{name:'开始计时',exact:true}).click(); const strips=page.locator('.running-strip>div'); await expect(strips).toHaveCount(2)
  await strips.nth(0).getByRole('button',{name:'暂停',exact:true}).click(); await expect(strips.nth(0)).toContainText('已暂停'); await expect(strips.nth(1)).toContainText('计时中')
  await page.reload(); await expect(page.locator('#message')).toHaveText('已读取'); await expect(strips).toHaveCount(2)
  const [before]=await (await request.post('/readevent',{data:[[]]})).json(); const id=String(before[0].system.source_id)
  await strips.nth(0).getByRole('button',{name:'结束',exact:true}).click(); await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue(''); await dialog(page).getByRole('button',{name:'保存并选择评分',exact:true}).click()
  await page.route('**/writeevent',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'结果保存失败'})})); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click(); await expect(page.locator('#message')).toHaveText('结果保存失败'); await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue('')
  const [paused]=await (await request.post('/readtimer',{data:[id]})).json(); expect(paused.state).toBe('paused'); const [unchanged]=await (await request.post('/readevent',{data:[[]]})).json(); expect(unchanged).toEqual(before)
  await page.unroute('**/writeevent'); await dialog(page).getByRole('button',{name:'不评分，完成',exact:true}).click(); await expect(strips).toHaveCount(1); await expect(page.locator('.event')).toHaveCount(0); const [reset]=await (await request.post('/readtimer',{data:[id]})).json(); expect(reset.elapsed_ms).toBe(0); expect(reset.state).toBe('paused')
})
