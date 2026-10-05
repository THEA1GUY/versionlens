"""VersionLens HTTP API (TRD §34-35).

Comparisons run on a background worker thread; the API returns immediately with a
comparison id and the client polls for stage progress.

ponytail: FastAPI's own BackgroundTasks rather than Celery + Redis. One process, no
broker to run. The pipeline is a single in-process function call, so the only thing a
broker would add for the MVP is operational surface. Swap in a real queue when
comparisons need to survive a restart or scale past one host.
"""

from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, Body, FastAPI, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from engine import ENGINE_VERSION, EXTRACTION_VERSION, SemanticAnalyzer, Stage, compare_documents
from engine.changes import Category, ChangeType, Importance, ReviewStatus
from engine.compare import DISCLAIMER

from . import db, export, storage

@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="VersionLens API",
    version=ENGINE_VERSION,
    description="Document version comparison with source-backed citations. "
    "Review aid — not legal advice.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        o.strip()
        for o in os.environ.get(
            "VERSIONLENS_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if o.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------ context

# MVP identity: the organization and user arrive as headers so every row is scoped and
# every action is attributable. This is deliberately NOT authentication — see README.
def context(
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> tuple[str, str | None]:
    org = x_org_id or db.DEFAULT_ORG_ID
    db.ensure_org(org)
    return org, x_user


# ------------------------------------------------------------------------- schemas


class ComparisonRequest(BaseModel):
    version_a_document_id: str
    version_b_document_id: str
    name: str | None = None
    document_category: str | None = None
    notes: str | None = None
    locale: Literal["DMY", "MDY"] = "DMY"
    use_semantic: bool = True


class ReviewRequest(BaseModel):
    status: Literal["unreviewed", "confirmed", "false_alert", "needs_discussion", "resolved"]
    comment: str | None = Field(default=None, max_length=4000)


# --------------------------------------------------------------------------- misc


@app.get("/api/health")
def health() -> dict[str, Any]:
    analyzer = SemanticAnalyzer()
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "extraction_version": EXTRACTION_VERSION,
        "semantic_available": analyzer.available,
        "semantic_model": analyzer.model_version,
        "supported_formats": sorted(storage.SUPPORTED_SUFFIXES),
        "max_upload_bytes": storage.MAX_BYTES,
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/meta/filters")
def filters() -> dict[str, Any]:
    return {
        "categories": [c.value for c in Category],
        "change_types": [t.value for t in ChangeType],
        "importance": [i.value for i in Importance],
        "review_statuses": [r.value for r in ReviewStatus],
    }


# ----------------------------------------------------------------------- documents


@app.post("/api/documents", status_code=201)
async def upload_document(
    file: UploadFile,
    label: str | None = Query(default=None),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> dict[str, Any]:
    org, user = context(x_org_id, x_user)
    data = await file.read()
    document_id = db.new_id("doc")
    try:
        stored = storage.put(document_id, file.filename or "upload", data)
    except storage.StorageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    db.execute(
        "INSERT INTO documents (id, organization_id, filename, mime_type, size_bytes, sha256,"
        " storage_key, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (document_id, org, file.filename or "upload", stored.mime_type, stored.size_bytes,
         stored.sha256, stored.storage_key, user, db.now()),
    )
    db.audit("document.uploaded", "document", document_id, user,
             {"filename": file.filename, "sha256": stored.sha256,
              "size_bytes": stored.size_bytes})

    # Extract eagerly so the upload screen can report page count and readiness, and so a
    # malformed file is rejected before a comparison is ever created.
    version = _extract_version(document_id, stored, label)
    return {
        "id": document_id,
        "filename": file.filename,
        "mime_type": stored.mime_type,
        "size_bytes": stored.size_bytes,
        "sha256": stored.sha256,
        **version,
    }


def _extract_version(document_id: str, stored: storage.StoredObject, label: str | None):
    from engine.extract import extract
    from engine.segment import leaf_sections, segment

    version_id = db.new_id("ver")
    try:
        doc = segment(extract(stored.path, "A"))
    except Exception as exc:  # noqa: BLE001 - reported to the client, not swallowed
        db.execute(
            "INSERT INTO document_versions (id, document_id, label, parser_version, page_count,"
            " extraction_status, content_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (version_id, document_id, label, EXTRACTION_VERSION, 0, "failed", None, db.now()),
        )
        raise HTTPException(status_code=400, detail=f"Could not read the document: {exc}") from exc

    status = "partial" if doc.warnings else "extraction_successful"
    content = {
        "pages": [
            {
                "page_number": p.page_number,
                "status": p.status.value,
                "extraction_confidence": p.extraction_confidence,
                "note": p.note,
            }
            for p in doc.pages
        ],
        "sections": [
            {
                "id": s.id,
                "label": s.label,
                "heading": s.heading,
                "section_number": s.section_number,
                "level": s.level,
                "parent_id": s.parent_id,
                "start_page": s.start_page,
                "end_page": s.end_page,
                "order_index": s.order_index,
            }
            for s in doc.sections
        ],
        "blocks": [
            {
                "id": b.id,
                "page": b.page,
                "block_index": b.block_index,
                "block_type": b.block_type.value,
                "section_id": b.section_id,
                "text": b.text,
                "cells": b.cells,
                "bbox": list(b.bbox) if b.bbox else None,
            }
            for b in doc.blocks
        ],
    }
    db.execute(
        "INSERT INTO document_versions (id, document_id, label, parser_version, page_count,"
        " extraction_status, content_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (version_id, document_id, label, EXTRACTION_VERSION, doc.page_count, status,
         db.dumps(content), db.now()),
    )
    return {
        "version_id": version_id,
        "page_count": doc.page_count,
        "section_count": len(leaf_sections(doc)),
        "block_count": len(doc.blocks),
        "extraction_status": status,
        "warnings": doc.warnings,
    }


@app.get("/api/documents")
def list_documents(
    limit: int = Query(default=50, le=200),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    rows = db.query(
        "SELECT d.id, d.filename, d.mime_type, d.size_bytes, d.sha256, d.created_at,"
        " d.uploaded_by, v.page_count, v.extraction_status"
        " FROM documents d LEFT JOIN document_versions v ON v.document_id = d.id"
        " WHERE d.organization_id = ? ORDER BY d.created_at DESC LIMIT ?",
        (org, limit),
    )
    return {"documents": [dict(r) for r in rows]}


def _document(document_id: str, org: str):
    row = db.query_one(
        "SELECT * FROM documents WHERE id = ? AND organization_id = ?", (document_id, org)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return row


@app.get("/api/documents/{document_id}")
def get_document(
    document_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    row = _document(document_id, org)
    version = db.query_one(
        "SELECT id, page_count, extraction_status, parser_version FROM document_versions"
        " WHERE document_id = ? ORDER BY created_at DESC LIMIT 1",
        (document_id,),
    )
    integrity = "unverified"
    try:
        storage.verify(row["storage_key"], row["sha256"])
        integrity = "verified"
    except storage.IntegrityError:
        integrity = "failed"
    return {
        **{k: row[k] for k in row.keys() if k != "organization_id"},
        "version": dict(version) if version else None,
        "integrity": integrity,
        "audit_trail": db.audit_trail("document", document_id),
    }


@app.get("/api/documents/{document_id}/content")
def get_document_content(
    document_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> dict[str, Any]:
    """Pages, sections and blocks — what the side-by-side viewer renders."""
    org, _ = context(x_org_id, None)
    _document(document_id, org)
    row = db.query_one(
        "SELECT content_json, page_count, extraction_status FROM document_versions"
        " WHERE document_id = ? ORDER BY created_at DESC LIMIT 1",
        (document_id,),
    )
    if row is None or not row["content_json"]:
        raise HTTPException(status_code=404, detail="No extracted content for this document")
    content = db.loads(row["content_json"], {})
    return {
        "document_id": document_id,
        "page_count": row["page_count"],
        "extraction_status": row["extraction_status"],
        **content,
    }


@app.get("/api/documents/{document_id}/file")
def download_document(
    document_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> Response:
    """Serves the original, but only after re-verifying its hash (TRD §38)."""
    org, _ = context(x_org_id, None)
    row = _document(document_id, org)
    try:
        path = storage.verify(row["storage_key"], row["sha256"])
    except storage.IntegrityError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(
        content=path.read_bytes(),
        media_type=row["mime_type"],
        headers={
            "Content-Disposition": f'inline; filename="{row["filename"]}"',
            "X-Content-SHA256": row["sha256"],
        },
    )


# --------------------------------------------------------------------- comparisons


@app.post("/api/comparisons", status_code=202)
def create_comparison(
    payload: ComparisonRequest,
    background: BackgroundTasks,
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> dict[str, Any]:
    org, user = context(x_org_id, x_user)
    doc_a = _document(payload.version_a_document_id, org)
    doc_b = _document(payload.version_b_document_id, org)

    comparison_id = db.new_id("cmp")
    db.execute(
        "INSERT INTO comparisons (id, organization_id, name, document_category, notes,"
        " version_a_document_id, version_b_document_id, status, stage_message, locale,"
        " use_semantic, engine_version, extraction_version, created_by, created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (comparison_id, org, payload.name, payload.document_category, payload.notes,
         doc_a["id"], doc_b["id"], Stage.UPLOADED.value, "Queued", payload.locale,
         int(payload.use_semantic), ENGINE_VERSION, EXTRACTION_VERSION, user, db.now()),
    )
    db.audit("comparison.created", "comparison", comparison_id, user,
             {"version_a": doc_a["id"], "version_b": doc_b["id"],
              "use_semantic": payload.use_semantic})

    background.add_task(
        run_comparison,
        comparison_id,
        doc_a["storage_key"],
        doc_a["sha256"],
        doc_a["filename"],
        doc_b["storage_key"],
        doc_b["sha256"],
        doc_b["filename"],
        payload.locale,
        payload.use_semantic,
        user,
    )
    return {"id": comparison_id, "status": Stage.UPLOADED.value, "stage_message": "Queued"}


def run_comparison(
    comparison_id: str,
    key_a: str,
    sha_a: str,
    name_a: str,
    key_b: str,
    sha_b: str,
    name_b: str,
    locale: str,
    use_semantic: bool,
    user: str | None,
) -> None:
    """Background worker. Originals are verified, then read from a read-only copy."""

    def set_stage(stage: Stage, message: str) -> None:
        db.execute(
            "UPDATE comparisons SET status = ?, stage_message = ? WHERE id = ?",
            (stage.value, message, comparison_id),
        )

    try:
        path_a = storage.verify(key_a, sha_a)
        path_b = storage.verify(key_b, sha_b)
    except storage.IntegrityError as exc:
        set_stage(Stage.FAILED, str(exc))
        db.execute("UPDATE comparisons SET error = ? WHERE id = ?", (str(exc), comparison_id))
        db.audit("comparison.failed", "comparison", comparison_id, user, {"error": str(exc)})
        return

    set_stage(Stage.EXTRACTING, "Reading documents")
    # The engine opens files read-only, but comparing from copies keeps the guarantee
    # that nothing in the pipeline can touch an original (PRD §21).
    with tempfile.TemporaryDirectory(prefix="versionlens-") as tmp:
        work_a = Path(tmp) / f"a{path_a.suffix}"
        work_b = Path(tmp) / f"b{path_b.suffix}"
        work_a.write_bytes(path_a.read_bytes())
        work_b.write_bytes(path_b.read_bytes())

        result = compare_documents(
            work_a,
            work_b,
            label_a=name_a,
            label_b=name_b,
            use_semantic=use_semantic,
            locale=locale,
            uploaded_by=user,
            progress=set_stage,
        )

    if result.status is Stage.FAILED:
        db.execute(
            "UPDATE comparisons SET status = ?, stage_message = ?, error = ?, audit_json = ?"
            " WHERE id = ?",
            (Stage.FAILED.value, "Comparison failed", result.error,
             db.dumps(result.audit), comparison_id),
        )
        db.audit("comparison.failed", "comparison", comparison_id, user,
                 {"error": result.error})
        return

    # Filenames in the result come from the temp copies; report the real ones.
    documents = result.documents
    documents["a"]["filename"] = name_a
    documents["b"]["filename"] = name_b
    documents["a"]["sha256"] = sha_a
    documents["b"]["sha256"] = sha_b

    rows = []
    for ordinal, change in enumerate(result.changes):
        payload = change.to_dict()
        search_text = " ".join(
            filter(
                None,
                [
                    change.summary,
                    change.text_a,
                    change.text_b,
                    change.section_a or "",
                    change.section_b or "",
                    str((change.old_value or {}).get("source_text") or ""),
                    str((change.new_value or {}).get("source_text") or ""),
                ],
            )
        ).lower()
        rows.append(
            (
                db.new_id("chg"),
                comparison_id,
                change.id,
                ordinal,
                change.type.value,
                change.category.value,
                db.dumps([c.value for c in change.categories]),
                change.importance.value,
                change.importance_score,
                change.confidence,
                change.summary,
                search_text,
                db.dumps(payload),
                change.review_status.value,
            )
        )
    db.execute_many(
        "INSERT INTO changes (id, comparison_id, change_key, ordinal, type, category,"
        " categories, importance, importance_score, confidence, summary, search_text,"
        " payload_json, review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    db.execute(
        "UPDATE comparisons SET status = ?, stage_message = ?, summary_json = ?,"
        " section_map_json = ?, documents_json = ?, warnings_json = ?, audit_json = ?,"
        " analysis_model_version = ?, completed_at = ? WHERE id = ?",
        (
            result.status.value,
            "Comparison complete",
            db.dumps(result.summary),
            db.dumps(result.section_map),
            db.dumps(documents),
            db.dumps(result.warnings),
            db.dumps(result.audit),
            result.audit.get("analysis_model_version"),
            db.now(),
            comparison_id,
        ),
    )
    db.audit("comparison.completed", "comparison", comparison_id, user,
             {"changes": len(rows), "status": result.status.value,
              "engine_version": ENGINE_VERSION,
              "analysis_model_version": result.audit.get("analysis_model_version")})


@app.get("/api/comparisons")
def list_comparisons(
    limit: int = Query(default=50, le=200),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    rows = db.query(
        "SELECT c.id, c.name, c.status, c.stage_message, c.created_at, c.completed_at,"
        " c.document_category, a.filename AS version_a_filename, b.filename AS version_b_filename,"
        " (SELECT COUNT(*) FROM changes WHERE comparison_id = c.id) AS change_count,"
        " (SELECT COUNT(*) FROM changes WHERE comparison_id = c.id AND review_status != 'unreviewed')"
        "   AS reviewed_count"
        " FROM comparisons c"
        " JOIN documents a ON a.id = c.version_a_document_id"
        " JOIN documents b ON b.id = c.version_b_document_id"
        " WHERE c.organization_id = ? ORDER BY c.created_at DESC LIMIT ?",
        (org, limit),
    )
    return {"comparisons": [dict(r) for r in rows]}


def _comparison(comparison_id: str, org: str):
    row = db.query_one(
        "SELECT * FROM comparisons WHERE id = ? AND organization_id = ?", (comparison_id, org)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Comparison not found")
    return row


@app.get("/api/comparisons/{comparison_id}")
def get_comparison(
    comparison_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    row = _comparison(comparison_id, org)
    counts = db.query_one(
        "SELECT COUNT(*) AS total,"
        " SUM(review_status = 'confirmed') AS confirmed,"
        " SUM(review_status = 'false_alert') AS false_alerts,"
        " SUM(review_status = 'needs_discussion') AS needs_discussion,"
        " SUM(review_status = 'resolved') AS resolved,"
        " SUM(review_status = 'unreviewed') AS unreviewed"
        " FROM changes WHERE comparison_id = ?",
        (comparison_id,),
    )
    summary = db.loads(row["summary_json"], {})
    if summary and counts and counts["total"]:
        reviewed = (counts["total"] or 0) - (counts["unreviewed"] or 0)
        summary["review_progress"] = {
            "total": counts["total"] or 0,
            "reviewed": reviewed,
            "confirmed": counts["confirmed"] or 0,
            "false_alerts": counts["false_alerts"] or 0,
            "needs_discussion": counts["needs_discussion"] or 0,
            "resolved": counts["resolved"] or 0,
            "unreviewed": counts["unreviewed"] or 0,
        }
    return {
        "id": row["id"],
        "name": row["name"],
        "document_category": row["document_category"],
        "notes": row["notes"],
        "status": row["status"],
        "stage_message": row["stage_message"],
        "error": row["error"],
        "locale": row["locale"],
        "use_semantic": bool(row["use_semantic"]),
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "created_by": row["created_by"],
        "version_a_document_id": row["version_a_document_id"],
        "version_b_document_id": row["version_b_document_id"],
        "summary": summary,
        "section_map": db.loads(row["section_map_json"], []),
        "documents": db.loads(row["documents_json"], {}),
        "warnings": db.loads(row["warnings_json"], []),
        "audit": db.loads(row["audit_json"], {}),
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/comparisons/{comparison_id}/changes")
def get_changes(
    comparison_id: str,
    category: list[str] | None = Query(default=None),
    importance: list[str] | None = Query(default=None),
    change_type: list[str] | None = Query(default=None),
    review_status: list[str] | None = Query(default=None),
    min_confidence: float | None = Query(default=None, ge=0.0, le=1.0),
    q: str | None = Query(default=None, description="free-text search over changes"),
    include_minor: bool = Query(default=True),
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    _comparison(comparison_id, org)

    where = ["comparison_id = ?"]
    params: list[Any] = [comparison_id]

    # Category matches against the JSON array, so a change tagged both PRICING and
    # SCOPE appears under either filter (PRD §10 — a change can have several categories).
    if category:
        clauses = []
        for value in category:
            clauses.append("(category = ? OR categories LIKE ?)")
            params.extend([value, f'%"{value}"%'])
        where.append("(" + " OR ".join(clauses) + ")")
    if importance:
        where.append(f"importance IN ({','.join('?' * len(importance))})")
        params.extend(importance)
    if change_type:
        where.append(f"type IN ({','.join('?' * len(change_type))})")
        params.extend(change_type)
    if review_status:
        where.append(f"review_status IN ({','.join('?' * len(review_status))})")
        params.extend(review_status)
    if min_confidence is not None:
        where.append("confidence >= ?")
        params.append(min_confidence)
    if not include_minor:
        where.append("importance != 'LOW'")
    if q:
        where.append("search_text LIKE ?")
        params.append(f"%{q.lower()}%")

    sql = (
        "SELECT id, change_key, payload_json, review_status, reviewed_by, reviewed_at"
        f" FROM changes WHERE {' AND '.join(where)}"
        " ORDER BY ordinal LIMIT ? OFFSET ?"
    )
    rows = db.query(sql, params + [limit, offset])
    total = db.query_one(
        f"SELECT COUNT(*) AS n FROM changes WHERE {' AND '.join(where)}", params
    )

    changes = [_change_payload(r) for r in rows]
    facets = _facets(comparison_id)
    return {"changes": changes, "total": total["n"] if total else 0, "facets": facets}


def _change_payload(row) -> dict[str, Any]:
    payload = db.loads(row["payload_json"], {})
    payload["record_id"] = row["id"]
    payload["review_status"] = row["review_status"]
    payload["reviewed_by"] = row["reviewed_by"]
    payload["reviewed_at"] = row["reviewed_at"]
    payload["reviewer_notes"] = [
        {"author": n["author"], "body": n["body"], "created_at": n["created_at"]}
        for n in db.query(
            "SELECT author, body, created_at FROM change_notes WHERE change_id = ?"
            " ORDER BY created_at",
            (row["id"],),
        )
    ]
    return payload


def _facets(comparison_id: str) -> dict[str, Any]:
    """Counts for the filter bar, computed over the whole comparison not the page."""
    out: dict[str, Any] = {"category": {}, "importance": {}, "type": {}, "review_status": {}}
    for column, key in (
        ("importance", "importance"),
        ("type", "type"),
        ("review_status", "review_status"),
    ):
        for row in db.query(
            f"SELECT {column} AS k, COUNT(*) AS n FROM changes WHERE comparison_id = ?"
            f" GROUP BY {column}",
            (comparison_id,),
        ):
            out[key][row["k"]] = row["n"]
    for row in db.query(
        "SELECT categories FROM changes WHERE comparison_id = ?", (comparison_id,)
    ):
        for value in db.loads(row["categories"], []):
            out["category"][value] = out["category"].get(value, 0) + 1
    out["total"] = sum(out["importance"].values())
    return out


@app.get("/api/changes/{record_id}")
def get_change(
    record_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    row = _change_row(record_id, org)
    return _change_payload(row)


def _change_row(record_id: str, org: str):
    row = db.query_one(
        "SELECT ch.* FROM changes ch JOIN comparisons c ON c.id = ch.comparison_id"
        " WHERE ch.id = ? AND c.organization_id = ?",
        (record_id, org),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Change not found")
    return row


@app.patch("/api/changes/{record_id}/review")
def review_change(
    record_id: str,
    payload: ReviewRequest,
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> dict[str, Any]:
    org, user = context(x_org_id, x_user)
    row = _change_row(record_id, org)
    db.execute(
        "UPDATE changes SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        (payload.status, user, db.now(), record_id),
    )
    if payload.comment:
        db.execute(
            "INSERT INTO change_notes (id, change_id, author, body, created_at)"
            " VALUES (?,?,?,?,?)",
            (db.new_id("note"), record_id, user, payload.comment, db.now()),
        )
    db.audit("change.reviewed", "change", record_id, user,
             {"status": payload.status, "comparison_id": row["comparison_id"],
              "has_comment": bool(payload.comment)})
    return _change_payload(_change_row(record_id, org))


@app.get("/api/comparisons/{comparison_id}/search")
def search_comparison(
    comparison_id: str,
    q: str = Query(min_length=1),
    limit: int = Query(default=50, le=200),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
) -> dict[str, Any]:
    """Searches changes and both documents' text (PRD §17)."""
    org, _ = context(x_org_id, None)
    row = _comparison(comparison_id, org)
    needle = q.lower()

    change_hits = [
        {
            "record_id": r["id"],
            "change_key": r["change_key"],
            "summary": r["summary"],
            "category": r["category"],
            "importance": r["importance"],
        }
        for r in db.query(
            "SELECT id, change_key, summary, category, importance FROM changes"
            " WHERE comparison_id = ? AND search_text LIKE ? ORDER BY ordinal LIMIT ?",
            (comparison_id, f"%{needle}%", limit),
        )
    ]

    document_hits: list[dict[str, Any]] = []
    for side, column in (("A", "version_a_document_id"), ("B", "version_b_document_id")):
        content_row = db.query_one(
            "SELECT content_json FROM document_versions WHERE document_id = ?"
            " ORDER BY created_at DESC LIMIT 1",
            (row[column],),
        )
        content = db.loads(content_row["content_json"], {}) if content_row else {}
        sections = {s["id"]: s["label"] for s in content.get("sections", [])}
        for block in content.get("blocks", []):
            if needle in (block.get("text") or "").lower():
                document_hits.append(
                    {
                        "side": side,
                        "document_id": row[column],
                        "block_id": block["id"],
                        "page": block["page"],
                        "section": sections.get(block.get("section_id"), "(unsectioned)"),
                        "text": block["text"],
                    }
                )
            if len(document_hits) >= limit * 2:
                break
    return {"query": q, "changes": change_hits, "document_matches": document_hits}


@app.get("/api/comparisons/{comparison_id}/export")
def export_comparison(
    comparison_id: str,
    format: Literal["pdf", "docx", "csv", "xlsx"] = Query(default="pdf"),
    include_minor: bool = Query(default=False),
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> Response:
    org, user = context(x_org_id, x_user)
    row = _comparison(comparison_id, org)
    if row["status"] not in (Stage.COMPLETED.value, Stage.PARTIAL.value):
        raise HTTPException(
            status_code=409,
            detail=f"Comparison is not ready to export (status: {row['status']})",
        )

    where = "comparison_id = ?" + ("" if include_minor else " AND importance != 'LOW'")
    rows = db.query(
        "SELECT id, change_key, payload_json, review_status, reviewed_by, reviewed_at"
        f" FROM changes WHERE {where} ORDER BY ordinal",
        (comparison_id,),
    )
    documents = db.loads(row["documents_json"], {})
    payload = {
        "meta": {
            "name": row["name"],
            "version_a": (documents.get("a") or {}).get("filename"),
            "version_b": (documents.get("b") or {}).get("filename"),
            "generated_at": db.now(),
            "status": row["status"],
            "comparison_id": comparison_id,
        },
        "summary": db.loads(row["summary_json"], {}),
        "warnings": db.loads(row["warnings_json"], []),
        "audit": {**db.loads(row["audit_json"], {}),
                  "version_a_sha256": (documents.get("a") or {}).get("sha256"),
                  "version_b_sha256": (documents.get("b") or {}).get("sha256")},
        "changes": [_change_payload(r) for r in rows],
    }

    builder, media_type, extension = export.EXPORTERS[format]
    try:
        content = builder(payload)
    except ImportError as exc:
        raise HTTPException(
            status_code=503, detail=f"Export format '{format}' is unavailable: {exc}"
        ) from exc

    db.audit("comparison.exported", "comparison", comparison_id, user,
             {"format": format, "include_minor": include_minor, "changes": len(rows)})
    stem = _safe_stem(row["name"] or comparison_id)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{stem}-comparison.{extension}"'
        },
    )


def _safe_stem(name: str) -> str:
    cleaned = "".join(c if c.isalnum() or c in "-_ " else "-" for c in name).strip()
    return ("-".join(cleaned.split()) or "versionlens")[:80]


@app.get("/api/comparisons/{comparison_id}/audit")
def comparison_audit(
    comparison_id: str, x_org_id: str | None = Header(default=None, alias="X-Org-Id")
) -> dict[str, Any]:
    org, _ = context(x_org_id, None)
    row = _comparison(comparison_id, org)
    documents = db.loads(row["documents_json"], {})
    trail = db.audit_trail("comparison", comparison_id)
    for side in ("version_a_document_id", "version_b_document_id"):
        trail.extend(db.audit_trail("document", row[side]))
    trail.sort(key=lambda e: e["occurred_at"])
    return {
        "comparison_id": comparison_id,
        "engine_version": row["engine_version"],
        "extraction_version": row["extraction_version"],
        "analysis_model_version": row["analysis_model_version"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "completed_at": row["completed_at"],
        "documents": {
            side: {
                "filename": (documents.get(side) or {}).get("filename"),
                "sha256": (documents.get(side) or {}).get("sha256"),
            }
            for side in ("a", "b")
        },
        "engine_audit": db.loads(row["audit_json"], {}),
        "trail": trail,
    }


@app.delete("/api/comparisons/{comparison_id}", status_code=204)
def delete_comparison(
    comparison_id: str,
    x_org_id: str | None = Header(default=None, alias="X-Org-Id"),
    x_user: str | None = Header(default=None, alias="X-User"),
) -> Response:
    """Deletes the comparison and its changes. Original documents are left untouched."""
    org, user = context(x_org_id, x_user)
    _comparison(comparison_id, org)
    db.execute("DELETE FROM changes WHERE comparison_id = ?", (comparison_id,))
    db.execute("DELETE FROM comparisons WHERE id = ?", (comparison_id,))
    db.audit("comparison.deleted", "comparison", comparison_id, user, None)
    return Response(status_code=204)
