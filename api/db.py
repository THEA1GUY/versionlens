"""SQLite access layer.

ponytail: stdlib sqlite3, no ORM. Eight tables and hand-written SQL beat a migration
framework at this size. The schema is PostgreSQL-shaped (TEXT ids, JSON columns, explicit
foreign keys) so moving to Postgres later is a connection change plus type tweaks, not a
rewrite.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("VERSIONLENS_DB", ROOT / "storage" / "versionlens.db"))
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

DEFAULT_ORG_ID = "org_default"
DEFAULT_ORG_NAME = "Default organization"

_local = threading.local()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def connect() -> sqlite3.Connection:
    """One connection per thread; background workers run on their own threads."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        return conn
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    _local.conn = conn
    return conn


def init_db() -> None:
    conn = connect()
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.execute(
        "INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (?, ?, ?)",
        (DEFAULT_ORG_ID, DEFAULT_ORG_NAME, now()),
    )
    conn.commit()


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return connect().execute(sql, tuple(params)).fetchall()


def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return connect().execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    conn = connect()
    conn.execute(sql, tuple(params))
    conn.commit()


def execute_many(sql: str, rows: Iterable[Iterable[Any]]) -> None:
    conn = connect()
    conn.executemany(sql, [tuple(r) for r in rows])
    conn.commit()


def ensure_org(org_id: str, name: str | None = None) -> str:
    execute(
        "INSERT OR IGNORE INTO organizations (id, name, created_at) VALUES (?, ?, ?)",
        (org_id, name or org_id, now()),
    )
    return org_id


def audit(
    action: str,
    subject_type: str,
    subject_id: str,
    actor: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append-only trail: who did what, to what, when (TRD §22)."""
    execute(
        "INSERT INTO audit_log (occurred_at, actor, action, subject_type, subject_id, detail_json)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (now(), actor, action, subject_type, subject_id,
         json.dumps(detail, ensure_ascii=False) if detail else None),
    )


def audit_trail(subject_type: str, subject_id: str) -> list[dict[str, Any]]:
    rows = query(
        "SELECT occurred_at, actor, action, detail_json FROM audit_log"
        " WHERE subject_type = ? AND subject_id = ? ORDER BY occurred_at, id",
        (subject_type, subject_id),
    )
    return [
        {
            "occurred_at": r["occurred_at"],
            "actor": r["actor"],
            "action": r["action"],
            "detail": json.loads(r["detail_json"]) if r["detail_json"] else None,
        }
        for r in rows
    ]


def loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)
