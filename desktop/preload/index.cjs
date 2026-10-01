const {contextBridge, ipcRenderer} = require('electron')
contextBridge.exposeInMainWorld('compoundDesktop', {
  readSettings: () => ipcRenderer.invoke('desktop:read-settings'),
  saveSettings: value => ipcRenderer.invoke('desktop:save-settings', value),
})
