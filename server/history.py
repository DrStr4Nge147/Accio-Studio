"""Server-side job history (SQLite). Shared across devices; every seed and parameter is kept so a job can be reused."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    created_at  REAL NOT NULL,
    finished_at REAL,
    mode        TEXT NOT NULL,
    label       TEXT NOT NULL,
    template    TEXT NOT NULL,
    status      TEXT NOT NULL,
    params      TEXT NOT NULL,
    seeds       TEXT NOT NULL,
    prompt_id   TEXT,
    outputs     TEXT NOT NULL DEFAULT '[]',
    prompt_used TEXT,
    error       TEXT,
    warnings    TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS jobs_created ON jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_prompt ON jobs (prompt_id);
"""
JSON_COLS = ("params", "seeds", "outputs", "warnings")
ACTIVE = ("queued", "running")


class History:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()

    @staticmethod
    def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
        if r is None:
            return None
        d = dict(r)
        for c in JSON_COLS:
            d[c] = json.loads(d[c])
        return d

    def create(self, job: dict[str, Any]) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs (id, created_at, mode, label, template, status, params, seeds, prompt_id, warnings)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    job["id"], job["created_at"], job["mode"], job["label"], job["template"], job["status"],
                    json.dumps(job["params"]), json.dumps(job["seeds"]), job.get("prompt_id"), json.dumps(job.get("warnings", [])),
                ),
            )
            self._db.commit()

    def update(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        for c in JSON_COLS:
            if c in fields:
                fields[c] = json.dumps(fields[c])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))  # keys are code-controlled
            self._db.commit()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._row(self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())

    def by_prompt_id(self, prompt_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._row(self._db.execute("SELECT * FROM jobs WHERE prompt_id = ?", (prompt_id,)).fetchone())

    def list(self, limit: int = 30, before: float | None = None) -> list[dict[str, Any]]:
        q, args = "SELECT * FROM jobs", []
        if before is not None:
            q += " WHERE created_at < ?"
            args.append(before)
        q += " ORDER BY created_at DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            return [self._row(r) for r in self._db.execute(q, args).fetchall()]

    def active(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT * FROM jobs WHERE status IN ({','.join('?' * len(ACTIVE))}) ORDER BY created_at", ACTIVE
            ).fetchall()
        return [self._row(r) for r in rows]

    def finish(self, job_id: str, status: str, **fields: Any) -> None:
        self.update(job_id, status=status, finished_at=time.time(), **fields)
