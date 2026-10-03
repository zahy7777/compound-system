from copy import deepcopy
import re

import pytest

from backend.watch import Watch


LOOP_ID = 'a' * 32
LOOP_TEXT = f'闭环#{LOOP_ID}|晨间'


class Protocol:
    patterns = {
        '闭环': {'loop': re.compile(r'闭环#(?P<id>[a-f0-9]{32})\|(?P<name>.+)')},
        '属性': {'耗时': re.compile(r'耗时:(?P<value>[0-9]+(?:\.[0-9]+)?)s')},
    }
    kinds = {'闭环': {'patterns': {'loop': {'template': '闭环#{id}|{name}'}}}}


class Events:
    protocol = Protocol()

    def __init__(self):
        self.values = [
            self.event(1, '正在积累', '结果'),
            self.event(2, '运行小事', '运行'),
            self.event(3, '组内待办', '待办', [{'kind': '闭环', 'text': LOOP_TEXT}]),
        ]

    @staticmethod
    def event(source_id, text, area, extra=()):
        return {'system': {'version_id': source_id, 'source_id': source_id, 'deleted': False},
                'user': {'event': text}, 'meta': [{'kind': '业务区域', 'text': area}, *extra]}

    def read(self, queries):
        return [deepcopy(self.values)]

    def write(self, values):
        result = []
        for value in values:
            source_id = value['system']['source_id']
            if source_id is None:
                source_id = max((event['system']['source_id'] for event in self.values), default=0) + 1
                self.values.append({**deepcopy(value), 'system': {'version_id': source_id,
                                   'source_id': source_id, 'deleted': False}})
            else:
                index = next(i for i, event in enumerate(self.values)
                             if event['system']['source_id'] == source_id)
                if value['system']['deleted']:
                    self.values.pop(index)
                else:
                    self.values[index] = {**deepcopy(value), 'system': {**value['system'],
                                          'version_id': source_id + 100}}
            result.append({'source_id': source_id})
        return result


class Timer:
    def __init__(self):
        self.values = {'1': {'key': '1', 'state': 'running', 'elapsed_ms': 1200},
                       '2': {'key': '2', 'state': 'paused', 'elapsed_ms': 4000}}

    def read(self, keys):
        return [self.values.get(key) for key in keys]

    def write(self, key, state):
        current = self.values.get(key, {'key': key, 'state': 'paused', 'elapsed_ms': 0})
        if state == 'reset':
            current = {'key': key, 'state': 'paused', 'elapsed_ms': 0}
        else:
            current = {**current, 'state': state}
        self.values[key] = current
        return current


class Workspace:
    def __init__(self):
        node = lambda area: {'tag': {'kind': '业务区域', 'text': area}, 'is_fold': False,
                             'children': []}
        self.value = {'version_id': 1, 'item_template_id': None,
                      'forest': [node('结果'), node('待办'), node('运行'), node('归档')]}
        self.value['forest'][1]['children'].append(
            {'tag': {'kind': '闭环', 'text': LOOP_TEXT}, 'is_fold': False, 'children': []})

    def read(self):
        return deepcopy(self.value)

    def save(self, value):
        self.value = {'version_id': self.value['version_id'] + 1, **deepcopy(value)}
        return {'version_id': self.value['version_id']}


class Templates:
    def __init__(self):
        self.values = [{
            'id': 7,
            'events': [
                {'user': {'event': '模板小事一'}, 'meta': [{'kind': '闭环', 'text': '晚间'}]},
                {'user': {'event': '模板小事二'}, 'meta': [{'kind': '闭环', 'text': '晚间'}]},
            ],
        }]

    def read(self, ids=None):
        return deepcopy([value for value in self.values if ids is None or value['id'] in ids])


class Slices:
    def __init__(self, names=()):
        self.names = list(names)

    def read(self):
        return list(self.names)


@pytest.fixture
def system():
    events, timer, workspace, templates = Events(), Timer(), Workspace(), Templates()
    return Watch(events, timer, workspace, templates, 'dev', Slices()), events, timer, workspace


def test_watch_snapshot_contains_empty_forest_loops_and_templates(system):
    watch, _, _, workspace = system
    empty_id = 'b' * 32
    workspace.value['forest'][1]['children'].append(
        {'tag': {'kind': '闭环', 'text': f'闭环#{empty_id}|空闭环'}, 'is_fold': False, 'children': []})

    snapshot = watch.snapshot()

    assert snapshot['environment'] == 'DEV'
    assert snapshot['resultTimers'][0]['title'] == '正在积累'
    assert snapshot['running']['direct'][0]['timerState'] == 'paused'
    assert [(loop['name'], len(loop['items'])) for loop in snapshot['todo']['loops']] == [('晨间', 1), ('空闭环', 0)]
    assert snapshot['templates'] == [{'id': 7, 'name': '晚间', 'itemCount': 2}]


def test_watch_run_and_archive_keep_rules_on_server(system):
    watch, events, timer, _ = system

    watch.perform({'action': 'run', 'itemID': '3'})
    assert timer.values['1']['state'] == 'paused'
    assert timer.values['3']['state'] == 'running'
    assert next(tag['text'] for tag in events.values[2]['meta'] if tag['kind'] == '业务区域') == '运行'

    watch.perform({'action': 'archive', 'itemID': '3'})
    current = events.values[2]
    assert next(tag['text'] for tag in current['meta'] if tag['kind'] == '业务区域') == '归档'
    assert timer.values['3']['elapsed_ms'] == 0
    assert any(tag['text'] == '耗时:0s' for tag in current['meta'])


def test_watch_creates_direct_todo_empty_loop_and_loop_item(system):
    watch, events, _, _ = system

    snapshot = watch.perform({'action': 'create-todo', 'text': '  买牛奶  '})
    assert snapshot['todo']['direct'][0]['title'] == '买牛奶'
    assert any(tag['text'].startswith('日期:') for tag in events.values[-1]['meta'])

    snapshot = watch.perform({'action': 'create-loop', 'name': '  收尾  '})
    created = next(loop for loop in snapshot['todo']['loops'] if loop['name'] == '收尾')
    assert created['items'] == []

    snapshot = watch.perform({'action': 'create-loop-item', 'loopID': created['id'], 'text': '关电脑'})
    created = next(loop for loop in snapshot['todo']['loops'] if loop['name'] == '收尾')
    assert [item['title'] for item in created['items']] == ['关电脑']


def test_watch_item_delete_and_loop_cascade_delete(system):
    watch, events, _, workspace = system

    watch.perform({'action': 'delete-item', 'itemID': '3'})
    assert all(event['system']['source_id'] != 3 for event in events.values)

    events.values.extend([
        events.event(4, '同闭环运行', '运行', [{'kind': '闭环', 'text': LOOP_TEXT}]),
        events.event(5, '同闭环归档', '归档', [{'kind': '闭环', 'text': LOOP_TEXT}]),
        events.event(6, '同闭环结果', '结果', [{'kind': '闭环', 'text': LOOP_TEXT}]),
    ])
    workspace.value['forest'][2]['children'].append(
        {'tag': {'kind': '闭环', 'text': LOOP_TEXT}, 'is_fold': False, 'children': []})
    watch.perform({'action': 'create-loop-item', 'loopID': LOOP_ID, 'text': '第二条'})
    snapshot = watch.perform({'action': 'delete-loop', 'loopID': LOOP_ID})
    assert all(loop['id'] != LOOP_ID for loop in snapshot['todo']['loops'])
    assert {event['user']['event'] for event in events.values if (watch._loop(event) or {}).get('id') == LOOP_ID} == {'同闭环运行', '同闭环归档', '同闭环结果'}
    assert workspace.value['forest'][2]['children'][0]['tag']['text'] == LOOP_TEXT


def test_watch_instantiates_template_as_new_loop(system):
    watch, _, _, _ = system

    snapshot = watch.perform({'action': 'use-template', 'templateID': 7})

    loop = next(loop for loop in snapshot['todo']['loops'] if loop['name'] == '晚间')
    assert [item['title'] for item in loop['items']] == ['模板小事一', '模板小事二']


@pytest.mark.parametrize('payload', [
    {'action': 'create-todo', 'text': ' '},
    {'action': 'delete-loop', 'loopID': LOOP_ID, 'extra': True},
    {'action': 'unknown'},
])
def test_watch_rejects_invalid_commands(system, payload):
    watch, _, _, _ = system
    with pytest.raises(ValueError):
        watch.perform(payload)


def test_watch_slice_pages_and_scoped_creation_deletion(system):
    watch, events, _, _ = system
    watch.slices = Slices(['临时小事', '日常训练'])
    watch.perform({'action': 'create-loop-item', 'loopID': LOOP_ID, 'text': '训练', 'slice': '日常训练'})
    snapshot = watch.perform({'action': 'create-todo', 'text': '临时', 'slice': '临时小事'})
    pages = snapshot['todoPages']
    assert [page['name'] for page in pages] == ['默认待办', '临时小事', '日常训练']
    assert pages[0]['area']['loops'][0]['items'][0]['title'] == '组内待办'
    assert pages[1]['area']['direct'][0]['title'] == '临时'
    assert pages[2]['area']['loops'][0]['items'][0]['title'] == '训练'
    watch.perform({'action': 'delete-loop', 'loopID': LOOP_ID, 'slice': '日常训练'})
    assert any(event['user']['event'] == '组内待办' for event in events.values)
    assert not any(event['user']['event'] == '训练' for event in events.values)
    with pytest.raises(ValueError, match='切片已不存在'):
        watch.perform({'action': 'create-todo', 'text': '错误', 'slice': '已删除'})
