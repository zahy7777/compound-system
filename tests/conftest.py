from pathlib import Path
import shutil
import subprocess

import pytest

from backend.event_kernel import Kernel, Protocol
from service.repo.events import EventRepo
from service.backup import Backup


PROTOCOL = Path(__file__).resolve().parents[3] / 'DATA' / 'compound-log' / 'main' / 'protocol.yaml'


def initialize(directory):
    directory.mkdir()
    shutil.copyfile(PROTOCOL, directory / 'protocol.yaml')
    (directory / 'logs.jsonl').write_text('', encoding='utf-8')
    for command in (['init', '-b', 'dev'], ['config', 'user.name', 'Compound Test'],
                    ['config', 'user.email', 'test@compound.local'], ['config', 'core.autocrlf', 'false'],
                    ['add', '.'], ['commit', '-m', 'test: 初始化隔离备份', '-m', '仅用于临时测试。']):
        subprocess.run(['git', '-C', str(directory), *command], check=True, capture_output=True, encoding='utf-8')
    return directory


@pytest.fixture
def system(tmp_path):
    directory = initialize(tmp_path / 'backup')
    protocol = Protocol(directory / 'protocol.yaml')
    repo = EventRepo(tmp_path / 'events.sqlite')
    return Kernel(repo, protocol), repo, Backup(repo, directory, protocol, 'dev')


def event(content='', area='待办', source_id=None, deleted=False, extra=()):
    return dict(system=dict(source_id=source_id, deleted=deleted), user=dict(event=content),
                meta=[dict(kind='业务区域', text=area), *extra])
