"""单线程入口装配；语音连接与事实接口彼此独立。"""
import argparse
import json
import logging
import os
from dotenv import load_dotenv
from service.speech import Speech
from pathlib import Path
from aiohttp import web

from backend.event_kernel import Kernel, Protocol
from service.repo.events import EventRepo
from service.backup import Backup, read_log
from backend.api import API
from backend.access import Access
from backend.watch import Watch


def make_app(kernel, backup, speech=None, access=None):
    if speech is None:
        speech = Speech({key: os.environ.get(key, '') for key in
            ('TENCENTCLOUD_APPID', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'TENCENT_ASR_ENGINE')})
    api = API(kernel)
    watch = Watch(kernel, api.timer, api.workspace, api.loops, access.environment if access else 'dev', api.slice)
    commands = {'/writeevent': kernel.write, '/readevent': kernel.read,
                '/writeforest': api.writeforest, '/readforest': api.readforest,
                '/writelooptemplate': api.writelooptemplate, '/readlooptemplate': api.readlooptemplate,
                '/writetimer': api.writetimer, '/readtimer': api.readtimer,
                '/writeslice': api.writeslice, '/readslice': api.readslice}
    frontend = Path(__file__).resolve().parent.parent / 'frontend'
    app = web.Application(client_max_size=0, middlewares=[access.middleware] if access else [])
    if access:
        app.add_routes(access.routes())

    async def command(request):
        try:
            value = await request.json()
            # 收完输入后同步执行，不 await，不把事实操作交给线程池。
            result = commands[request.path](value)
            if request.path == '/writeevent':
                backup.wake.set()
        except (ValueError, KeyError) as error:
            return web.json_response({'error': str(error)}, status=400)
        return web.json_response(result)

    async def watch_snapshot(request):
        return web.json_response(watch.snapshot(), headers={'Cache-Control': 'no-store'})

    async def watch_action(request):
        try:
            value = await request.json()
            result = watch.perform(value)
            backup.wake.set()
            return web.json_response(result, headers={'Cache-Control': 'no-store'})
        except (ValueError, KeyError, TypeError) as error:
            return web.json_response({'error': str(error)}, status=400)

    async def static(request):
        filename, mime = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
                          '/style.css': ('style.css', 'text/css')}[request.path]
        body = (frontend / filename).read_text(encoding='utf-8')
        if filename == 'index.html':
            body = body.replace('__PROTOCOL__', json.dumps(kernel.protocol.kinds, ensure_ascii=False).replace('<', '\\u003c'))
        return web.Response(text=body, content_type=mime, charset='utf-8')

    async def favicon(request):
        return web.FileResponse(frontend / 'favicon.png')

    async def speech_config(request):
        return web.json_response({'configured': speech.configured})

    async def speech_stream(request):
        if not speech.configured:
            return web.json_response({'error': '语音未配置，仍可键盘输入'}, status=400)
        socket = web.WebSocketResponse(max_msg_size=32_000, heartbeat=20)
        await socket.prepare(request)
        if access and not await access.authorize_socket(request, socket):
            return socket
        if not access:
            await socket.send_json({'type': 'authorized'})
        await speech.serve(socket)
        return socket

    async def speech_processor(request):
        return web.FileResponse(frontend / 'plugin' / 'speech' / 'processor.js')

    async def close_speech(app):
        await speech.close()

    app.on_cleanup.append(close_speech)
    app.add_routes([web.get('/speech/config', speech_config), web.get('/speech/stream', speech_stream),
                    web.get('/speech/processor.js', speech_processor)])
    app.add_routes([web.get('/watch/snapshot', watch_snapshot), web.post('/watch/action', watch_action)])
    app.add_routes([*[web.post(path, command) for path in commands],
                    web.get('/', static), web.get('/app.js', static), web.get('/style.css', static),
                    web.get('/favicon.png', favicon)])
    app.router.add_static('/theme/assets/', frontend / 'theme' / 'assets')
    return app


def main():
    parser = argparse.ArgumentParser(description='Compound 单线程内核')
    parser.add_argument('--env', choices=('dev', 'prod'), default='dev')
    parser.add_argument('--repo', type=Path)
    parser.add_argument('--db', type=Path)
    parser.add_argument('--port', type=int)
    parser.add_argument('--restore', action='store_true', help='从备份恢复到空数据库后退出')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / '.env')
    directory = args.repo or root.parents[1] / 'DATA' / 'compound-log' / args.env
    database = args.db or root / 'instance' / args.env / 'events.sqlite'
    protocol = Protocol(directory / 'protocol.yaml')
    repo = EventRepo(database)
    if args.restore:
        repo.restore(read_log(directory / 'logs.jsonl', protocol))
        print('恢复完成：' + str(database), flush=True)
        return
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    backup = Backup(repo, directory, protocol, args.env)
    backup.start()
    port = args.port or (19080 if args.env == 'dev' else 19081)
    print(f'Compound {args.env}: http://127.0.0.1:{port}', flush=True)
    try:
        access = Access(database.parent, args.env)
        web.run_app(make_app(Kernel(repo, protocol), backup, access=access), host='127.0.0.1', port=port, print=None)
    finally:
        backup.close()


if __name__ == '__main__':
    main()
