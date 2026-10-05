"""Minimal .env loader.

ponytail: stdlib, no python-dotenv. Twelve lines covers `KEY=value`, comments, quotes
and `export ` prefixes, which is the whole of what this project's .env needs.

Real environment variables always win over the file, so a shell export or a container
secret overrides a stale .env instead of being silently shadowed by it.
"""

from __future__ import annotations

import os
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
_loaded = False


def load_env(path: Path | None = None, force: bool = False) -> dict[str, str]:
    """Read .env into os.environ for keys not already set. Safe to call repeatedly."""
    global _loaded
    target = path or ENV_PATH
    if _loaded and not force and path is None:
        return {}
    if path is None:
        _loaded = True
    if not target.exists():
        return {}

    applied: dict[str, str] = {}
    for raw in target.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not key or key in os.environ:
            continue
        os.environ[key] = value
        applied[key] = value
    return applied
