"""单线程入口装配；GET 仅提供页面，业务只有 write/read。"""
import argparse
import json
import logging
from pathlib import Path
from aiohttp import web

from backend.kernel import Kernel, Protocol
from service.repo.facts import FactRepo
from service.backup import Backup, read_log


def make_app(kernel, backup):
    frontend = Path(__file__).resolve().parent.parent / 'frontend'
    app = web.Application(client_max_size=0)

    async def command(request):
        try:
            value = await request.json()
            # 收完输入后同步执行，不 await，不把事实操作交给线程池。
            result = kernel.write(value) if request.path == '/write' else kernel.read(value)
            if request.path == '/write':
                backup.wake.set()
        except (ValueError, KeyError) as error:
            return web.json_response({'error': str(error)}, status=400)
        return web.json_response(result)

    async def static(request):
        filename, mime = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
                          '/style.css': ('style.css', 'text/css')}[request.path]
        body = (frontend / filename).read_text(encoding='utf-8')
        if filename == 'index.html':
            body = body.replace('__PROTOCOL__', json.dumps(kernel.protocol.kinds, ensure_ascii=False).replace('<', '\\u003c'))
        return web.Response(text=body, content_type=mime, charset='utf-8')

    app.add_routes([web.post('/write', command), web.post('/read', command),
                    web.get('/', static), web.get('/app.js', static), web.get('/style.css', static)])
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
    directory = args.repo or root.parents[1] / 'DATA' / 'compound-log' / args.env
    database = args.db or root / 'instance' / args.env / 'facts.sqlite'
    protocol = Protocol(directory / 'protocol.yaml')
    repo = FactRepo(database)
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
        web.run_app(make_app(Kernel(repo, protocol), backup), host='127.0.0.1', port=port, print=None)
    finally:
        backup.close()


if __name__ == '__main__':
    main()
