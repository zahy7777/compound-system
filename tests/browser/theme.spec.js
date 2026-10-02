import {test,expect} from '@playwright/test'

const key='compound:appearance'
async function settings(page){await page.getByRole('button',{name:'外观设置',exact:true}).click()}
async function close(page){await page.getByRole('button',{name:'关闭外观设置',exact:true}).click()}
async function theme(page,value){await settings(page);await page.getByLabel('主题',{exact:true}).selectOption(value);await close(page)}
const geometry=page=>page.locator('#workspace button,#workspace input,#workspace select,.group-head,.event').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return {label:node.getAttribute('aria-label'),x:b.x,y:b.y,width:b.width,height:b.height}}))
test.beforeEach(async({page,request})=>{
  await page.addInitScript(()=>localStorage.removeItem('compound:appearance'))
  const [events]=await (await request.post('/readevent',{data:[[]]})).json()
  if(events.length) await request.post('/writeevent',{data:events.map(event=>({...event,system:{source_id:event.system.source_id,deleted:true}}))})
  await request.post('/writeforest',{data:{workspace:{item_template_id:null,forest:['结果','待办','运行','归档'].map(text=>({tag:{kind:'业务区域',text},children:[]}))}}})
})

test('切换、刷新与多窗口外观同步不写业务，默认主题不下载艺术资产',async({page,context})=>{
  const assets=[],writes=[],errors=[]
  page.on('request',request=>{if(request.url().includes('/theme/assets/'))assets.push(request.url());if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/write'))writes.push(request.url())})
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/');await expect(page.locator('#message')).toHaveText('已读取')
  expect(assets).toEqual([])
  const before=await geometry(page)
  await theme(page,'persona');await expect(page.locator('[data-paper-ready]').first()).toBeVisible()
  // 独立图标的纸面不能覆盖按钮语义底色，白色图标必须有深色底。
  await page.getByRole('button',{name:'新增待办',exact:true}).click()
  const dismiss=page.getByRole('button',{name:'关闭',exact:true});await expect(dismiss).toHaveAttribute('data-paper-ready','');await expect(dismiss).toHaveCSS('color','rgb(255, 255, 255)');await expect(dismiss).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(page.locator('dialog .theme-paper-layer')).toHaveCount(1);expect(await page.locator('dialog .theme-paper-patch').evaluateAll(nodes=>nodes.some(n=>['rgb(23, 19, 23)','rgb(223, 19, 41)'].includes(n.style.backgroundColor)))).toBe(true);await dismiss.click()
  expect(await geometry(page)).toEqual(before)
  expect(assets.length).toBeGreaterThan(0)
  await settings(page);await page.getByLabel('点击音效',{exact:true}).check();await page.getByLabel('音量',{exact:true}).fill('47');await close(page)
  // 清除 beforeEach 注入脚本的副作用，使用新页面验证真实持久偏好。
  const other=await context.newPage();await other.goto('/');await expect(other.locator('html')).toHaveAttribute('data-theme','persona')
  await settings(other);await expect(other.getByLabel('点击音效',{exact:true})).toBeChecked();await expect(other.getByLabel('音量',{exact:true})).toHaveValue('47');await close(other)
  await theme(other,'default');await expect(page.locator('html')).toHaveAttribute('data-theme','default');await expect(page.locator('[data-paper-ready],[data-surface-ready]')).toHaveCount(0)
  expect(await geometry(page)).toEqual(before);expect(writes).toEqual([]);expect(errors).toEqual([])
})

test('600条事项与长正文的纸边保持稳定，换行与窄屏仍可操作',async({page,request})=>{
  await request.post('/writeforest',{data:{workspace:{item_template_id:null,forest:['结果','待办','运行','归档'].map(text=>({tag:{kind:'业务区域',text},children:text==='结果'?Array.from({length:600},(_,i)=>({tag:{kind:'复利事项',text:`密集事项 ${i}`},children:[],is_fold:false})):[]}))}}})
  await request.post('/writeevent',{data:[{system:{source_id:null,deleted:false},user:{event:'一条很长的中文任务正文，验证换行后仍然能透出拼贴，而且文字和操作按钮清晰可读。'.repeat(8)},meta:[{kind:'业务区域',text:'待办'}]}]})
  await page.goto('/');await expect(page.locator('#message')).toHaveText('已读取');await theme(page,'persona')
  await expect(page.locator('.item')).toHaveCount(600)
  const first=page.locator('.branch-name').first();await expect(first).toHaveAttribute('data-paper-ready','')
  const mask=await page.locator('body>.theme-paper-layer .theme-paper-patch').first().evaluate(n=>n.style.maskImage)
  expect(mask).toContain('data:image/svg+xml');expect(mask).toContain('feGaussianBlur')
  await theme(page,'default');await theme(page,'persona');expect(await page.locator('body>.theme-paper-layer .theme-paper-patch').first().evaluate(n=>n.style.maskImage)).toBe(mask)
  await expect(page.locator('body>.theme-paper-layer')).toHaveCSS('pointer-events','none');await expect(page.locator('#workspace')).toHaveCSS('z-index','1');await expect(first).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await page.screenshot({path:'test-results/theme-dense-desktop.png',animations:'disabled'})
  await page.setViewportSize({width:390,height:844});await page.getByRole('navigation',{name:'手机分区'}).getByRole('button',{name:'结果',exact:true}).click();await first.scrollIntoViewIfNeeded();await first.click();await expect(page.locator('dialog')).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/theme-dense-390.png',animations:'disabled'})
  await page.getByRole('navigation',{name:'手机分区'}).getByRole('button',{name:'待办',exact:true}).click();await expect(page.locator('.event-body').last()).toBeVisible();await expect(page.locator('.event-body').last()).toHaveAttribute('data-paper-ready','');expect((await page.locator('.event-body').last().boundingBox()).height).toBeGreaterThan(100);await page.screenshot({path:'test-results/theme-long-390.png',animations:'disabled'})
  await request.post('/writeforest',{data:{workspace:{item_template_id:null,forest:['结果','待办','运行','归档'].map(text=>({tag:{kind:'业务区域',text},children:[]}))}}})
})

test('主题动效尊重关闭和系统减弱设置，键盘激活后清理装饰',async({page})=>{
  await page.goto('/');await expect(page.locator('#message')).toHaveText('已读取');await theme(page,'persona')
  await page.evaluate(()=>{window.impacts=0;window.modalImpacts=0;new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n instanceof Element&&n.matches('.theme-impact')){window.impacts++;if(n.closest('dialog'))window.modalImpacts++}}).observe(document.body,{childList:true,subtree:true})})
  await page.evaluate(()=>{window.tones=0;const Native=window.AudioContext;window.AudioContext=class extends Native{createOscillator(){window.tones++;return super.createOscillator()}}})
  await settings(page);await page.getByLabel('点击音效',{exact:true}).check();await close(page)
  const add=page.getByRole('button',{name:'新增待办',exact:true});await add.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('小事正文',{exact:true})).toBeVisible()
  expect(await page.evaluate(()=>window.impacts)).toBeGreaterThan(0)
  expect(await page.evaluate(()=>window.tones)).toBeGreaterThan(0)
  await page.locator('dialog summary').click();expect(await page.evaluate(()=>window.modalImpacts)).toBeGreaterThan(0)
  await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.theme-impact')).toHaveCount(0)
  await settings(page);await page.getByLabel('点击动效',{exact:true}).uncheck();await page.getByLabel('点击音效',{exact:true}).uncheck();await close(page);const count=await page.evaluate(()=>window.impacts),tones=await page.evaluate(()=>window.tones)
  await add.click();await page.getByRole('button',{name:'关闭',exact:true}).click();expect(await page.evaluate(()=>window.impacts)).toBe(count)
  expect(await page.evaluate(()=>window.tones)).toBe(tones)
  await settings(page);await page.getByLabel('点击动效',{exact:true}).check();await close(page);await page.emulateMedia({reducedMotion:'reduce'})
  await add.click();await page.getByRole('button',{name:'关闭',exact:true}).click();expect(await page.evaluate(()=>window.impacts)).toBe(count)
})

test('外观存储失败明确提示，业务录入草稿与重试仍可用',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new DOMException('blocked','SecurityError')}})
  await page.goto('/');await expect(page.locator('#message')).toHaveText('已读取');await settings(page);await page.getByLabel('主题',{exact:true}).selectOption('persona');await expect(page.locator('.theme-note')).toContainText('无法保存');await close(page)
  await page.getByRole('button',{name:'新增待办',exact:true}).click();await page.getByLabel('小事正文',{exact:true}).fill('失败后仍保留的纸条草稿')
  await page.route('**/writeevent',route=>route.fulfill({status:500,json:{error:'主题回归：写入失败'}}));await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByLabel('小事正文',{exact:true})).toHaveValue('失败后仍保留的纸条草稿');await expect(page.locator('dialog .dialog-error')).toContainText('主题回归：写入失败')
  await page.unroute('**/writeevent');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('.event-body').filter({hasText:'失败后仍保留'})).toBeVisible()
})
