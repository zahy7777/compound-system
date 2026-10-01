const http = require('node:http')
const {app,BrowserWindow} = require('electron')
const environment = process.argv[process.argv.indexOf('--env') + 1]
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const webPort = Number(process.argv[process.argv.indexOf('--web-port') + 1])
process.env.COMPOUND_DESKTOP_URL = `http://127.0.0.1:${webPort}/`
if (environment === 'prod') process.argv.push('--prod')
require('../../../desktop/main/index.cjs')
let server
app.whenReady().then(() => {
  server = http.createServer((request,response) => {
    if (request.url !== '/_tooldock/health') {response.writeHead(404); response.end(); return}
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'})
    response.end(JSON.stringify({app:'compound-desktop',environment,ready:BrowserWindow.getAllWindows().some(win => !win.isDestroyed() && !win.webContents.isLoading())}))
  }).listen(port,'127.0.0.1')
  server.on('error',error => {console.error(error.message); app.quit()})
})
app.on('before-quit',() => server?.close())
