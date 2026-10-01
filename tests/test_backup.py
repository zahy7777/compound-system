import json
import subprocess

import pytest

from conftest import fact
from service.backup import Backup, read_log
from service.repo.facts import FactRepo


def test_backup_restart_restore_and_continue(system, tmp_path):
    kernel, repo, backup = system
    kernel.write([fact('初版'), fact('另一件')])
    kernel.write([fact('新版', '归档', source_id=1)])
    kernel.write([fact('另一件', source_id=2, deleted=True)])
    assert backup.flush() == 4
    restarted = Backup(repo, backup.directory, kernel.protocol, 'dev')
    assert restarted.flush() == 0
    facts = read_log(backup.path, kernel.protocol)
    assert [value['system']['version_id'] for value in facts] == [1, 2, 3, 4]
    restored = FactRepo(tmp_path / 'restored.sqlite')
    restored.restore(facts)
    assert restored.read([[]]) == kernel.read([[]])
    assert restored.write([fact('恢复后')])[0] == dict(version_id=5, source_id=5)
    assert subprocess.run(['git', '-C', str(backup.directory), 'status', '--porcelain'],
                          capture_output=True, encoding='utf-8').stdout == ''


def test_retry_after_file_saved_but_progress_failed(system, monkeypatch):
    kernel, repo, backup = system
    backup.flush()
    kernel.write([fact('只追加一次')])
    original = repo.mark_backed_up

    def fail(_):
        raise OSError('模拟进度失败')
    monkeypatch.setattr(repo, 'mark_backed_up', fail)
    with pytest.raises(OSError):
        backup.flush()
    assert len(backup.path.read_text(encoding='utf-8').splitlines()) == 1
    monkeypatch.setattr(repo, 'mark_backed_up', original)
    assert backup.flush() == 0
    assert len(read_log(backup.path, kernel.protocol)) == 1


def test_git_failure_does_not_block_kernel_and_can_retry(system, monkeypatch):
    import service.backup as module
    kernel, _, backup = system
    original = module.git

    def fail(directory, *args):
        if args[0] == 'commit':
            raise RuntimeError('模拟 Git 提交失败')
        return original(directory, *args)
    monkeypatch.setattr(module, 'git', fail)
    kernel.write([fact('第一件')])
    with pytest.raises(RuntimeError):
        backup.flush()
    kernel.write([fact('第二件')])
    assert len(kernel.read([[]])[0]) == 2
    monkeypatch.setattr(module, 'git', original)
    backup.flush()
    assert len(read_log(backup.path, kernel.protocol)) == 2


def test_partial_line_is_reported_without_rewriting(system):
    kernel, _, backup = system
    original = b'{"system":'
    backup.path.write_bytes(original)
    with pytest.raises(ValueError, match='完整行'):
        backup.flush()
    assert backup.path.read_bytes() == original
