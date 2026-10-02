import {test, expect} from '@playwright/test'

async function syntheticMicrophone(page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain()
      const output = context.createMediaStreamDestination()
      oscillator.frequency.value = 440; gain.gain.value = .2
      oscillator.connect(gain); gain.connect(output); oscillator.start(); await context.resume()
      const stream = output.stream
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track)
        track.stop = () => {stop(); oscillator.stop(); void context.close(); window.pcmReleased = true}
      }
      return stream
    }
  })
}

test('真实 AudioWorklet 和 WS：PCM 尾包后停止，全文合并键盘并保存', async ({page, browserName}) => {
  test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows Playwright WebKit 未提供 Web Audio；真实 Safari 另行验收')
  await syntheticMicrophone(page)
  await page.route('**/speech/config', route => route.fulfill({json: {configured: true}}))
  let bytes = 0, stopBytes = 0, authorized = false, fullBlocks = 0
  await page.routeWebSocket('**/speech/stream', socket => {
    socket.onMessage(message => {
      if (typeof message === 'string') {
        if (message === 'stop') {
          stopBytes = bytes
          socket.send(JSON.stringify({type: 'completed', text: '音频最终全文'}))
        } else {
          expect(JSON.parse(message)).toEqual({type: 'authorize', csrf: null}); authorized = true
          socket.send(JSON.stringify({type: 'authorized'}))
          setTimeout(() => socket.send(JSON.stringify({type: 'ready'})), 20)
        }
      } else {
        expect(authorized).toBe(true); expect(message.length % 2).toBe(0)
        expect(message.length).toBeLessThanOrEqual(2560)
        bytes += message.length
        if (message.length === 2560) fullBlocks++
        if (bytes >= 2560) socket.send(JSON.stringify({type: 'transcript', text: '音频初稿'}))
      }
    })
  })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/'); await expect(page.locator('#message')).toHaveText('已读取')
  await page.getByRole('button', {name: '新增待办', exact: true}).click()
  await expect(page.locator('.voice-status')).toContainText('正在听')
  await expect(page.getByLabel('语音识别正文')).toHaveText('音频初稿')
  await page.getByLabel('小事正文', {exact: true}).fill('键盘补充')
  await page.getByLabel('小事正文', {exact: true}).press('Enter')
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(page.locator('.event-body').filter({hasText: '音频最终全文键盘补充'})).toHaveCount(1)
  expect(stopBytes).toBe(bytes); expect(fullBlocks).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.pcmReleased)).toBe(true)
  expect(errors).toEqual([])
})


test('真实收音中断释放麦克风，保留语音和键盘草稿且不保存', async ({page, browserName}) => {
  test.skip(browserName === 'webkit' && process.platform === 'win32', 'Windows Playwright WebKit 未提供 Web Audio；真实 Safari 另行验收')
  await syntheticMicrophone(page)
  await page.route('**/speech/config', route => route.fulfill({json: {configured: true}}))
  let connection
  await page.routeWebSocket('**/speech/stream', socket => {
    connection = socket
    socket.onMessage(message => {
      if (typeof message === 'string') {
        socket.send(JSON.stringify({type: 'authorized'}))
        setTimeout(() => socket.send(JSON.stringify({type: 'ready'})), 20)
      } else socket.send(JSON.stringify({type: 'transcript', text: '断网前语音'}))
    })
  })
  await page.goto('/'); await expect(page.locator('#message')).toHaveText('已读取')
  await page.getByRole('button', {name: '新增待办', exact: true}).click()
  await expect(page.getByLabel('语音识别正文')).toHaveText('断网前语音')
  await page.getByLabel('小事正文', {exact: true}).fill('断网前键盘')
  connection.close({code: 1011, reason: '测试网络失败'})
  await expect(page.locator('.voice-status')).toContainText('语音连接中断')
  await expect(page.getByLabel('语音识别正文')).toHaveText('断网前语音')
  await expect(page.getByLabel('小事正文', {exact: true})).toHaveValue('断网前键盘')
  expect(await page.evaluate(() => window.pcmReleased)).toBe(true)
  await page.getByRole('button', {name: '关闭', exact: true}).click()
  await expect(page.locator('.event-body').filter({hasText: '断网前语音'})).toHaveCount(0)
})
