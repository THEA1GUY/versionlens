"""Immutable object storage for originals (TRD §4, §38; PRD §21).

Originals are written once, never rewritten, and verified against their stored SHA-256
before they are served or exported. The local filesystem backend mirrors the S3/R2 key
layout (documents/{document_id}/original{ext}) so swapping in a cloud bucket is a change
of `put`/`open`/`verify` only.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = Path(os.environ.get("VERSIONLENS_STORAGE", ROOT / "storage" / "objects"))

SUPPORTED_SUFFIXES = {".pdf", ".docx", ".txt", ".md"}
MIME_BY_SUFFIX = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
}
MAX_BYTES = int(os.environ.get("VERSIONLENS_MAX_UPLOAD_BYTES", 80 * 1024 * 1024))


class StorageError(Exception):
    pass


class IntegrityError(StorageError):
    """Raised when a stored original no longer matches the hash recorded at upload."""


@dataclass
class StoredObject:
    storage_key: str
    sha256: str
    size_bytes: int
    mime_type: str
    path: Path


def storage_key(document_id: str, filename: str) -> str:
    return f"documents/{document_id}/original{Path(filename).suffix.lower()}"


def resolve(key: str) -> Path:
    """Reject anything that would escape the storage root."""
    target = (STORAGE_ROOT / key).resolve()
    root = STORAGE_ROOT.resolve()
    if root != target and root not in target.parents:
        raise StorageError(f"Refusing to access path outside storage root: {key}")
    return target


def put(document_id: str, filename: str, data: bytes) -> StoredObject:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise StorageError(
            f"Unsupported file type '{suffix}'. Supported: "
            f"{', '.join(sorted(SUPPORTED_SUFFIXES))}"
        )
    if not data:
        raise StorageError("The uploaded file is empty.")
    if len(data) > MAX_BYTES:
        raise StorageError(f"File exceeds the {MAX_BYTES // (1024 * 1024)}MB upload limit.")

    key = storage_key(document_id, filename)
    path = resolve(key)
    if path.exists():
        raise StorageError(f"Refusing to overwrite an existing original at {key}")
    path.parent.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(data).hexdigest()
    # Write to a temporary name then move, so a failed write cannot leave a partial
    # original that would later fail its own integrity check.
    staging = path.with_suffix(path.suffix + ".part")
    staging.write_bytes(data)
    staging.replace(path)
    _make_read_only(path)

    return StoredObject(
        storage_key=key,
        sha256=digest,
        size_bytes=len(data),
        mime_type=MIME_BY_SUFFIX.get(suffix, "application/octet-stream"),
        path=path,
    )


def _make_read_only(path: Path) -> None:
    """Best-effort: strip write permission so accidental writes fail loudly."""
    try:
        path.chmod(0o444)
    except OSError:
        pass


def verify(key: str, expected_sha256: str) -> Path:
    """Return the path only if the bytes still hash to what was recorded at upload."""
    path = resolve(key)
    if not path.exists():
        raise IntegrityError(f"Original file is missing from storage: {key}")
    actual = sha256_path(path)
    if actual != expected_sha256:
        raise IntegrityError(
            f"Stored original no longer matches its recorded hash ({key}). "
            f"Expected {expected_sha256[:12]}…, found {actual[:12]}…"
        )
    return path


def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def delete(key: str) -> None:
    """Explicit deletion workflow only (TRD §36) — never called during a comparison."""
    path = resolve(key)
    if not path.exists():
        return
    try:
        path.chmod(0o666)
    except OSError:
        pass
    folder = path.parent
    path.unlink()
    if folder.is_dir() and not any(folder.iterdir()):
        shutil.rmtree(folder, ignore_errors=True)
