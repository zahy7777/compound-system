const {BrowserWindow} = require('electron')
const path = require('node:path')

exports.window = (address, environment) => {
  let quitting = false, mode = 'running'
  const win = new BrowserWindow({width: 680, height: 640, minWidth: 360, minHeight: 300, show: false, skipTaskbar: true, title: `Compound ${environment}`, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}})
  win.setMenu(null)
  const url = next => {const value = new URL(address); value.searchParams.set('presentation', next); return value.href}
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
  win.webContents.on('will-navigate', (event, destination) => {if (new URL(destination).origin !== new URL(address).origin) event.preventDefault()})
  win.on('close', event => {if (!quitting) {event.preventDefault(); win.hide()}})
  win.once('ready-to-show', () => win.show())
  win.loadURL(url(mode)).catch(error => console.error('页面加载失败：', error.message))
  return {win,
    toggle: async next => {
      if (win.isVisible() && mode === next) {win.hide(); return}
      if (mode !== next) {await win.loadURL(url(next)); mode = next}
      win.show(); win.focus()
    },
    quit: () => {quitting = true},
  }
}
