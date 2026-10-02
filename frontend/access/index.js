/** 请求地址与会话属于访问入口，业务概念只使用装配后的请求能力。 */
export function createAccess() {
  const base = new URL('.', location.href)
  let csrf = null, publicAccess = false
  async function request(path, options = {}) {
    const headers = new Headers(options.headers)
    if (csrf && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf)
    return fetch(new URL(path.replace(/^\//, ''), base), {...options, headers})
  }
  function openSocket(path, {signal} = {}) {
    const url = new URL(path.replace(/^\//, ''), base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const timeout = setTimeout(() => finish(new Error('语音连接超时')), 10000)
      const abort = () => finish(new Error('语音连接已取消'))
      function finish(error) {
        clearTimeout(timeout); signal?.removeEventListener('abort', abort)
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
        if (error) {socket.close(); reject(error)} else resolve(socket)
      }
      socket.onopen = () => socket.send(JSON.stringify({type: 'authorize', csrf}))
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'authorized') finish()
          else finish(new Error(message.message || '语音会话校验失败'))
        } catch {finish(new Error('语音会话返回无效消息'))}
      }
      socket.onerror = socket.onclose = () => finish(new Error('语音连接失败，请检查登录和网络'))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, {once: true})
    })
  }
  async function enter(root) {
    const response = await request('/access/session')
    const session = await response.json()
    if (!response.ok) throw new Error(session.error || '无法读取登录状态')
    csrf = session.csrf ?? null
    publicAccess = !session.local
    if (session.authenticated) return
    await new Promise(resolve => {
      const form = document.createElement('form'); form.className = 'login-card'
      const title = document.createElement('h1'); title.textContent = 'Compound'
      const hint = document.createElement('p'); hint.textContent = `登录 ${session.environment}`
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'current-password'; input.required = true; input.setAttribute('aria-label', '登录密码')
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = '登录'; button.className = 'primary'
      const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'dialog-error'
      let completed = false
      async function login(password) {
        if (completed) return true
        button.disabled = true; error.textContent = ''
        try {
          const response = await request('/access/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})})
          const result = await response.json(); if (!response.ok) throw new Error(result.error)
          completed = true; csrf = result.csrf; input.value = ''; delete root.dataset.access; resolve(); return true
        } catch (failure) {error.textContent = failure.message; throw failure}
        finally {button.disabled = false}
      }
      form.append(title,hint,input,error,button); root.replaceChildren(form); root.dataset.access = 'login'; input.focus()
      window.compoundNativeLogin = login
      window.webkit?.messageHandlers?.compoundAccess?.postMessage({type:'loginRequired', environment:session.environment})
      form.onsubmit = event => {event.preventDefault(); login(input.value).catch(() => {})}
    })
    delete window.compoundNativeLogin
  }
  async function logout() {
    const response = await request('/access/logout', {method:'POST'})
    if (!response.ok) throw new Error('退出失败')
    location.reload()
  }
  async function provisionWatch() {
    if (!publicAccess || !window.webkit?.messageHandlers?.compoundAccess) return
    const response = await request('/access/watch-token', {method:'POST'})
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || '无法授权 Apple Watch')
    window.webkit.messageHandlers.compoundAccess.postMessage({type:'watchCredential', ...value, baseURL:base.href})
  }
  return {request, openSocket, enter, logout, provisionWatch, get public() {return publicAccess}}
}
