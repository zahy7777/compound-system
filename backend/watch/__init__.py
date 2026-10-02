"""Apple Watch 的窄读模型与四个动作；Swift 不理解事实、标签或计时协调。"""
import time


class Watch:
    ACTIONS = {'run', 'resume', 'pause', 'archive'}

    def __init__(self, events, timer, environment):
        self.events = events
        self.timer = timer
        self.environment = environment.upper()

    @staticmethod
    def _tag(event, kind):
        return next((tag['text'] for tag in event['meta'] if tag['kind'] == kind), None)

    def _loop(self, event):
        text = self._tag(event, '闭环')
        if not text:
            return None
        pattern = next(iter(self.events.protocol.patterns['闭环'].values()))
        match = pattern.fullmatch(text)
        return match.groupdict() if match else None

    @staticmethod
    def _item(event, snapshot):
        return {'id': str(event['system']['source_id']), 'title': event['user']['event'] or '尚未填写正文',
                'elapsedMs': snapshot['elapsed_ms'] if snapshot else 0,
                'timerState': snapshot['state'] if snapshot else 'idle'}

    def _area(self, events, snapshots, name):
        direct, loops, positions = [], [], {}
        for event, snapshot in zip(events, snapshots):
            if self._tag(event, '业务区域') != name:
                continue
            item, loop = self._item(event, snapshot), self._loop(event)
            if not loop:
                direct.append(item)
                continue
            loop_id = loop['id']
            if loop_id not in positions:
                positions[loop_id] = len(loops)
                loops.append({'id': loop_id, 'name': loop['name'] or '未命名闭环', 'items': []})
            loops[positions[loop_id]]['items'].append(item)
        return {'direct': direct, 'loops': loops}

    def snapshot(self):
        events = self.events.read([[]])[0]
        snapshots = self.timer.read([str(event['system']['source_id']) for event in events])
        results = []
        for event, timer in zip(events, snapshots):
            if self._tag(event, '业务区域') != '结果' or not timer:
                continue
            if timer['state'] == 'running' or timer['elapsed_ms']:
                results.append(self._item(event, timer))
        return {'environment': self.environment, 'generatedAt': time.time(), 'resultTimers': results,
                'running': self._area(events, snapshots, '运行'), 'todo': self._area(events, snapshots, '待办')}

    def _current(self, item_id):
        try:
            source_id = int(item_id)
        except (TypeError, ValueError) as error:
            raise ValueError('小事 ID 无效') from error
        event = next((value for value in self.events.read([[]])[0] if value['system']['source_id'] == source_id), None)
        if not event:
            raise ValueError('小事已不存在，请刷新')
        return event

    @staticmethod
    def _replace_area(event, area):
        return [tag for tag in event['meta'] if tag['kind'] != '业务区域'] + [{'kind': '业务区域', 'text': area}]

    def _add_elapsed(self, event, elapsed_ms):
        rule = self.events.protocol.patterns['属性']['耗时']
        old = next((rule.fullmatch(tag['text']) for tag in event['meta'] if tag['kind'] == '属性' and rule.fullmatch(tag['text'])), None)
        seconds = float(old['value']) if old else 0
        value = f"{round(seconds + elapsed_ms / 1000, 6):g}s"
        return [tag for tag in event['meta'] if not (tag['kind'] == '属性' and rule.fullmatch(tag['text']))] + [{'kind': '属性', 'text': '耗时:' + value}]

    def _write_event(self, event, meta):
        return self.events.write([{'system': {'source_id': event['system']['source_id'], 'deleted': False},
                                   'user': {'event': event['user']['event']}, 'meta': meta}])

    def _timer(self, item_id, state):
        key = str(int(item_id))
        if state == 'running':
            events = self.events.read([[]])[0]
            for snapshot in self.timer.read([str(event['system']['source_id']) for event in events]):
                if snapshot and snapshot['state'] == 'running' and snapshot['key'] != key:
                    self.timer.write(snapshot['key'], 'paused')
        return self.timer.write(key, state)

    def perform(self, action, item_id):
        if action not in self.ACTIONS:
            raise ValueError('不支持的手表操作')
        event = self._current(item_id)
        if action == 'run':
            self._timer(item_id, 'running')
            self._write_event(event, self._replace_area(event, '运行'))
        elif action in {'resume', 'pause'}:
            self._timer(item_id, 'running' if action == 'resume' else 'paused')
        else:
            prepared = self._timer(item_id, 'paused')
            meta = self._add_elapsed(event, prepared['elapsed_ms'])
            meta = [tag for tag in meta if tag['kind'] != '业务区域'] + [{'kind': '业务区域', 'text': '归档'}]
            self._write_event(event, meta)
            self._timer(item_id, 'reset')
        return self.snapshot()
