"""临时 dev Git/SQLite/快捷键，真实 Windows PowerShell 三服务验收。"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
from conftest import initialize


def run_script(service, action, environment, expected=0):
    script = ROOT / 'tooldock' / 'scripts' / service / f'dev-{action}.ps1'
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                             '-File', str(script)], cwd=ROOT, env=environment,
                            encoding='utf-8', capture_output=True, timeout=20)
    assert result.returncode == expected, result.stdout + result.stderr
    return result.stdout.strip()


def state(service, environment):
    return json.loads(run_script(service, 'status', environment).splitlines()[-1])


def wait(service, target, environment):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        snapshot = state(service, environment)
        if snapshot['state'] == target:
            return snapshot
        assert snapshot['state'] != 'failed', snapshot
        time.sleep(.2)
    raise AssertionError(f'{service} 未进入 {target}: {snapshot}')


def test_three_services(tmp_path):
    repository = initialize(tmp_path / 'backup')
    sockets = [socket.socket() for _ in range(3)]
    for stream in sockets:
        stream.bind(('127.0.0.1', 0))
    ports = dict(zip(('backend', 'web', 'desktop'), (stream.getsockname()[1] for stream in sockets)))
    for stream in sockets:
        stream.close()
    desktop_data = tmp_path / 'desktop'
    desktop_data.mkdir()
    (desktop_data / 'shortcuts.json').write_text(json.dumps({'running': 'Control+Shift+Alt+F7', 'todo': 'Control+Shift+Alt+F8'}), encoding='utf-8')
    config = tmp_path / 'configuration.json'
    config.write_text(json.dumps({'ports': ports, 'database': str(tmp_path / 'events.sqlite'),
                                 'repository': str(repository), 'desktopData': str(desktop_data)}), encoding='utf-8')
    environment = {**os.environ, 'COMPOUND_TOOLDOCK_CONFIG': str(config), 'PYTHONIOENCODING': 'utf-8'}
    started = []
    try:
        for service in ('backend', 'web', 'desktop'):
            assert state(service, environment)['state'] == 'stopped'
            started.append(service)
            run_script(service, 'start', environment)
            assert wait(service, 'running', environment)['state'] == 'running'
            assert '已运行' in run_script(service, 'start', environment)
        with urlopen(f"http://127.0.0.1:{ports['web']}/?presentation=todo", timeout=5) as response:
            assert '<title>Compound' in response.read().decode('utf-8')
        with urlopen(f"http://127.0.0.1:{ports['desktop']}/_tooldock/health", timeout=5) as response:
            assert json.load(response) == {'app': 'compound-desktop', 'environment': 'dev', 'ready': True}
        # 停网页不结束后端，随后可单独恢复网页。
        run_script('web', 'stop', environment)
        wait('web', 'stopped', environment)
        assert state('backend', environment)['state'] == 'running'
        run_script('web', 'start', environment)
        wait('web', 'running', environment)
    finally:
        for service in reversed(started):
            run_script(service, 'stop', environment)
            wait(service, 'stopped', environment)
            run_script(service, 'stop', environment)
    # 外来占用只报告失败，不结束占用者。
    blocker = socket.socket()
    blocker.bind(('127.0.0.1', ports['web']))
    blocker.listen()
    try:
        assert state('web', environment)['state'] == 'failed'
        run_script('web', 'start', environment, expected=1)
        run_script('web', 'stop', environment, expected=1)
        assert blocker.getsockname()[1] == ports['web']
    finally:
        blocker.close()
