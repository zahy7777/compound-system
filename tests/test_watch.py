import re

from backend.watch import Watch


class Protocol:
    patterns = {
        '闭环': {'loop': re.compile(r'闭环#(?P<id>[a-f0-9]{32})\|(?P<name>.+)')},
        '属性': {'耗时': re.compile(r'耗时:(?P<value>[0-9]+(?:\.[0-9]+)?)s')},
    }


class Events:
    protocol = Protocol()

    def __init__(self):
        self.values = [
            self.event(1, '正在积累', '结果'),
            self.event(2, '运行小事', '运行'),
            self.event(3, '组内待办', '待办', [{'kind':'闭环', 'text':'闭环#' + 'a' * 32 + '|晨间'}]),
        ]

    @staticmethod
    def event(source_id, text, area, extra=()):
        return {'system': {'version_id': source_id, 'source_id': source_id, 'deleted': False},
                'user': {'event': text}, 'meta': [{'kind':'业务区域', 'text':area}, *extra]}

    def read(self, queries):
        return [self.values]

    def write(self, values):
        for value in values:
            index = next(i for i, event in enumerate(self.values) if event['system']['source_id'] == value['system']['source_id'])
            self.values[index] = {**value, 'system': {**value['system'], 'version_id': len(self.values) + index + 1}}
        return [{'source_id': value['system']['source_id']} for value in values]


class Timer:
    def __init__(self):
        self.values = {'1': {'key':'1', 'state':'running', 'elapsed_ms':1200},
                       '2': {'key':'2', 'state':'paused', 'elapsed_ms':4000}}

    def read(self, keys):
        return [self.values.get(key) for key in keys]

    def write(self, key, state):
        current = self.values.get(key, {'key':key, 'state':'paused', 'elapsed_ms':0})
        if state == 'reset': current = {'key':key, 'state':'paused', 'elapsed_ms':0}
        else: current = {**current, 'state':state}
        self.values[key] = current
        return current


def test_watch_snapshot_and_actions_keep_rules_on_server():
    events, timer = Events(), Timer()
    watch = Watch(events, timer, 'dev')
    snapshot = watch.snapshot()
    assert snapshot['environment'] == 'DEV'
    assert snapshot['resultTimers'][0]['title'] == '正在积累'
    assert snapshot['running']['direct'][0]['timerState'] == 'paused'
    assert snapshot['todo']['loops'][0]['name'] == '晨间'

    watch.perform('run', '3')
    assert timer.values['1']['state'] == 'paused'
    assert timer.values['3']['state'] == 'running'
    assert next(tag['text'] for tag in events.values[2]['meta'] if tag['kind'] == '业务区域') == '运行'

    watch.perform('archive', '3')
    current = events.values[2]
    assert next(tag['text'] for tag in current['meta'] if tag['kind'] == '业务区域') == '归档'
    assert timer.values['3']['elapsed_ms'] == 0
    assert any(tag['text'] == '耗时:0s' for tag in current['meta'])
