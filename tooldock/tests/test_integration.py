"""临时 dev Git/SQLite/快捷键，真实 Windows PowerShell 两服务验收。"""
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


def run_build(environment):
    script = ROOT / 'tooldock' / 'scripts' / 'runtime' / 'build.ps1'
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                             '-File', str(script)], cwd=ROOT, env=environment,
                            encoding='utf-8', capture_output=True, timeout=180)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'Compound 前端构建完成' in result.stdout
    assert (ROOT / 'frontend' / 'app.js').is_file()
    assert (ROOT / 'frontend' / 'style.css').is_file()


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


def test_two_services(tmp_path):
    repository = initialize(tmp_path / 'backup')
    sockets = [socket.socket() for _ in range(2)]
    for stream in sockets:
        stream.bind(('127.0.0.1', 0))
    ports = dict(zip(('backend', 'desktop'), (stream.getsockname()[1] for stream in sockets)))
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
        run_build(environment)
        for service in ('backend', 'desktop'):
            assert state(service, environment)['state'] == 'stopped'
            started.append(service)
            run_script(service, 'start', environment)
            assert wait(service, 'running', environment)['state'] == 'running'
            assert '已运行' in run_script(service, 'start', environment)
        with urlopen(f"http://127.0.0.1:{ports['backend']}/?presentation=todo", timeout=5) as response:
            assert '<title>Compound' in response.read().decode('utf-8')
        with urlopen(f"http://127.0.0.1:{ports['desktop']}/_tooldock/health", timeout=5) as response:
            assert json.load(response) == {'app': 'compound-desktop', 'environment': 'dev', 'ready': True}
        # 桌面独立退出后，浏览器仍可读取同一 Compound 服务。
        run_script('desktop', 'stop', environment)
        wait('desktop', 'stopped', environment)
        assert state('backend', environment)['state'] == 'running'
        assert state('backend', environment)['url'] == f"http://127.0.0.1:{ports['backend']}/"
        run_script('desktop', 'start', environment)
        wait('desktop', 'running', environment)
    finally:
        for service in reversed(started):
            run_script(service, 'stop', environment)
            wait(service, 'stopped', environment)
            run_script(service, 'stop', environment)
    # 人工以项目 Python 启动的同一入口也能接管；启动不增加第二份进程。
    with (tmp_path / 'manual.log').open('w', encoding='utf-8') as output:
        manual = subprocess.Popen([str(ROOT / '.venv/Scripts/python.exe'), '-m', 'backend',
                                   '--env', 'dev', '--port', str(ports['backend']),
                                   '--db', str(tmp_path / 'events.sqlite'), '--repo', str(repository)],
                                  cwd=ROOT, env=environment, stdout=output, stderr=output)
        try:
            wait('backend', 'running', environment)
            assert '已运行' in run_script('backend', 'start', environment)
            run_script('backend', 'stop', environment)
            wait('backend', 'stopped', environment)
        finally:
            if manual.poll() is None:
                run_script('backend', 'stop', environment)
            manual.wait(timeout=10)
    # 外来占用只报告失败，不结束占用者。
    blocker = socket.socket()
    blocker.bind(('127.0.0.1', ports['backend']))
    blocker.listen()
    try:
        assert state('backend', environment)['state'] == 'failed'
        run_script('backend', 'start', environment, expected=1)
        run_script('backend', 'stop', environment, expected=1)
        assert blocker.getsockname()[1] == ports['backend']
    finally:
        blocker.close()
