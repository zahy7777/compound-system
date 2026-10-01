from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
import json
import threading

import pytest

from backend.__main__ import make_server
from conftest import fact


def test_versions_filter_latest_before_tags_and_delete(system):
    kernel, repo, _ = system
    first = kernel.write([fact()])[0]
    assert first == dict(version_id=1, source_id=1)
    kernel.write([fact('已完成', '归档', source_id=1)])
    assert kernel.read([[dict(kind='业务区域', text='待办')]]) == [[]]
    current = kernel.read([[]])[0]
    assert current[0]['user']['event'] == '已完成'
    kernel.write([fact('已完成', '归档', source_id=1, deleted=True)])
    assert kernel.read([[]]) == [[]]
    assert [row['system']['version_id'] for row in repo.versions_after(0)] == [1, 2, 3]


def test_batch_query_subset_and_whole_version_replacement(system):
    kernel, _, _ = system
    tags = [dict(kind='复利事项', text='运动'), dict(kind='属性', text='评分:4')]
    kernel.write([fact('游泳', extra=tags), fact('散步', extra=tags[:1])])
    result = kernel.read([[tags[0]], [tags[1]], []])
    assert list(map(len, result)) == [2, 1, 2]
    kernel.write([fact('修改', source_id=1)])
    assert len(kernel.read([[tags[0]]])[0]) == 1


def test_batch_rolls_back_when_source_missing(system):
    kernel, repo, _ = system
    with pytest.raises(ValueError, match='源 ID'):
        kernel.write([fact('应回滚'), fact(source_id=1000)])
    assert repo.versions_after(0) == []
    assert kernel.write([fact()])[0]['version_id'] == 1


@pytest.mark.parametrize('tags', [
    [],
    [dict(kind='业务区域', text='小事')],
    [dict(kind='业务区域', text='待办'), dict(kind='业务区域', text='运行')],
    [dict(kind='业务区域', text='待办'), dict(kind='补充', text='评分:4')],
    [dict(kind='业务区域', text='待办'), dict(kind='属性', text='评分:0')],
    [dict(kind='业务区域', text='待办'), dict(kind='属性', text='评分:3'), dict(kind='属性', text='评分:4')],
    [dict(kind='业务区域', text='待办'), dict(kind='属性', text='耗时:-1s')],
    [dict(kind='业务区域', text='待办'), dict(kind='属性', text='耗时:1.1234567s')],
    [dict(kind='业务区域', text='待办'), dict(kind='属性', text='日期:2026-02-30')],
    [dict(kind='业务区域', text='待办'), dict(kind='闭环', text='无ID')],
    [dict(kind='业务区域', text='待办'), dict(kind='闭环', text='闭环#' + 'a'*32 + '|   ')],
])
def test_invalid_protocol_rejected_before_write(system, tags):
    kernel, repo, _ = system
    value = fact()
    value['meta'] = tags
    with pytest.raises(ValueError):
        kernel.write([value])
    assert repo.versions_after(0) == []


def test_http_concurrent_clients_are_serialized_and_only_two_routes(system):
    kernel, repo, backup = system
    server = make_server(kernel, backup, 0)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'

    def write(index):
        request = Request(base + '/write', data=json.dumps([fact(str(index))]).encode('utf-8'),
                          headers={'Content-Type': 'application/json'}, method='POST')
        with urlopen(request) as response:
            return json.load(response)[0]
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            identities = list(pool.map(write, range(24)))
        assert sorted(row['version_id'] for row in identities) == list(range(1, 25))
        assert len(set(row['source_id'] for row in identities)) == 24
        from urllib.error import HTTPError
        with pytest.raises(HTTPError) as caught:
            urlopen(Request(base + '/delete', data=b'[]', method='POST'))
        assert caught.value.code == 404
        assert len(repo.versions_after(0)) == 24
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
