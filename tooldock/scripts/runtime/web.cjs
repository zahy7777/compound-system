const http = require('node:http')
const environment = process.argv[process.argv.indexOf('--env') + 1]
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const backend = Number(process.argv[process.argv.indexOf('--backend-port') + 1])
const server = http.createServer((request,response) => {
  if (request.url === '/_tooldock/health') {
    response.writeHead(200,{'Content-Type':'application/json; charset=utf-8'})
    response.end(JSON.stringify({app:'compound-web',environment})); return
  }
  const upstream = http.request({hostname:'127.0.0.1',port:backend,path:request.url,method:request.method,headers:{...request.headers,host:`127.0.0.1:${backend}`}}, result => {
    response.writeHead(result.statusCode,result.headers); result.pipe(response)
  })
  upstream.on('error',() => {if (!response.headersSent) response.writeHead(502,{'Content-Type':'application/json; charset=utf-8'}); response.end(JSON.stringify({error:'Compound 后端未就绪'}))})
  request.on('aborted',() => upstream.destroy()); request.pipe(upstream)
})
server.listen(port,'127.0.0.1')
server.on('error',error => {console.error(error.message); process.exit(1)})
