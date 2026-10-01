const {Tray, Menu, nativeImage, app} = require('electron')
const path = require('node:path')

exports.tray = (environment, show) => {
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../icon.png')))
  tray.setToolTip(`Compound · ${environment}`)
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: '运行界面', click: () => show('running')}, {label: '待办界面', click: () => show('todo')},
    {type: 'separator'}, {label: '退出', click: () => app.quit()},
  ]))
  tray.on('click', () => show('running')); return tray
}
