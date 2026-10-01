"""单线程入口装配；GET 仅提供页面，业务只有 write/read。"""
import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import logging
from pathlib import Path

from backend.kernel import Kernel, Protocol
from service.repo.facts import FactRepo
from service.backup import Backup, read_log


def make_server(kernel, backup, port):
    frontend = Path(__file__).resolve().parent.parent / 'frontend'

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, value, content_type='application/json; charset=utf-8'):
            body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.path not in ('/write', '/read'):
                self.send(404, {'error': '业务接口只有 write/read'})
                return
            try:
                value = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))).decode('utf-8'))
                result = kernel.write(value) if self.path == '/write' else kernel.read(value)
                if self.path == '/write':
                    backup.wake.set()
            except (ValueError, KeyError) as error:
                self.send(400, {'error': str(error)})
                return
            self.send(200, result)

        def do_GET(self):
            files = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'),
                     '/style.css': ('style.css', 'text/css')}
            if self.path not in files:
                self.send(404, {'error': '文件不存在'})
                return
            filename, mime = files[self.path]
            body = (frontend / filename).read_text(encoding='utf-8')
            if filename == 'index.html':
                body = body.replace('__PROTOCOL__', json.dumps(kernel.protocol.kinds, ensure_ascii=False).replace('<', '\\u003c'))
            self.send(200, body.encode('utf-8'), mime + '; charset=utf-8')

    return HTTPServer(('127.0.0.1', port), Handler)


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
    server = make_server(Kernel(repo, protocol), backup, args.port or (19080 if args.env == 'dev' else 19081))
    backup.start()
    print(f'Compound {args.env}: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        backup.close()


if __name__ == '__main__':
    main()
