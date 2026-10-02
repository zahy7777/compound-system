"""公网访问身份；不读取事实、森林或计时状态。"""
import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path

from aiohttp import web


class Access:
    def __init__(self, directory: Path, environment='dev', protect_local=False):
        self.environment = environment
        self.prefix = f'/compound/{environment}'
        self.cookie = f'compound_{environment}'
        self.protect_local = protect_local
        self.attempts = {}
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / 'access.json'
        if not self.path.exists():
            password = secrets.token_urlsafe(18)
            salt = secrets.token_hex(16)
            document = {'salt': salt, 'password_hash': self.digest(password, salt), 'secret': secrets.token_hex(32), 'watch_epoch': 0}
            self.path.write_text(json.dumps(document), encoding='utf-8')
            (directory / 'initial-password.txt').write_text(password, encoding='utf-8')
        self.document = json.loads(self.path.read_text(encoding='utf-8'))
        self.secret = bytes.fromhex(self.document['secret'])

    @staticmethod
    def digest(password, salt):
        return hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), 600000).hex()

    def signature(self, text):
        return hmac.new(self.secret, text.encode('utf-8'), hashlib.sha256).hexdigest()

    def session(self, request):
        token = request.cookies.get(self.cookie, '')
        try:
            payload, signature = token.split('.')
            if not hmac.compare_digest(signature, self.signature(payload)):
                return None
            value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            if value['expires'] <= time.time():
                return None
            return self.signature('csrf:' + token)
        except (ValueError, KeyError, TypeError):
            return None

    def watch_session(self, request):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return None
        token = header[7:]
        try:
            payload, signature = token.split('.')
            if not hmac.compare_digest(signature, self.signature('watch:' + payload)):
                return None
            value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            if (value['scope'] != 'watch' or value['environment'] != self.environment
                    or value['expires'] <= time.time()
                    or value['epoch'] != self.document.get('watch_epoch', 0)):
                return None
            return value
        except (ValueError, KeyError, TypeError):
            return None

    def public(self, request):
        return self.protect_local or 'X-Forwarded-Prefix' in request.headers

    def origin_valid(self, request):
        origin = request.headers.get('Origin')
        host = request.headers.get('X-Forwarded-Host', request.host)
        scheme = request.headers.get('X-Forwarded-Proto', request.scheme)
        return not origin or origin == f'{scheme}://{host}'

    @web.middleware
    async def middleware(self, request, handler):
        forwarded = request.headers.get('X-Forwarded-Prefix')
        if forwarded and forwarded != self.prefix:
            return web.json_response({'error': '访问环境不匹配'}, status=404)
        if self.public(request):
            if request.path.startswith('/watch/'):
                if not self.watch_session(request):
                    return web.json_response({'error': '手表授权已失效，请在 iPhone 打开 Compound 重新授权'}, status=401)
                return await handler(request)
            if (request.method not in {'GET', 'HEAD'} or request.headers.get('Upgrade', '').lower() == 'websocket') and not self.origin_valid(request):
                return web.json_response({'error': '请求来源不匹配'}, status=403)
            static_asset = request.method in {'GET', 'HEAD'} and request.path.startswith('/theme/assets/')
            if not static_asset and request.path not in {'/', '/app.js', '/style.css', '/favicon.png', '/access/session', '/access/login'}:
                csrf = self.session(request)
                if not csrf:
                    return web.json_response({'error': '请先登录'}, status=401)
                if request.method not in {'GET', 'HEAD'} and not hmac.compare_digest(request.headers.get('X-CSRF-Token', ''), csrf):
                    return web.json_response({'error': '会话校验失败，请刷新'}, status=403)
        return await handler(request)

    async def authorize_socket(self, request, socket):
        """浏览器不能设置 WS 请求头；首条消息校验会话，成功才交付业务。"""
        try:
            message = await socket.receive_json(timeout=5)
            token = self.session(request) if self.public(request) else None
            if not isinstance(message, dict) or set(message) != {'type', 'csrf'} or message['type'] != 'authorize':
                raise ValueError('语音连接需要先校验会话')
            if self.public(request) and (not token or not isinstance(message['csrf'], str) or not hmac.compare_digest(message['csrf'], token)):
                raise ValueError('会话校验失败，请刷新')
        except (ValueError, TypeError, asyncio.TimeoutError):
            if not socket.closed:
                await socket.send_json({'type': 'error', 'message': '语音连接会话校验失败，请刷新'})
            await socket.close(code=1008)
            return False
        await socket.send_json({'type': 'authorized'})
        return True

    async def read(self, request):
        if not self.public(request):
            return web.json_response({'authenticated': True, 'local': True, 'environment': self.environment})
        csrf = self.session(request)
        return web.json_response({'authenticated': bool(csrf), 'csrf': csrf, 'environment': self.environment}, headers={'Cache-Control': 'no-store'})

    async def login(self, request):
        address = request.headers.get('X-Forwarded-For', request.remote)
        now = time.time()
        count, start = self.attempts.get(address, (0, now))
        if now - start >= 60:
            count, start = 0, now
        if count >= 10:
            return web.json_response({'error': '尝试过多，请一分钟后再试'}, status=429)
        try:
            value = await request.json()
            password = value['password']
            if not isinstance(password, str) or len(password) > 256:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return web.json_response({'error': '请输入密码'}, status=400)
        if not hmac.compare_digest(self.digest(password, self.document['salt']), self.document['password_hash']):
            self.attempts[address] = (count + 1, start)
            return web.json_response({'error': '密码不正确'}, status=401)
        self.attempts.pop(address, None)
        payload = base64.urlsafe_b64encode(json.dumps({'expires': int(now) + 7 * 86400, 'nonce': secrets.token_hex(16)}).encode('utf-8')).decode().rstrip('=')
        token = payload + '.' + self.signature(payload)
        response = web.json_response({'authenticated': True, 'csrf': self.signature('csrf:' + token)}, headers={'Cache-Control': 'no-store'})
        response.set_cookie(self.cookie, token, path=self.prefix + '/' if request.headers.get('X-Forwarded-Prefix') else '/',
                            httponly=True, secure=request.headers.get('X-Forwarded-Proto') == 'https', samesite='strict', max_age=7 * 86400)
        return response

    async def logout(self, request):
        response = web.json_response({'authenticated': False})
        response.del_cookie(self.cookie, path=self.prefix + '/' if request.headers.get('X-Forwarded-Prefix') else '/')
        return response

    async def issue_watch_token(self, request):
        now = int(time.time())
        value = {'scope': 'watch', 'environment': self.environment, 'epoch': self.document.get('watch_epoch', 0),
                 'expires': now + 90 * 86400, 'nonce': secrets.token_hex(16)}
        payload = base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode('utf-8')).decode().rstrip('=')
        return web.json_response({'token': payload + '.' + self.signature('watch:' + payload),
                                  'expiresAt': value['expires'], 'environment': self.environment},
                                 headers={'Cache-Control': 'no-store'})

    async def revoke_watch_tokens(self, request):
        self.document['watch_epoch'] = self.document.get('watch_epoch', 0) + 1
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.document), encoding='utf-8')
        temporary.replace(self.path)
        return web.json_response({'revoked': True})

    def routes(self):
        return [web.get('/access/session', self.read), web.post('/access/login', self.login), web.post('/access/logout', self.logout),
                web.post('/access/watch-token', self.issue_watch_token), web.post('/access/watch-revoke', self.revoke_watch_tokens)]
