"""一份切片名称数组，固定单行键不是切片身份。"""
import json


class SliceRepo:
    def __init__(self, db):
        self.db = db
        with db.connection() as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS slices (singleton INTEGER PRIMARY KEY CHECK (singleton=1), payload TEXT NOT NULL)')

    def write(self, names, transaction):
        transaction.execute('INSERT INTO slices VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload',
                            (json.dumps(names, ensure_ascii=False),))

    def read(self):
        with self.db.connection() as conn:
            row = conn.execute('SELECT payload FROM slices WHERE singleton=1').fetchone()
            return json.loads(row['payload']) if row else []
