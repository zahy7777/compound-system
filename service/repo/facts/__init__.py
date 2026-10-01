"""SQLite 是操作权威，备份只读取已经提交的版本。"""
from contextlib import contextmanager
from pathlib import Path
import sqlite3


class FactRepo:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='fact_versions'").fetchone():
                conn.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA synchronous=FULL')
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def transaction(self):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            try:
                yield conn
                conn.commit()
            except BaseException:
                conn.rollback()
                raise

    def _insert(self, conn, fact):
        system = fact['system']
        version_id, source_id = system['version_id'], system['source_id']
        if source_id != version_id and not conn.execute(
            'SELECT 1 FROM fact_versions WHERE version_id=? AND source_id=?',
            (source_id, source_id),
        ).fetchone():
            raise ValueError('源 ID 不存在')
        if source_id > version_id:
            raise ValueError('源 ID 不能晚于版本 ID')
        conn.execute('INSERT INTO fact_versions VALUES (?,?,?,?)',
                     (version_id, source_id, int(system['deleted']), fact['user']['event']))
        conn.executemany('INSERT INTO fact_tags VALUES (?,?,?)',
                         [(version_id, tag['kind'], tag['text']) for tag in fact['meta']])

    def write(self, values):
        result = []
        with self.transaction() as conn:
            next_id = conn.execute('SELECT COALESCE(MAX(version_id),0)+1 FROM fact_versions').fetchone()[0]
            for value in values:
                if next_id > 9007199254740991:
                    raise ValueError('版本 ID 超出协议整数范围')
                source_id = value['system']['source_id']
                if source_id is not None and not conn.execute(
                    'SELECT 1 FROM fact_versions WHERE version_id=? AND source_id=?',
                    (source_id, source_id),
                ).fetchone():
                    raise ValueError('源 ID 不存在')
                system = dict(version_id=next_id, source_id=next_id if source_id is None else source_id,
                              deleted=value['system']['deleted'])
                self._insert(conn, dict(system=system, user=value['user'], meta=value['meta']))
                result.append(dict(version_id=next_id, source_id=system['source_id']))
                next_id += 1
        return result

    def _record(self, conn, row):
        return dict(system=dict(version_id=row['version_id'], source_id=row['source_id'],
                                deleted=bool(row['deleted'])),
                    user=dict(event=row['content']),
                    meta=[dict(kind=tag['kind'], text=tag['text']) for tag in conn.execute(
                        'SELECT kind,text FROM fact_tags WHERE version_id=? ORDER BY kind,text',
                        (row['version_id'],))])

    def read(self, queries):
        result = []
        with self.connection() as conn:
            for tags in queries:
                sql = ('WITH latest AS (SELECT MAX(version_id) AS version_id FROM fact_versions GROUP BY source_id) '
                       'SELECT f.* FROM fact_versions f JOIN latest USING(version_id) WHERE f.deleted=0')
                params = []
                for tag in tags:
                    sql += (' AND EXISTS (SELECT 1 FROM fact_tags t WHERE t.version_id=f.version_id '
                            'AND t.kind=? AND t.text=?)')
                    params.extend((tag['kind'], tag['text']))
                rows = conn.execute(sql + ' ORDER BY f.version_id DESC', params).fetchall()
                result.append([self._record(conn, row) for row in rows])
        return result

    def versions_after(self, version_id, limit=256):
        with self.connection() as conn:
            rows = conn.execute('SELECT * FROM fact_versions WHERE version_id>? ORDER BY version_id LIMIT ?',
                                (version_id, limit)).fetchall()
            return [self._record(conn, row) for row in rows]

    def version(self, version_id):
        with self.connection() as conn:
            row = conn.execute('SELECT * FROM fact_versions WHERE version_id=?', (version_id,)).fetchone()
            return self._record(conn, row) if row else None

    def mark_backed_up(self, version_id):
        with self.transaction() as conn:
            conn.execute('UPDATE backup_progress SET version_id=? WHERE singleton=1', (version_id,))

    def restore(self, facts):
        with self.transaction() as conn:
            if conn.execute('SELECT 1 FROM fact_versions LIMIT 1').fetchone():
                raise ValueError('恢复目标必须是空数据库')
            for fact in facts:
                self._insert(conn, fact)
            conn.execute('UPDATE backup_progress SET version_id=? WHERE singleton=1',
                         (facts[-1]['system']['version_id'] if facts else 0,))
