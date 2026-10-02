import asyncio
import json
import sqlite3

import pytest
from aiohttp.test_utils import TestClient, TestServer

from backend.api import API
from backend.__main__ import make_app
from backend.access import Access
from backend.event_kernel import Protocol
from conftest import event
from service.backup import read_log
from service.repo.events import EventRepo


def test_slice_replace_restart_and_transaction_rollback(system):
    kernel, repo, _ = system
    api = API(kernel)
    assert api.readslice(None) == []
    assert api.writeslice(['训练', '福利']) == ['训练', '福利']
    assert API(type(kernel)(EventRepo(repo.path), kernel.protocol)).readslice(None) == ['训练', '福利']
    with pytest.raises(RuntimeError):
        with repo.transaction() as transaction:
            api.slice.write(['不提交'], transaction)
            raise RuntimeError('回滚')
    assert api.readslice(None) == ['训练', '福利']
    api.writeslice(['福利'])
    with repo.connection() as conn:
        assert conn.execute('SELECT COUNT(*) FROM slices').fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO slices VALUES (2,'[]')")
    api.writeslice([])
    assert api.readslice(None) == []


@pytest.mark.parametrize('names', [None, {}, '训练', [''], [' '], [' 训练'], ['训练 '], ['训\n练'], ['训\r练'], ['训练', '训练'], ['小事'], [1]])
def test_slice_validation_preserves_previous_array(system, names):
    api = API(system[0])
    api.writeslice(['原切片'])
    with pytest.raises(ValueError):
        api.writeslice(names)
    assert api.readslice(None) == ['原切片']


def test_slice_tag_query_backup_and_restore(system, tmp_path):
    kernel, repo, backup = system
    tag = dict(kind='区域切片', text='训练')
    kernel.write([event('旧格式'), event('新格式', extra=[tag])])
    assert len(kernel.read([[dict(kind='业务区域', text='待办')]])[0]) == 2
    assert [value['user']['event'] for value in kernel.read([[tag]])[0]] == ['新格式']
    with pytest.raises(ValueError, match='数量'):
        kernel.write([event(extra=[tag, dict(kind='区域切片', text='福利')])])
    for text in (' ', '训\n练'):
        with pytest.raises(ValueError):
            kernel.write([event(extra=[dict(kind='区域切片', text=text)])])
    API(kernel).writeslice(['训练'])
    backup.flush()
    records = read_log(backup.path, Protocol(backup.directory / 'protocol.yaml'))
    restored = EventRepo(tmp_path / 'restored.sqlite')
    restored.restore(records)
    assert restored.read([[]]) == repo.read([[]])
    assert API(type(kernel)(restored, kernel.protocol)).readslice(None) == []
    assert 'payload' not in backup.path.read_text(encoding='utf-8')


def test_slice_http_authentication_csrf_and_invalid_read(system, tmp_path):
    async def scenario():
        access = Access(tmp_path / 'access', protect_local=True)
        async with TestClient(TestServer(make_app(system[0], system[2], access=access))) as client:
            for path, value in [('/readslice', None), ('/writeslice', ['训练'])]:
                assert (await client.post(path, data=json.dumps(value), headers={'Content-Type': 'application/json'})).status == 401
            password = (access.path.parent / 'initial-password.txt').read_text(encoding='utf-8')
            login = await client.post('/access/login', json={'password': password})
            client.session.cookie_jar.update_cookies({access.cookie: login.cookies[access.cookie].value})
            headers = {'X-CSRF-Token': (await login.json())['csrf'], 'Content-Type': 'application/json'}
            assert (await client.post('/writeslice', json=['训练'])).status == 403
            response = await client.post('/writeslice', json=['训练'], headers=headers)
            assert response.status == 200 and await response.json() == ['训练']
            response = await client.post('/readslice', data='null', headers=headers)
            assert response.status == 200 and await response.json() == ['训练']
            assert (await client.post('/readslice', json=[], headers=headers)).status == 400
            assert (await client.post('/writeslice', json=['小事'], headers=headers)).status == 400
    asyncio.run(scenario())
