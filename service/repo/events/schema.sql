CREATE TABLE event_versions (
    version_id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES event_versions(version_id),
    deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
    content TEXT NOT NULL
);
CREATE TABLE event_tags (
    version_id INTEGER NOT NULL REFERENCES event_versions(version_id),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (version_id, kind, text)
);
CREATE INDEX event_history ON event_versions(source_id, version_id DESC);
CREATE INDEX tag_lookup ON event_tags(kind, text, version_id);
CREATE TABLE backup_progress (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    version_id INTEGER NOT NULL
);
INSERT INTO backup_progress VALUES (1, 0);
