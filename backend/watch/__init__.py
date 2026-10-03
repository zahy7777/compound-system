"""Apple Watch 的窄投影与命令协调；Swift 不理解事实、森林、模板或计时规则。"""
from copy import deepcopy
from datetime import date
import time
import uuid


class Watch:
    ITEM_ACTIONS = {'run', 'resume', 'pause', 'archive', 'delete-item'}
    ACTION_FIELDS = {
        **{action: {'action', 'itemID'} for action in ITEM_ACTIONS},
        'create-todo': {'action', 'text'},
        'create-loop': {'action', 'name'},
        'create-loop-item': {'action', 'loopID', 'text'},
        'delete-loop': {'action', 'loopID'},
        'use-template': {'action', 'templateID'},
    }

    def __init__(self, events, timer, workspace, templates, environment, slices):
        self.events = events
        self.timer = timer
        self.workspace = workspace
        self.templates = templates
        self.environment = environment.upper()
        self.slices = slices

    @staticmethod
    def _tag(event, kind):
        return next((tag['text'] for tag in event['meta'] if tag['kind'] == kind), None)

    def _loop(self, event):
        text = self._tag(event, '闭环')
        return self._parse_loop(text) if text else None

    def _parse_loop(self, text):
        pattern = next(iter(self.events.protocol.patterns['闭环'].values()))
        match = pattern.fullmatch(text)
        return dict(text=text, **match.groupdict()) if match else None

    def _loop_text(self, loop_id, name):
        rule = next(iter(self.events.protocol.kinds['闭环']['patterns'].values()))
        return rule['template'].replace('{id}', loop_id).replace('{name}', name)

    @staticmethod
    def _item(event, snapshot):
        return {'id': str(event['system']['source_id']), 'title': event['user']['event'] or '尚未填写正文',
                'elapsedMs': snapshot['elapsed_ms'] if snapshot else 0,
                'timerState': snapshot['state'] if snapshot else 'idle'}

    def _area(self, events, snapshots, name, known_loops=()):
        direct = []
        loops = [{'id': loop['id'], 'name': loop['name'] or '未命名闭环', 'items': []}
                 for loop in known_loops]
        positions = {loop['id']: index for index, loop in enumerate(loops)}
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

    def _workspace_record(self):
        record = self.workspace.read()
        if not record:
            raise ValueError('工作空间尚未初始化，请先打开网页')
        return {'item_template_id': record['item_template_id'], 'forest': deepcopy(record['forest'])}

    def _workspace_loops(self):
        record = self.workspace.read()
        if not record:
            return []
        root = next((node for node in record['forest']
                     if node['tag']['kind'] == '业务区域' and node['tag']['text'] == '待办'), None)
        if not root:
            return []
        result = []
        for node in root['children']:
            if node['tag']['kind'] != '闭环':
                continue
            loop = self._parse_loop(node['tag']['text'])
            if loop:
                result.append(loop)
        return result

    def _template_projection(self):
        result = []
        for record in self.templates.read(None):
            if not record['events']:
                continue
            result.append({'id': record['id'], 'name': record['events'][0]['meta'][0]['text'],
                           'itemCount': len(record['events'])})
        return result

    def snapshot(self):
        events = self.events.read([[]])[0]
        names = self.slices.read()
        snapshots = self.timer.read([str(event['system']['source_id']) for event in events])
        results = []
        for event, timer in zip(events, snapshots):
            if self._tag(event, '业务区域') != '结果' or not timer:
                continue
            if timer['state'] == 'running' or timer['elapsed_ms']:
                results.append(self._item(event, timer))
        return {'environment': self.environment, 'generatedAt': time.time(), 'resultTimers': results,
                'running': self._area(events, snapshots, '运行'),
                'todo': self._area(events, snapshots, '待办', self._workspace_loops()),
                'templates': self._template_projection(),
                'todoPages': [{'name': name or '默认待办', 'slice': name,
                               'area': self._area(
                                   [event for event in events if self._matches_slice(event, name)],
                                   [timer for event, timer in zip(events, snapshots) if self._matches_slice(event, name)],
                                   '待办', self._workspace_loops() if name is None else ())}
                              for name in [None, *names]]}

    def _matches_slice(self, event, name):
        value = self._tag(event, '区域切片')
        return value == name

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

    def _write_event(self, event, meta=None, deleted=False):
        return self.events.write([{'system': {'source_id': event['system']['source_id'], 'deleted': deleted},
                                   'user': {'event': event['user']['event']},
                                   'meta': event['meta'] if meta is None else meta}])

    def _new_event(self, text, loop_text=None, slice_name=None):
        meta = [{'kind': '业务区域', 'text': '待办'}]
        if slice_name is not None:
            meta.append({'kind': '区域切片', 'text': slice_name})
        if loop_text:
            meta.append({'kind': '闭环', 'text': loop_text})
        meta.append({'kind': '属性', 'text': '日期:' + date.today().isoformat()})
        return {'system': {'source_id': None, 'deleted': False}, 'user': {'event': text}, 'meta': meta}

    def _timer(self, item_id, state):
        key = str(int(item_id))
        if state == 'running':
            events = self.events.read([[]])[0]
            for snapshot in self.timer.read([str(event['system']['source_id']) for event in events]):
                if snapshot and snapshot['state'] == 'running' and snapshot['key'] != key:
                    self.timer.write(snapshot['key'], 'paused')
        return self.timer.write(key, state)

    @staticmethod
    def _text(value, label):
        if not isinstance(value, str) or not value.strip():
            raise ValueError(label + '不能为空')
        return value.strip()

    def _find_loop_text(self, loop_id):
        if not isinstance(loop_id, str):
            raise ValueError('闭环 ID 无效')
        for loop in self._workspace_loops():
            if loop['id'] == loop_id:
                return loop['text']
        for event in self.events.read([[]])[0]:
            loop = self._loop(event)
            if loop and loop['id'] == loop_id:
                return loop['text']
        raise ValueError('闭环已不存在，请刷新')

    def _write_workspace(self, record):
        self.workspace.save(record)

    def _create_loop(self, name):
        record = self._workspace_record()
        root = next((node for node in record['forest']
                     if node['tag']['kind'] == '业务区域' and node['tag']['text'] == '待办'), None)
        if not root:
            raise ValueError('待办区域不存在')
        text = self._loop_text(uuid.uuid4().hex, self._text(name, '闭环名称'))
        root['children'].append({'tag': {'kind': '闭环', 'text': text}, 'is_fold': False, 'children': []})
        self._write_workspace(record)

    def _delete_loop(self, loop_id, slice_name=None):
        loop_text = self._find_loop_text(loop_id)
        members = [event for event in self.events.read([[]])[0]
                   if self._tag(event, '业务区域') == '待办' and (self._loop(event) or {}).get('id') == loop_id
                   and self._matches_slice(event, slice_name)]
        if members:
            self.events.write([{'system': {'source_id': event['system']['source_id'], 'deleted': True},
                                'user': {'event': event['user']['event']}, 'meta': event['meta']}
                               for event in members])
        stored = self.workspace.read()
        if slice_name is not None or any((self._loop(event) or {}).get('id') == loop_id
                                        and self._tag(event, '业务区域') == '待办'
                                        for event in self.events.read([[]])[0]):
            return
        if not stored:
            return
        record = {'item_template_id': stored['item_template_id'], 'forest': deepcopy(stored['forest'])}
        todo = next((node for node in record['forest']
                     if node['tag']['kind'] == '业务区域' and node['tag']['text'] == '待办'), None)
        if todo:
            remaining = [node for node in todo['children'] if node['tag'] != {'kind': '闭环', 'text': loop_text}]
            if len(remaining) != len(todo['children']):
                todo['children'] = remaining
                self._write_workspace(record)

    def _use_template(self, template_id, slice_name=None):
        if type(template_id) is not int or template_id < 1:
            raise ValueError('模板 ID 无效')
        records = self.templates.read([template_id])
        if not records:
            raise ValueError('模板已不存在，请刷新')
        record = records[0]
        name = record['events'][0]['meta'][0]['text']
        loop_text = self._loop_text(uuid.uuid4().hex, name)
        self.events.write([self._new_event(draft['user']['event'], loop_text, slice_name) for draft in record['events']])

    def _perform_item(self, action, item_id):
        event = self._current(item_id)
        if action == 'run':
            self._timer(item_id, 'running')
            self._write_event(event, self._replace_area(event, '运行'))
        elif action in {'resume', 'pause'}:
            self._timer(item_id, 'running' if action == 'resume' else 'paused')
        elif action == 'delete-item':
            self._write_event(event, deleted=True)
        else:
            prepared = self._timer(item_id, 'paused')
            meta = self._add_elapsed(event, prepared['elapsed_ms'])
            meta = [tag for tag in meta if tag['kind'] != '业务区域'] + [{'kind': '业务区域', 'text': '归档'}]
            self._write_event(event, meta)
            self._timer(item_id, 'reset')

    def perform(self, value):
        if not isinstance(value, dict):
            raise ValueError('手表操作格式错误')
        action = value.get('action')
        fields = set(value) - {'slice'}
        if action not in self.ACTION_FIELDS or fields != self.ACTION_FIELDS[action]:
            raise ValueError('手表操作格式错误')
        slice_name = value.get('slice')
        if 'slice' in value and (action not in {'create-todo', 'create-loop-item', 'use-template', 'delete-loop'}
                                or slice_name not in self.slices.read()):
            raise ValueError('切片已不存在，请刷新')
        if action in self.ITEM_ACTIONS:
            self._perform_item(action, value['itemID'])
        elif action == 'create-todo':
            self.events.write([self._new_event(self._text(value['text'], '待办正文'), slice_name=slice_name)])
        elif action == 'create-loop':
            self._create_loop(value['name'])
        elif action == 'create-loop-item':
            self.events.write([self._new_event(self._text(value['text'], '待办正文'),
                                               self._find_loop_text(value['loopID']), slice_name)])
        elif action == 'delete-loop':
            self._delete_loop(value['loopID'], slice_name)
        else:
            self._use_template(value['templateID'], slice_name)
        return self.snapshot()
