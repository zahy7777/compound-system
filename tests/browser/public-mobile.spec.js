import {test, expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

test.use({trace:'off',screenshot:'off',video:'off'})

for (const environment of ['dev','prod']) for (const mobile of [true,false]) {
test.describe(`${environment} ${mobile ? '手机' : '电脑'}`, () => {
test.use({viewport:mobile ? {width:390,height:844} : {width:1440,height:900},isMobile:mobile,hasTouch:mobile})
test('真实公网只读登录、布局与环境隔离，不创建测试事实', async ({page}) => {
  test.skip(process.env.COMPOUND_PUBLIC_MOBILE !== '1', '显式开启真实公网只读验收')
  const errors = [], writes = []
  page.on('pageerror', value => errors.push(value.message))
  page.on('request', value => {if(value.method()==='POST') writes.push(new URL(value.url()).pathname)})
  await page.goto(`https://songring.nat100.top/compound/${environment}/${mobile ? '?presentation=mobile' : ''}`)
  const password = (await readFile(resolve(`instance/${environment}/initial-password.txt`),'utf8')).trim()
  await page.getByLabel('登录密码').fill(password)
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page.locator('#message')).toHaveText('已读取')
  const otherEnvironment = environment === 'dev' ? 'prod' : 'dev'
  const otherBase = `https://songring.nat100.top/compound/${otherEnvironment}`
  const otherSession = await page.context().request.get(`${otherBase}/access/session`)
  expect((await otherSession.json()).authenticated).toBe(false)
  expect((await page.context().request.post(`${otherBase}/readevent`,{data:[[]]})).status()).toBe(401)
  if (mobile) for (const name of ['结果','运行','待办','归档']) {
    await page.getByRole('navigation',{name:'手机分区'}).getByRole('button',{name,exact:true}).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.reload(); await expect(page.locator('#message')).toHaveText('已读取')
  // 完整电脑布局尚无退出按钮，切到已有手机入口完成退出。
  if (!mobile) {
    await page.goto(`https://songring.nat100.top/compound/${environment}/?presentation=mobile`)
    await expect(page.locator('#message')).toHaveText('已读取')
  }
  await page.getByRole('button',{name:'退出登录',exact:true}).click()
  await expect(page.getByLabel('登录密码')).toBeVisible()
  expect(errors).toEqual([])
  expect(writes.every(path => ['/access/login','/access/logout','/readevent','/readforest','/readtimer','/readslice'].some(suffix => path === `/compound/${environment}${suffix}`))).toBe(true)
})

})
}
