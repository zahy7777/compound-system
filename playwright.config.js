import {defineConfig} from '@playwright/test'
import {resolve} from 'node:path'

const port = Number(process.env.COMPOUND_TEST_PORT || 19884)
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {baseURL: `http://127.0.0.1:${port}`, viewport: {width: 1440, height: 900}, trace: 'retain-on-failure'},
  webServer: {
    command: `"${resolve('.venv/Scripts/python.exe')}" tests/browser_server.py`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {PYTHONIOENCODING: 'utf-8', COMPOUND_TEST_PORT: String(port)},
  },
})
