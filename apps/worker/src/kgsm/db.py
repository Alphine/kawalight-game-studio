"""SQLite metadata store (SDD §5.1). Single-user local projects, no server."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import paths

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    genre TEXT NOT NULL,
    state TEXT NOT NULL,
    state_reason TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spend_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_id TEXT NULL,
    amount_cents INTEGER NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(db_file: Path | None = None) -> sqlite3.Connection:
    target = db_file or paths.db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    # ThreadingHTTPServer serves concurrent writers: a generous busy
    # timeout plus WAL mode keeps lock contention from surfacing as
    # "database is locked" 500s.
    conn = sqlite3.connect(target, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
    except sqlite3.DatabaseError:
        pass  # e.g. read-only/odd filesystems; default rollback journal
    try:
        conn.execute("PRAGMA busy_timeout=30000;")
    except sqlite3.DatabaseError:
        pass
    conn.executescript(_SCHEMA)
    return conn
