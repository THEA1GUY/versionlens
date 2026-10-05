"""API tests: the whole flow from upload through review to export.

Each test module run gets its own database and object store so nothing leaks between
runs or into a developer's real storage directory.
"""

from __future__ import annotations

import importlib
import os
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "fixtures" / "demo"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    from fastapi.testclient import TestClient

    sandbox = tmp_path_factory.mktemp("versionlens-api")
    os.environ["VERSIONLENS_DB"] = str(sandbox / "test.db")
    os.environ["VERSIONLENS_STORAGE"] = str(sandbox / "objects")

    from api import db, storage

    importlib.reload(db)
    importlib.reload(storage)
    from api import main

    importlib.reload(main)

    with TestClient(main.app) as c:
        yield c


def upload(client, path: Path):
    with open(path, "rb") as fh:
        response = client.post(
            "/api/documents",
            files={
                "file": (
                    path.name,
                    fh.read(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
            headers={"X-User": "tester@example.com"},
        )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope="module")
def comparison(client):
    a = upload(client, DEMO / "proposal_v3.docx")
    b = upload(client, DEMO / "proposal_v4.docx")
    response = client.post(
        "/api/comparisons",
        json={
            "version_a_document_id": a["id"],
            "version_b_document_id": b["id"],
            "name": "Acme Proposal — September Revision",
            "use_semantic": False,
        },
        headers={"X-User": "tester@example.com"},
    )
    assert response.status_code == 202, response.text
    comparison_id = response.json()["id"]

    # TestClient runs background tasks before the response returns, but poll anyway so
    # this test does not depend on that implementation detail.
    for _ in range(100):
        state = client.get(f"/api/comparisons/{comparison_id}").json()
        if state["status"] in ("COMPLETED", "PARTIAL", "FAILED"):
            break
        time.sleep(0.1)
    assert state["status"] in ("COMPLETED", "PARTIAL"), state
    return {"id": comparison_id, "doc_a": a, "doc_b": b, "state": state}


# --------------------------------------------------------------------------- basics


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert ".pdf" in body["supported_formats"]
    assert "does not constitute legal advice" in body["disclaimer"]


def test_upload_reports_pages_and_hash(client):
    doc = upload(client, DEMO / "proposal_v3.docx")
    assert doc["page_count"] >= 2
    assert len(doc["sha256"]) == 64
    assert doc["extraction_status"] == "extraction_successful"
    assert doc["block_count"] > 10


def test_unsupported_upload_is_rejected(client):
    response = client.post(
        "/api/documents", files={"file": ("notes.rtf", b"hello", "application/rtf")}
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_empty_upload_is_rejected(client):
    response = client.post("/api/documents", files={"file": ("empty.docx", b"", "application/zip")})
    assert response.status_code == 400


def test_original_is_served_with_verified_hash(client):
    doc = upload(client, DEMO / "proposal_v3.docx")
    response = client.get(f"/api/documents/{doc['id']}/file")
    assert response.status_code == 200
    assert response.headers["x-content-sha256"] == doc["sha256"]
    assert len(response.content) == doc["size_bytes"]


def test_document_integrity_is_checked(client):
    doc = upload(client, DEMO / "proposal_v3.docx")
    assert client.get(f"/api/documents/{doc['id']}").json()["integrity"] == "verified"


def test_tampered_original_is_detected(client):
    """PRD §21 / TRD §38 — a modified original must not be served silently."""
    from api import db, storage

    doc = upload(client, DEMO / "proposal_v3.docx")
    row = db.query_one("SELECT storage_key FROM documents WHERE id = ?", (doc["id"],))
    path = storage.resolve(row["storage_key"])
    path.chmod(0o666)
    path.write_bytes(path.read_bytes() + b"tampered")

    assert client.get(f"/api/documents/{doc['id']}").json()["integrity"] == "failed"
    response = client.get(f"/api/documents/{doc['id']}/file")
    assert response.status_code == 409
    assert "no longer matches" in response.json()["detail"]


def test_document_content_has_provenance(client):
    doc = upload(client, DEMO / "proposal_v4.docx")
    content = client.get(f"/api/documents/{doc['id']}/content").json()
    assert content["blocks"] and content["sections"] and content["pages"]
    block = content["blocks"][0]
    assert {"id", "page", "section_id", "text", "block_type"} <= set(block)
    assert all(b["page"] >= 1 for b in content["blocks"])


def test_document_not_found(client):
    assert client.get("/api/documents/doc_missing").status_code == 404


# ----------------------------------------------------------------------- comparison


def test_comparison_completes(comparison):
    state = comparison["state"]
    assert state["summary"]["total_changes"] > 0
    assert state["documents"]["a"]["filename"] == "proposal_v3.docx"
    assert state["section_map"]
    assert "legal advice" in state["disclaimer"]


def test_comparison_records_engine_versions(client, comparison):
    audit = client.get(f"/api/comparisons/{comparison['id']}/audit").json()
    assert audit["engine_version"] and audit["extraction_version"]
    assert audit["documents"]["a"]["sha256"] != audit["documents"]["b"]["sha256"]
    actions = {entry["action"] for entry in audit["trail"]}
    assert {"document.uploaded", "comparison.created", "comparison.completed"} <= actions


def test_changes_carry_both_citations(client, comparison):
    body = client.get(
        f"/api/comparisons/{comparison['id']}/changes",
        params={"importance": ["HIGH"]},
    ).json()
    assert body["changes"]
    modified = [c for c in body["changes"] if c["type"] == "MODIFIED"]
    assert modified
    for change in modified:
        assert change["citation_a"] and change["citation_b"]
        for citation in (change["citation_a"], change["citation_b"]):
            assert citation["block_id"] and citation["page"] >= 1
            assert citation["section"]
        assert change["detectors"]


def test_citation_text_exists_in_the_source_document(client, comparison):
    """The core promise: a citation must resolve to real text in the stored original."""
    body = client.get(
        f"/api/comparisons/{comparison['id']}/changes", params={"importance": ["HIGH"]}
    ).json()
    content = {
        "A": client.get(f"/api/documents/{comparison['doc_a']['id']}/content").json(),
        "B": client.get(f"/api/documents/{comparison['doc_b']['id']}/content").json(),
    }
    blocks = {
        side: {b["id"]: b for b in doc["blocks"]} for side, doc in content.items()
    }
    checked = 0
    for change in body["changes"]:
        for key, side in (("citation_a", "A"), ("citation_b", "B")):
            citation = change.get(key)
            if not citation:
                continue
            # Block ids are side-prefixed by the engine; the stored content is extracted
            # as side A, so compare on the page/text rather than the raw id.
            page_blocks = [
                b for b in blocks[side].values() if b["page"] == citation["page"]
            ]
            assert page_blocks, f"citation to page {citation['page']} with no blocks"
            haystack = " ".join(b["text"] for b in page_blocks)
            assert citation["text"][:60] in haystack, citation["text"][:60]
            checked += 1
    assert checked > 5


def test_filters_narrow_results(client, comparison):
    cid = comparison["id"]
    all_changes = client.get(f"/api/comparisons/{cid}/changes").json()
    pricing = client.get(
        f"/api/comparisons/{cid}/changes", params={"category": ["PRICING"]}
    ).json()
    assert 0 < pricing["total"] < all_changes["total"]
    for change in pricing["changes"]:
        assert "PRICING" in change["categories"]

    high = client.get(
        f"/api/comparisons/{cid}/changes", params={"importance": ["HIGH"]}
    ).json()
    assert all(c["importance"] == "HIGH" for c in high["changes"])

    no_minor = client.get(
        f"/api/comparisons/{cid}/changes", params={"include_minor": False}
    ).json()
    assert all(c["importance"] != "LOW" for c in no_minor["changes"])


def test_facets_cover_the_whole_comparison(client, comparison):
    body = client.get(
        f"/api/comparisons/{comparison['id']}/changes", params={"limit": 1}
    ).json()
    assert len(body["changes"]) == 1
    assert body["facets"]["total"] > 1
    assert body["facets"]["category"]
    assert sum(body["facets"]["importance"].values()) == body["facets"]["total"]


def test_search_finds_changes_and_document_text(client, comparison):
    body = client.get(
        f"/api/comparisons/{comparison['id']}/search", params={"q": "insurance"}
    ).json()
    assert body["query"] == "insurance"

    body = client.get(
        f"/api/comparisons/{comparison['id']}/search", params={"q": "exclusivity"}
    ).json()
    assert body["changes"] or body["document_matches"]
    hit = client.get(
        f"/api/comparisons/{comparison['id']}/search", params={"q": "6,000,000"}
    ).json()
    assert hit["document_matches"], "amount not found in document text"


# --------------------------------------------------------------------------- review


def test_review_workflow(client, comparison):
    cid = comparison["id"]
    first = client.get(f"/api/comparisons/{cid}/changes", params={"limit": 1}).json()
    record_id = first["changes"][0]["record_id"]

    response = client.patch(
        f"/api/changes/{record_id}/review",
        json={"status": "confirmed", "comment": "Confirmed with finance on 29 September."},
        headers={"X-User": "sarah@example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["review_status"] == "confirmed"
    assert body["reviewed_by"] == "sarah@example.com"
    assert body["reviewer_notes"][0]["body"].startswith("Confirmed with finance")

    progress = client.get(f"/api/comparisons/{cid}").json()["summary"]["review_progress"]
    assert progress["confirmed"] >= 1
    assert progress["reviewed"] >= 1
    assert progress["unreviewed"] == progress["total"] - progress["reviewed"]

    filtered = client.get(
        f"/api/comparisons/{cid}/changes", params={"review_status": ["confirmed"]}
    ).json()
    assert record_id in [c["record_id"] for c in filtered["changes"]]


def test_false_alert_marking(client, comparison):
    cid = comparison["id"]
    changes = client.get(f"/api/comparisons/{cid}/changes", params={"limit": 5}).json()
    record_id = changes["changes"][-1]["record_id"]
    body = client.patch(
        f"/api/changes/{record_id}/review", json={"status": "false_alert"}
    ).json()
    assert body["review_status"] == "false_alert"


def test_review_rejects_unknown_status(client, comparison):
    changes = client.get(
        f"/api/comparisons/{comparison['id']}/changes", params={"limit": 1}
    ).json()
    response = client.patch(
        f"/api/changes/{changes['changes'][0]['record_id']}/review",
        json={"status": "looks_fine"},
    )
    assert response.status_code == 422


def test_review_of_unknown_change_is_404(client):
    response = client.patch("/api/changes/chg_missing/review", json={"status": "confirmed"})
    assert response.status_code == 404


# --------------------------------------------------------------------------- export


@pytest.mark.parametrize(
    "fmt,signature",
    [
        ("pdf", b"%PDF"),
        ("docx", b"PK"),
        ("xlsx", b"PK"),
    ],
)
def test_binary_exports(client, comparison, fmt, signature):
    response = client.get(
        f"/api/comparisons/{comparison['id']}/export", params={"format": fmt}
    )
    assert response.status_code == 200, response.text
    assert response.content.startswith(signature)
    assert len(response.content) > 2000
    assert "attachment" in response.headers["content-disposition"]


def test_csv_export_has_citations(client, comparison):
    response = client.get(
        f"/api/comparisons/{comparison['id']}/export", params={"format": "csv"}
    )
    assert response.status_code == 200
    text = response.content.decode("utf-8-sig")
    header, *rows = text.splitlines()
    assert "A reference" in header and "B reference" in header
    assert rows
    assert any("page" in row for row in rows)


def test_export_includes_reviewer_notes(client, comparison):
    response = client.get(
        f"/api/comparisons/{comparison['id']}/export",
        params={"format": "csv", "include_minor": True},
    )
    assert "Confirmed with finance" in response.content.decode("utf-8-sig")


def test_export_of_unknown_comparison_is_404(client):
    assert (
        client.get("/api/comparisons/cmp_missing/export", params={"format": "csv"}).status_code
        == 404
    )


# ------------------------------------------------------------------- org separation


def test_other_org_cannot_read_comparison(client, comparison):
    """TRD §36 — organization-level separation."""
    response = client.get(
        f"/api/comparisons/{comparison['id']}", headers={"X-Org-Id": "org_other"}
    )
    assert response.status_code == 404
    response = client.get(
        f"/api/documents/{comparison['doc_a']['id']}", headers={"X-Org-Id": "org_other"}
    )
    assert response.status_code == 404


def test_comparison_across_orgs_is_rejected(client, comparison):
    response = client.post(
        "/api/comparisons",
        json={
            "version_a_document_id": comparison["doc_a"]["id"],
            "version_b_document_id": comparison["doc_b"]["id"],
        },
        headers={"X-Org-Id": "org_other"},
    )
    assert response.status_code == 404


if __name__ == "__main__":
    raise SystemExit(pytest.main([str(Path(__file__)), "-q"]))
