"""只追加完整版本；独立消费已提交事实，不感知业务区域。"""
import json
import logging
import os
from pathlib import Path
import subprocess
import threading


def git(directory, *args):
    result = subprocess.run(['git', '-C', str(directory), *args], capture_output=True,
                            text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(f'Git {args[0]} 失败：{result.stderr.strip()}')
    return result.stdout


def read_log(path, protocol):
    text = path.read_bytes().decode('utf-8')
    if text.startswith('\ufeff') or '\r' in text or (text and not text.endswith('\n')):
        raise ValueError('备份必须为 UTF-8 无 BOM、LF 和完整行')
    events, previous = [], 0
    for line in text.splitlines():
        event = json.loads(line)
        protocol.check(event, stored=True)
        if event['system']['version_id'] <= previous:
            raise ValueError('备份版本必须严格递增')
        previous = event['system']['version_id']
        event['meta'].sort(key=lambda tag: (tag['kind'], tag['text']))
        events.append(event)
    return events


class Backup:
    def __init__(self, repo, directory, protocol, branch):
        self.repo, self.directory, self.protocol = repo, Path(directory), protocol
        self.path = self.directory / 'logs.jsonl'
        if git(self.directory, 'branch', '--show-current').strip() != branch:
            raise ValueError('备份检出分支与环境不一致')
        self.cursor = None
        self.needs_git = True
        self.wake = threading.Event()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name='compound-backup', daemon=True)

    def flush(self):
        if self.cursor is None:
            events = read_log(self.path, self.protocol)
            for event in events:
                if self.repo.version(event['system']['version_id']) != event:
                    raise ValueError('备份与数据库历史不一致，请使用空数据库恢复')
            self.cursor = events[-1]['system']['version_id'] if events else 0
            self.repo.mark_backed_up(self.cursor)
        events = self.repo.versions_after(self.cursor)
        if events:
            self.needs_git = True
            # 写入或进度更新失败后重新核对文件，避免重写已落盘版本。
            try:
                with self.path.open('ab') as stream:
                    for event in events:
                        stream.write((json.dumps(event, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8'))
                    stream.flush()
                    os.fsync(stream.fileno())
                self.repo.mark_backed_up(events[-1]['system']['version_id'])
                self.cursor = events[-1]['system']['version_id']
            except Exception:
                self.cursor = None
                raise
        if not self.needs_git:
            return 0
        git(self.directory, 'diff', '--', 'logs.jsonl')
        git(self.directory, 'diff', '--cached', '--', 'logs.jsonl')
        git(self.directory, 'status', '--short')
        git(self.directory, 'add', '--', 'logs.jsonl')
        if git(self.directory, 'diff', '--cached', '--name-only', '--', 'logs.jsonl').strip():
            git(self.directory, 'commit', '-m', 'backup: 追加完整小事版本', '-m',
                '按版本顺序保全已提交正文、完整标签和软删除状态。', '--', 'logs.jsonl')
        if 'origin' in git(self.directory, 'remote').splitlines():
            branch = git(self.directory, 'branch', '--show-current').strip()
            git(self.directory, 'push', 'origin', branch)
        self.needs_git = False
        return len(events)

    def _run(self):
        while not self.stop_event.is_set():
            self.wake.wait(1)
            self.wake.clear()
            try:
                if self.flush() == 256:
                    self.wake.set()
            except Exception:
                logging.exception('备份失败，下次继续重试')

    def start(self):
        self.thread.start()
        self.wake.set()

    def close(self):
        self.stop_event.set()
        self.wake.set()
        self.thread.join(timeout=5)
