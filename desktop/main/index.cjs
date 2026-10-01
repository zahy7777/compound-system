const {app, ipcMain, dialog} = require('electron')
const path = require('node:path')
const {settings} = require('./settings.cjs')
const {window} = require('./window.cjs')
const {shortcuts} = require('./shortcuts.cjs')
const {tray} = require('./tray.cjs')

const environment = process.argv.includes('--prod') ? 'prod' : 'dev'
app.setPath('userData', process.env.COMPOUND_DESKTOP_DATA || path.join(app.getPath('appData'), `Compound-${environment}`))
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let desktop, keys, trayIcon
  app.on('second-instance', () => desktop?.toggle('running'))
  app.whenReady().then(() => {
    const address = process.env.COMPOUND_DESKTOP_URL || `http://127.0.0.1:${environment === 'dev' ? 19080 : 19081}/`
    const store = settings(app.getPath('userData'), environment)
    desktop = window(address, environment)
    const show = mode => desktop.toggle(mode).catch(error => dialog.showErrorBox('无法打开界面', error.message))
    keys = shortcuts(store, show); trayIcon = tray(environment, show)
    try {keys.start()} catch (error) {dialog.showErrorBox('快捷键注册失败', error.message)}
    function trusted(event) {if (event.sender !== desktop.win.webContents) throw new Error('未知页面')}
    ipcMain.handle('desktop:read-settings', event => {trusted(event); return store.read()})
    ipcMain.handle('desktop:save-settings', (event, value) => {trusted(event); keys.save(value); return store.read()})
  }).catch(error => {console.error(error); app.quit()})
  app.on('before-quit', () => {desktop?.quit(); keys?.close(); trayIcon?.destroy()})
  app.on('window-all-closed', () => {})
}
