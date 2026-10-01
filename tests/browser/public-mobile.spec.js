import {test, expect} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,trace:'off'})
test('真实公网手机只读登录与四区访问，不创建测试事实', async ({page}) => {
  test.skip(process.env.COMPOUND_PUBLIC_MOBILE !== '1', '显式开启真实公网只读验收')
  const errors = [], writes = []
  page.on('pageerror', value => errors.push(value.message))
  page.on('request', value => {if(value.method()==='POST') writes.push(new URL(value.url()).pathname)})
  await page.goto('https://songring.nat100.top/compound/dev/?presentation=mobile')
  const password = (await readFile(resolve('instance/dev/initial-password.txt'),'utf8')).trim()
  await page.getByLabel('登录密码').fill(password)
  await page.getByRole('button',{name:'登录',exact:true}).click()
  await expect(page.locator('#message')).toHaveText('已读取')
  for (const name of ['结果','运行','待办','归档']) {
    await page.getByRole('navigation',{name:'手机分区'}).getByRole('button',{name,exact:true}).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.reload(); await expect(page.locator('#message')).toHaveText('已读取')
  await page.getByRole('button',{name:'退出登录',exact:true}).click()
  await expect(page.getByLabel('登录密码')).toBeVisible()
  expect(errors).toEqual([])
  expect(writes.every(path => ['/access/login','/access/logout','/readevent','/readforest','/readtimer'].some(suffix => path === `/compound/dev${suffix}`))).toBe(true)
})
