"""计时器只认识 key 和时钟，不认识 event 或业务流程。"""
from pathlib import Path
import time
import yaml
from jsonschema import Draft202012Validator, ValidationError


class Timer:
    def __init__(self, repo, clock=None):
        self.repo = repo
        self.clock = clock or (lambda: time.time_ns() // 1_000_000)
        schema = yaml.safe_load(Path(__file__).with_name('protocol.yaml').read_text(encoding='utf-8'))
        self.validators = {name: Draft202012Validator(dict(schema[name], **{'$defs': schema['$defs']})) for name in ('write','read')}

    def _check(self, name, value):
        try: self.validators[name].validate(value)
        except ValidationError as error: raise ValueError('计时器输入错误：' + error.message) from error

    def _result(self, record, now):
        if record is None: return None
        started = record['running_since_ms']
        return dict(key=record['key'],state='paused' if started is None else 'running',
                    elapsed_ms=record['elapsed_ms'] + (max(0,now-started) if started is not None else 0))

    def write(self, key, state):
        self._check('write',dict(key=key,state=state))
        now = self.clock()
        with self.repo.transaction() as transaction:
            record = self.repo.read([key],transaction)[0] or dict(key=key,elapsed_ms=0,running_since_ms=None)
            if state == 'reset':
                record.update(elapsed_ms=0,running_since_ms=None)
            elif state == 'running' and record['running_since_ms'] is None:
                record['running_since_ms'] = now
            elif state == 'paused':
                record['elapsed_ms'] = self._result(record,now)['elapsed_ms']
                record['running_since_ms'] = None
            self.repo.write(record,transaction)
        return self._result(record,now)

    def read(self, keys):
        self._check('read',keys)
        now = self.clock()
        return [self._result(record,now) for record in self.repo.read(keys)]
