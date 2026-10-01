import {defineConfig} from '@playwright/test'
import {resolve} from 'node:path'

const port = Number(process.env.COMPOUND_TEST_PORT || 19884)
const mobilePort = Number(process.env.COMPOUND_TEST_MOBILE_PORT || 19934)
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {baseURL: `http://127.0.0.1:${port}`, viewport: {width: 1440, height: 900}, launchOptions: process.env.COMPOUND_TEST_SPEECH === '1' ? {args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${resolve(process.env.COMPOUND_SPEECH_AUDIO || 'tests/fixtures/speech-with-pause.wav')}`]} : {}, trace: 'retain-on-failure'},
  webServer: [{
    command: `"${resolve('.venv/Scripts/python.exe')}" tests/browser_server.py`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {PYTHONIOENCODING: 'utf-8', COMPOUND_TEST_PORT: String(port)},
  }, {
    command: `"${resolve('.venv/Scripts/python.exe')}" tests/mobile_server.py`,
    url: `http://127.0.0.1:${mobilePort}/compound/dev/`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {PYTHONIOENCODING:'utf-8'},
  }],
})
