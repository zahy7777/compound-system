import {test, expect, _electron as electron} from '@playwright/test'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
test.skip(process.env.COMPOUND_TEST_SPEECH !== '1', '仅显式启用时调用真实腾讯识别')
test('真实麦克风 PCM 流与腾讯转录，停顿自动确认并保留键盘补充', async ({page, request}, testInfo) => {
  test.setTimeout(90000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.context().grantPermissions(['microphone'])
  await page.goto('/'); await expect(page.locator('#message')).toHaveText('已读取')
  const config = await (await request.get('/speech/config')).json(); expect(config.configured).toBe(true)
  await page.getByRole('button', {name: '新增待办', exact: true}).click()
  await expect(page.locator('.voice-status')).toContainText('正在听', {timeout: 25000})
  await page.getByLabel('小事正文', {exact: true}).fill('键盘尾部验证')
  await expect(page.getByLabel('语音识别正文')).not.toBeEmpty({timeout: 45000})
  await page.screenshot({path: testInfo.outputPath('speech-desktop.png'), fullPage: true})
  await expect(page.locator('.score-card')).toBeVisible({timeout: 45000})
  const transcript = await page.getByLabel('语音识别正文').textContent()
  expect(transcript.trim().length).toBeGreaterThan(0)
  await page.getByRole('button', {name: '4 · 挺好', exact: true}).click()
  await expect(page.locator('dialog')).toHaveCount(0)
  const [events] = await (await request.post('/readevent', {data: [[]]})).json()
  expect(events).toHaveLength(1)
  expect(events[0].user.event).toBe(transcript + '键盘尾部验证')
  expect(events[0].meta).toContainEqual({kind: '属性', text: '评分:4'})
  expect(errors).toEqual([])
  await page.setViewportSize({width: 390, height: 844})
  await page.getByRole('button', {name: '新增待办', exact: true}).click()
  await page.screenshot({path: testInfo.outputPath('speech-mobile.png'), fullPage: true})
  await page.getByRole('button', {name: '关闭', exact: true}).click()
})


test('真实 Electron：同一 PCM 链路录入并经腾讯识别保存', async ({baseURL}) => {
  test.setTimeout(90000)
  const directory = mkdtempSync(join(tmpdir(), 'compound-voice-electron-'))
  writeFileSync(join(directory, 'shortcuts.json'), JSON.stringify({running: 'Control+Shift+Alt+F10', todo: 'Control+Shift+Alt+F11'}), 'utf8')
  const app = await electron.launch({args: [resolve('desktop/main/index.cjs'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(process.env.COMPOUND_SPEECH_AUDIO || 'tests/fixtures/speech-with-pause.wav')}`], env: {...process.env, COMPOUND_DESKTOP_URL: baseURL, COMPOUND_DESKTOP_DATA: directory}})
  try {
    const page = await app.firstWindow(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${baseURL}/?presentation=todo`)
    await expect(page.locator('#message')).toHaveText('已读取')
    await page.getByRole('button', {name: '新增待办', exact: true}).click()
    await expect(page.locator('.voice-status')).toContainText('正在听', {timeout: 25000})
    await expect(page.getByLabel('语音识别正文')).not.toBeEmpty({timeout: 45000})
    await page.getByLabel('小事正文', {exact: true}).fill('Electron补充')
    await page.getByLabel('小事正文', {exact: true}).press('Enter')
    await expect(page.locator('.score-card')).toBeVisible({timeout: 15000})
    const text = await page.getByLabel('语音识别正文').textContent()
    await page.getByRole('button', {name: '不评分，完成', exact: true}).click()
    await expect(page.locator('.event-body').filter({hasText: text + 'Electron补充'})).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {await app.close(); rmSync(directory, {recursive: true, force: true})}
})
