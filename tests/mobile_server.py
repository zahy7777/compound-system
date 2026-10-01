"""手机 E2E：真实前缀代理、登录、临时 Git/SQLite，不连接长期环境。"""
import asyncio
import os
from pathlib import Path
import sys
import tempfile
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from conftest import initialize
from backend.__main__ import make_app
from backend.access import Access
from backend.event_kernel import Kernel, Protocol
from service.repo.events import EventRepo
from service.backup import Backup
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'public_gateway'))
from router.app import create_app


async def main():
    with tempfile.TemporaryDirectory(prefix='compound-mobile-') as directory:
        root = Path(directory)
        repo_dir = initialize(root / 'backup')
        protocol = Protocol(repo_dir / 'protocol.yaml')
        repo = EventRepo(root / 'events.sqlite')
        backup = Backup(repo, repo_dir, protocol, 'dev')
        access = Access(root / 'access')
        access.document['password_hash'] = access.digest('mobile-test-password', access.document['salt'])
        backend = web.AppRunner(make_app(Kernel(repo,protocol),backup,access=access))
        await backend.setup()
        await web.TCPSite(backend,'127.0.0.1',19935).start()
        proxy = web.AppRunner(create_app({'/compound/dev':'http://127.0.0.1:19935'}, public_scheme='http'))
        await proxy.setup()
        await web.TCPSite(proxy,'127.0.0.1',19934).start()
        backup.start()
        print('隔离手机代理：http://127.0.0.1:19934/compound/dev/',flush=True)
        try:
            await asyncio.Event().wait()
        finally:
            await proxy.cleanup(); await backend.cleanup(); backup.close()


if __name__ == '__main__':
    asyncio.run(main())
