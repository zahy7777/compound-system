import asyncio

from aiohttp import ClientSession, CookieJar, web
from backend.access import Access


def test_public_session_csrf_environment_logout(tmp_path):
    async def scenario():
        access = Access(tmp_path)
        app = web.Application(middlewares=[access.middleware])
        app.add_routes(access.routes())
        async def write(request):
            return web.json_response({'ok': True})
        app.router.add_post('/writeevent', write)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, '127.0.0.1', 0)
        await site.start()
        base = f'http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}'
        headers = {'X-Forwarded-Prefix': '/compound/dev', 'X-Forwarded-Host': 'phone.test', 'X-Forwarded-Proto':'http'}
        try:
            async with ClientSession(cookie_jar=CookieJar(unsafe=True), headers=headers) as client:
                assert (await client.post(base + '/writeevent', json=[])).status == 401
                assert (await client.get(base + '/speech/config')).status == 401
                assert (await client.post(base + '/access/login', json={'password':'wrong'})).status == 401
                password = (tmp_path / 'initial-password.txt').read_text(encoding='utf-8')
                login = await client.post(base + '/access/login', json={'password':password})
                assert login.status == 200
                assert 'HttpOnly' in login.headers['Set-Cookie']
                assert 'Path=/compound/dev/' in login.headers['Set-Cookie']
                # 上游测试路径无前缀，手动提交真实签名 Cookie。
                token = login.cookies[access.cookie].value
                csrf = (await login.json())['csrf']
                cookies = {access.cookie:token}
                assert (await client.post(base + '/writeevent', json=[], cookies=cookies)).status == 403
                assert (await client.post(base + '/writeevent', json=[], cookies=cookies, headers={'X-CSRF-Token':csrf})).status == 200
                assert (await client.post(base + '/writeevent', json=[], cookies=cookies, headers={'X-CSRF-Token':csrf, 'Origin':'https://other.test'})).status == 403
                assert (await client.get(base + '/access/session', cookies=cookies, headers={'X-Forwarded-Prefix':'/compound/prod'})).status == 404
                logout = await client.post(base + '/access/logout', cookies=cookies, headers={'X-CSRF-Token':csrf})
                assert logout.status == 200 and 'Max-Age=0' in logout.headers['Set-Cookie']
                assert not (await (await client.get(base + '/access/session')).json())['authenticated']
            async with ClientSession() as client:
                assert (await (await client.get(base + '/access/session')).json())['local']
        finally:
            await runner.cleanup()
    asyncio.run(scenario())
