CREATE TABLE fact_versions (
    version_id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES fact_versions(version_id),
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    content TEXT NOT NULL
);
CREATE TABLE fact_tags (
    version_id INTEGER NOT NULL REFERENCES fact_versions(version_id),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (version_id, kind, text)
);
CREATE INDEX fact_history ON fact_versions(source_id, version_id DESC);
CREATE INDEX tag_lookup ON fact_tags(kind, text, version_id);
CREATE TABLE backup_progress (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    version_id INTEGER NOT NULL
);
INSERT INTO backup_progress VALUES (1, 0);
