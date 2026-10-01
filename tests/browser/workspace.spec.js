import {test, expect} from '@playwright/test'

const area = (page, name) => page.locator(`.area[data-area="${name}"]`)
const item = (page, name) => page.locator(`.item[data-item="${name}"]`)
const card = (page, text) => page.locator('.fact').filter({has: page.locator('.fact-body', {hasText: text})})
const loop = (parent, name) => parent.locator('.loop').filter({has: parent.page().locator('.group-head strong', {hasText: name})})

async function promptClick(page, target, text) {
  page.once('dialog', dialog => dialog.accept(text))
  await target.click()
  await expect(page.locator('#workspace button').first()).toBeEnabled()
}
async function confirmClick(page, target) {
  page.once('dialog', dialog => dialog.accept())
  await target.click()
  await expect(page.locator('#message')).toHaveText('已保存')
}
async function addTag(page, kind, text) {
  await page.getByRole('button', {name: '增加标签', exact: true}).click()
  const row = page.locator('.tag-row').last()
  await row.getByLabel('标签种类').selectOption(kind)
  await row.getByLabel('标签文本').fill(text)
}
async function saveEvent(page, text) {
  await page.locator('#event').fill(text)
  await page.getByRole('button', {name: '保存小事', exact: true}).click()
  await expect(page.locator('#editor')).not.toBeVisible()
}
async function dragTo(page, source, target) {
  await source.dragTo(target)
  await expect(page.locator('#message')).toHaveText('已保存')
  await expect(page.locator('#refresh')).toBeEnabled()
}

test.beforeEach(async ({page, request}) => {
  // 仍通过唯一 write 接口清理测试自己的事实，历史保留。
  const current = await (await request.post('/read', {data: [[]]})).json()
  if (current[0].length) await request.post('/write', {data: current[0].map(fact => ({
    system: {source_id: fact.system.source_id, deleted: true}, user: fact.user, meta: fact.meta,
  }))})
  await page.goto('/')
  await expect(page.locator('#message')).toHaveText('已读取')
})

test('创建、运行、归档、属性编辑与删除只使用两个接口', async ({page}) => {
  const errors = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {if (request.method() === 'POST') writes.push(new URL(request.url()).pathname)})
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '运动')
  await promptClick(page, item(page, '运动').getByRole('button', {name: '+闭环', exact: true}), '训练')
  await loop(item(page, '运动'), '训练').getByRole('button', {name: '+小事', exact: true}).click()
  await addTag(page, '属性', '评分:4')
  await addTag(page, '属性', '耗时:1800s')
  await addTag(page, '属性', '备注:保持动作稳定')
  await saveEvent(page, '游泳训练')
  const source = await card(page, '游泳训练').getAttribute('data-source')
  await card(page, '游泳训练').getByRole('button', {name: '运行', exact: true}).click()
  await expect(area(page, '运行').locator('.fact')).toHaveCount(1)
  await expect(area(page, '结果').locator('.fact')).toHaveCount(0)
  await area(page, '运行').getByRole('button', {name: '归档', exact: true}).click()
  await expect(area(page, '归档').locator('.fact')).toHaveCount(1)
  await card(page, '游泳训练').getByRole('button', {name: '编辑', exact: true}).click()
  // 根据真实表单值定位属性行，其他属性不参与改写。
  const rows = page.locator('.tag-row')
  for (let index = 0; index < await rows.count(); index++) {
    const input = rows.nth(index).getByLabel('标签文本')
    if (await input.inputValue() === '评分:4') await input.fill('评分:5')
  }
  await saveEvent(page, '游泳训练完成')
  await expect(card(page, '游泳训练完成')).toContainText('评分:5')
  await expect(card(page, '游泳训练完成')).toContainText('耗时:1800s')
  await expect(card(page, '游泳训练完成')).toContainText('备注:保持动作稳定')
  await expect(card(page, '游泳训练完成')).toHaveAttribute('data-source', source)
  await card(page, '游泳训练完成').getByRole('button', {name: '编辑', exact: true}).click()
  for (let index = 0; index < await rows.count(); index++) {
    if (await rows.nth(index).getByLabel('标签文本').inputValue() === '备注:保持动作稳定') {
      await rows.nth(index).getByRole('button', {name: '移除', exact: true}).click()
      break
    }
  }
  await addTag(page, '属性', '日期:2026-10-01')
  await saveEvent(page, '游泳训练完成')
  await expect(card(page, '游泳训练完成')).not.toContainText('备注:')
  await expect(card(page, '游泳训练完成')).toContainText('评分:5')
  await expect(card(page, '游泳训练完成')).toContainText('日期:2026-10-01')
  await confirmClick(page, card(page, '游泳训练完成').getByRole('button', {name: '删除', exact: true}))
  await expect(page.locator('.fact')).toHaveCount(0)
  expect(errors).toEqual([])
  expect([...new Set(writes)].sort()).toEqual(['/read', '/write'])
})

test('单条和整组拖拽保持其他标签；改名和跨区域组删除', async ({page}) => {
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '学习')
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '阅读')
  const todoLoop = () => loop(area(page, '待办'), '阅读')
  await todoLoop().getByRole('button', {name: '+小事', exact: true}).click()
  await addTag(page, '属性', '评分:3')
  await saveEvent(page, '阅读甲')
  await todoLoop().getByRole('button', {name: '+小事', exact: true}).click()
  await saveEvent(page, '阅读乙')
  await dragTo(page, todoLoop().locator('.group-head'), area(page, '运行').locator('h2'))
  await expect(area(page, '运行').locator('.fact')).toHaveCount(2)
  await dragTo(page, card(page, '阅读乙'), area(page, '归档').locator('h2'))
  await expect(area(page, '归档').locator('.fact')).toHaveCount(1)
  await dragTo(page, loop(area(page, '运行'), '阅读').locator('.group-head'), item(page, '学习').locator('.group-head'))
  await expect(item(page, '学习').locator('.fact')).toHaveCount(1)
  await expect(area(page, '归档').locator('.fact')).toHaveCount(1)
  await expect(card(page, '阅读甲')).toContainText('评分:3')
  await promptClick(page, item(page, '学习').getByRole('button', {name: '改名事项', exact: true}), '读书')
  await expect(item(page, '读书').locator('.fact')).toHaveCount(1)
  await promptClick(page, loop(item(page, '读书'), '阅读').getByRole('button', {name: '改名闭环', exact: true}), '阅读完成')
  await expect(loop(area(page, '归档'), '阅读完成').locator('.fact')).toHaveCount(1)
  await confirmClick(page, loop(item(page, '读书'), '阅读完成').getByRole('button', {name: '删除闭环', exact: true}))
  await expect(page.locator('.fact')).toHaveCount(0)
})

test('同名闭环独立、空组刷新消失、解除闭环及事项组拖拽删除', async ({page}) => {
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '空事项')
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '空闭环')
  await page.reload()
  await expect(page.locator('#message')).toHaveText('已读取')
  await expect(page.locator('.item')).toHaveCount(0)
  await expect(page.locator('.loop')).toHaveCount(0)
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '每日整理')
  await area(page, '待办').locator('.loop').first().getByRole('button', {name: '+小事', exact: true}).click()
  await saveEvent(page, '第一组')
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '每日整理')
  await area(page, '待办').locator('.loop').last().getByRole('button', {name: '+小事', exact: true}).click()
  await saveEvent(page, '第二组')
  const groups = area(page, '待办').locator('.loop')
  expect(await groups.nth(0).getAttribute('data-loop')).not.toBe(await groups.nth(1).getAttribute('data-loop'))
  await page.reload()
  await expect(groups).toHaveCount(2)
  await dragTo(page, card(page, '第一组'), area(page, '待办').locator('.drop-none'))
  await expect(area(page, '待办').locator('.drop-none .fact')).toHaveCount(1)
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '整理')
  await dragTo(page, card(page, '第一组'), item(page, '整理').locator('.group-head'))
  await dragTo(page, item(page, '整理').locator('.group-head'), area(page, '运行').locator('h2'))
  await expect(area(page, '运行').locator('.fact')).toHaveCount(1)
  await confirmClick(page, item(page, '整理').getByRole('button', {name: '删除事项', exact: true}))
  await expect(card(page, '第一组')).toHaveCount(0)
  await expect(card(page, '第二组')).toHaveCount(1)
  await area(page, '待办').getByRole('button', {name: '+小事', exact: true}).first().click()
  await saveEvent(page, '')
  await expect(page.locator('.fact-body', {hasText: '（空正文）'})).toHaveCount(1)
})

test('协议拒绝错误属性，保留输入；窄屏无横向溢出', async ({page}, testInfo) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await area(page, '待办').getByRole('button', {name: '+小事', exact: true}).first().click()
  await page.locator('#event').fill('输入需要保留')
  await addTag(page, '属性', '评分:9')
  await page.getByRole('button', {name: '保存小事', exact: true}).click()
  await expect(page.locator('#message')).toContainText('格式不符合协议')
  await expect(page.locator('#editor-error')).toContainText('格式不符合协议')
  await expect(page.locator('#editor')).toBeVisible()
  await expect(page.locator('#event')).toHaveValue('输入需要保留')
  await page.locator('.tag-row').last().getByLabel('标签文本').fill('评分:4')
  await saveEvent(page, '输入需要保留')
  await page.screenshot({path: testInfo.outputPath('desktop.png'), fullPage: true})
  await page.setViewportSize({width: 390, height: 844})
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: testInfo.outputPath('mobile.png'), fullPage: true})
  expect(errors).toEqual([])
})

test('空组改名删除、拖入其他闭环及重新归属复利事项', async ({page}) => {
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '临时')
  await promptClick(page, item(page, '临时').getByRole('button', {name: '改名事项', exact: true}), '临时改名')
  await confirmClick(page, item(page, '临时改名').getByRole('button', {name: '删除事项', exact: true}))
  await expect(page.locator('.item')).toHaveCount(0)
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '空组')
  await promptClick(page, loop(area(page, '待办'), '空组').getByRole('button', {name: '改名闭环', exact: true}), '空组改名')
  await confirmClick(page, loop(area(page, '待办'), '空组改名').getByRole('button', {name: '删除闭环', exact: true}))
  await expect(page.locator('.loop')).toHaveCount(0)
  await promptClick(page, area(page, '待办').getByRole('button', {name: '+闭环', exact: true}), '甲组')
  await loop(area(page, '待办'), '甲组').getByRole('button', {name: '+小事', exact: true}).click()
  await saveEvent(page, '转换分组')
  await promptClick(page, area(page, '归档').getByRole('button', {name: '+闭环', exact: true}), '乙组')
  await dragTo(page, card(page, '转换分组'), loop(area(page, '归档'), '乙组').locator('.group-head'))
  await expect(loop(area(page, '归档'), '乙组').locator('.fact')).toHaveCount(1)
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '方向甲')
  await promptClick(page, area(page, '结果').getByRole('button', {name: '+复利事项', exact: true}), '方向乙')
  await dragTo(page, card(page, '转换分组'), item(page, '方向甲').locator('.group-head'))
  await dragTo(page, card(page, '转换分组'), item(page, '方向乙').locator('.group-head'))
  await expect(item(page, '方向甲').locator('.fact')).toHaveCount(0)
  await expect(item(page, '方向乙').locator('.fact')).toHaveCount(1)
  await expect(card(page, '转换分组')).toContainText('闭环：乙组')
  await confirmClick(page, item(page, '方向乙').getByRole('button', {name: '删除事项', exact: true}))
  await expect(page.locator('.fact')).toHaveCount(0)
})
