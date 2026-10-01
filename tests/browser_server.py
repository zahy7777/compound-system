"""真实浏览器使用临时 dev Git 和 SQLite；退出后回收临时目录。"""
from pathlib import Path
import os
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from conftest import initialize
from backend.__main__ import make_server
from backend.kernel import Kernel, Protocol
from service.repo.facts import FactRepo
from service.backup import Backup


def main():
    with tempfile.TemporaryDirectory(prefix='compound-browser-') as temporary:
        directory = initialize(Path(temporary) / 'backup')
        protocol = Protocol(directory / 'protocol.yaml')
        repo = FactRepo(Path(temporary) / 'facts.sqlite')
        backup = Backup(repo, directory, protocol, 'dev')
        port = int(os.environ.get('COMPOUND_TEST_PORT', '19884'))
        server = make_server(Kernel(repo, protocol), backup, port)
        backup.start()
        print(f'隔离浏览器服务：http://127.0.0.1:{port}', flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()
            backup.close()


if __name__ == '__main__':
    main()
