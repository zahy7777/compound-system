"""唯一当前森林的追加存取。"""
import json


class WorkspaceRepo:
    def __init__(self, db):
        self.db = db
        with db.connection() as conn:
            conn.execute('CREATE TABLE IF NOT EXISTS workspace_versions (version_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')

    def write(self, value, conn):
        version_id = conn.execute('SELECT COALESCE(MAX(version_id),0)+1 FROM workspace_versions').fetchone()[0]
        conn.execute('INSERT INTO workspace_versions VALUES (?,?)', (version_id,json.dumps(value,ensure_ascii=False)))
        return dict(version_id=version_id)

    def read(self, conn=None):
        if conn is None:
            with self.db.connection() as connection: return self.read(connection)
        row = conn.execute('SELECT * FROM workspace_versions ORDER BY version_id DESC LIMIT 1').fetchone()
        return dict(version_id=row['version_id'], **json.loads(row['payload'])) if row else None
