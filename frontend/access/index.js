/** 请求地址与会话属于访问入口，业务概念只使用装配后的请求能力。 */
export function createAccess() {
  const base = new URL('.', location.href)
  let csrf = null, publicAccess = false
  async function request(path, options = {}) {
    const headers = new Headers(options.headers)
    if (csrf && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf)
    return fetch(new URL(path.replace(/^\//, ''), base), {...options, headers})
  }
  async function enter(root) {
    const response = await request('/access/session')
    const session = await response.json()
    if (!response.ok) throw new Error(session.error || '无法读取登录状态')
    csrf = session.csrf
    publicAccess = !session.local
    if (session.authenticated) return
    await new Promise(resolve => {
      const form = document.createElement('form'); form.className = 'login-card'
      const title = document.createElement('h1'); title.textContent = 'Compound'
      const hint = document.createElement('p'); hint.textContent = `登录 ${session.environment}`
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'current-password'; input.required = true; input.setAttribute('aria-label', '登录密码')
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = '登录'; button.className = 'primary'
      const error = document.createElement('p'); error.setAttribute('role','alert'); error.className = 'dialog-error'
      form.append(title,hint,input,error,button); root.replaceChildren(form); root.dataset.access = 'login'; input.focus()
      form.onsubmit = async event => {
        event.preventDefault(); button.disabled = true
        try {
          const response = await request('/access/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:input.value})})
          const result = await response.json(); if (!response.ok) throw new Error(result.error)
          csrf = result.csrf; input.value = ''; delete root.dataset.access; resolve()
        } catch (failure) {error.textContent = failure.message} finally {button.disabled = false}
      }
    })
  }
  async function logout() {
    const response = await request('/access/logout', {method:'POST'})
    if (!response.ok) throw new Error('退出失败')
    location.reload()
  }
  return {request, enter, logout, get public() {return publicAccess}}
}
