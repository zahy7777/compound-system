"""计时器当前记录；key 没有业务身份或外键。"""


class TimerRepo:
    def __init__(self, db):
        self.db = db
        with db.connection() as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS timers (key TEXT PRIMARY KEY, elapsed_ms INTEGER NOT NULL, running_since_ms INTEGER)')

    def transaction(self):
        return self.db.transaction()

    def write(self, value, transaction):
        transaction.execute('INSERT INTO timers VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET elapsed_ms=excluded.elapsed_ms,running_since_ms=excluded.running_since_ms',
                            (value['key'],value['elapsed_ms'],value['running_since_ms']))

    def read(self, keys, transaction=None):
        if transaction is None:
            with self.db.connection() as conn: return self.read(keys,conn)
        result = []
        for key in keys:
            row = transaction.execute('SELECT * FROM timers WHERE key=?',(key,)).fetchone()
            result.append(dict(row) if row else None)
        return result
