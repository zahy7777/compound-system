import {test, expect} from '@playwright/test'

async function open(page) {
  await page.goto('/'); await expect(page.locator('#message')).toHaveText('已读取')
  await page.getByRole('button', {name: '新增待办', exact: true}).click()
}
async function mockSpeech(page) {
  await page.route('**/speech/config', route => route.fulfill({json: {configured: true, iceServers: []}}))
  await page.route('**/speech/offer', route => route.fulfill({json: {sdp: 'answer', type: 'answer'}}))
  await page.addInitScript(() => {
    window.voiceTest = {stopped: 0, closed: 0, stops: 0}
    navigator.mediaDevices.getUserMedia = async () => ({getTracks: () => [{stop() {window.voiceTest.stopped++}}]})
    window.AudioContext = class {
      createAnalyser() {return {fftSize: 1024, getFloatTimeDomainData(samples) {samples.fill(0)}}}
      createMediaStreamSource() {return {connect() {}}} resume() {} close() {}
    }
    window.RTCPeerConnection = class {
      iceGatheringState = 'complete'
      addTrack() {}
      createDataChannel() {
        const channel = {readyState: 'open', send() {window.voiceTest.stops++}}
        window.voiceTest.channel = channel
        return channel
      }
      async createOffer() {return {sdp: 'offer', type: 'offer'}}
      async setLocalDescription(value) {this.localDescription = value}
      async setRemoteDescription() {window.voiceTest.channel.onmessage({data: JSON.stringify({type: 'ready'})})}
      close() {window.voiceTest.closed++}
    }
    window.voiceTest.emit = message => window.voiceTest.channel.onmessage({data: JSON.stringify(message)})
  })
}

test('识别全文覆盖不丢键盘尾部，Enter等待最终文本，只确认一次', async ({page}, testInfo) => {
  await mockSpeech(page); await open(page)
  await expect(page.locator('.voice-status')).toContainText('正在听')
  await page.evaluate(() => window.voiceTest.emit({type: 'transcript', text: '初稿'}))
  await page.getByLabel('小事正文', {exact: true}).fill('键盘补充')
  await page.evaluate(() => window.voiceTest.emit({type: 'transcript', text: '修订全文'}))
  await expect(page.getByLabel('小事正文', {exact: true})).toHaveValue('键盘补充')
  await expect(page.getByLabel('语音识别正文')).toHaveText('修订全文')
  await expect(page.getByLabel('小事正文', {exact: true})).toHaveCSS('outline-style', 'none')
  await page.screenshot({path: testInfo.outputPath('mixed-desktop.png'), fullPage: true})
  await page.setViewportSize({width: 390, height: 844})
  await page.screenshot({path: testInfo.outputPath('mixed-mobile.png'), fullPage: true})
  await page.getByLabel('小事正文', {exact: true}).press('Enter')
  await expect(page.locator('.voice-status')).toContainText('正在确认')
  await page.getByLabel('小事正文', {exact: true}).press('Enter')
  expect(await page.evaluate(() => window.voiceTest.stops)).toBe(1)
  await page.evaluate(() => window.voiceTest.emit({type: 'completed', text: '最终全文'}))
  await expect(page.locator('.score-card')).toBeVisible()
  await page.getByRole('button', {name: '不评分，完成', exact: true}).click()
  await expect(page.locator('.event-body').filter({hasText: '最终全文键盘补充'})).toHaveCount(1)
  expect(await page.evaluate(() => window.voiceTest.stopped)).toBe(1)
})

test('取消释放麦克风，输入法Enter不确认，识别失败保留混合草稿', async ({page}) => {
  await mockSpeech(page); await open(page)
  await expect(page.locator('.voice-status')).toContainText('正在听')
  await page.getByLabel('小事正文', {exact: true}).fill('保留键盘')
  await page.getByLabel('小事正文', {exact: true}).dispatchEvent('keydown', {key: 'Enter', isComposing: true})
  expect(await page.evaluate(() => window.voiceTest.stops)).toBe(0)
  await page.evaluate(() => {window.voiceTest.emit({type: 'transcript', text: '保留语音'}); window.voiceTest.emit({type: 'error', message: '测试识别中断'})})
  await expect(page.locator('.voice-status')).toHaveText('测试识别中断')
  await expect(page.getByLabel('小事正文', {exact: true})).toHaveValue('保留键盘')
  await expect(page.getByLabel('语音识别正文')).toHaveText('保留语音')
  await page.getByRole('button', {name: '关闭', exact: true}).click()
  expect(await page.evaluate(() => window.voiceTest.stopped)).toBe(1)
  expect(await page.evaluate(() => window.voiceTest.closed)).toBe(1)
  await expect(page.locator('dialog')).toHaveCount(0)
})
