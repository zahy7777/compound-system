"""共同数据库能力；连接与事务不携带业务含义。"""
from contextlib import contextmanager
from pathlib import Path
import json
import sqlite3


class Database:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute('PRAGMA journal_mode=WAL')

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


class VersionStore:
    """森林和数组共用完整 JSON 版本存取，不解释内容。"""
    def __init__(self, db, table, fields):
        self.db, self.table, self.fields = db, table, fields
        with db.connection() as conn:
            conn.execute(f'CREATE TABLE IF NOT EXISTS {table} (version_id INTEGER PRIMARY KEY, id INTEGER NOT NULL, deleted INTEGER NOT NULL CHECK (deleted IN (0,1)), payload TEXT NOT NULL)')
            conn.execute(f'CREATE INDEX IF NOT EXISTS {table}_latest ON {table}(id,version_id)')

    def write(self, values, conn):
        result = []
        for value in values:
            next_id = conn.execute(f'SELECT COALESCE(MAX(version_id),0)+1 FROM {self.table}').fetchone()[0]
            identity = value['id'] if value['id'] is not None else next_id
            if value['id'] is not None and not conn.execute(f'SELECT 1 FROM {self.table} WHERE id=?', (identity,)).fetchone():
                raise ValueError('模板 ID 不存在')
            record = {key: value[key] for key in self.fields}
            conn.execute(f'INSERT INTO {self.table} VALUES (?,?,?,?)',
                         (next_id, identity, int(value['deleted']), json.dumps(record, ensure_ascii=False)))
            result.append(dict(id=identity, version_id=next_id))
        return result

    def read(self, ids=None, conn=None):
        if conn is None:
            with self.db.connection() as connection:
                return self.read(ids, connection)
        rows = conn.execute(f'SELECT * FROM {self.table} WHERE version_id IN (SELECT MAX(version_id) FROM {self.table} GROUP BY id) AND deleted=0 ORDER BY id').fetchall()
        return [dict(version_id=row['version_id'], id=row['id'], deleted=bool(row['deleted']), **json.loads(row['payload'])) for row in rows if ids is None or row['id'] in ids]
