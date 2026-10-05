"""Push the demo pair through a running API so the UI has something to show.

  python -m fixtures.seed_demo [--api http://127.0.0.1:8000]
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path

DEMO = Path(__file__).resolve().parent / "demo"


def post_file(api: str, path: Path) -> dict:
    boundary = f"----versionlens{uuid.uuid4().hex}"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    request = urllib.request.Request(
        f"{api}/api/documents",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-User": "demo@versionlens.local",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def post_json(api: str, path: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{api}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-User": "demo@versionlens.local"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def get_json(api: str, path: str) -> dict:
    with urllib.request.urlopen(f"{api}{path}", timeout=120) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--semantic", action="store_true")
    args = parser.parse_args()

    if not (DEMO / "proposal_v3.docx").exists():
        print("Demo files missing. Run: python -m fixtures.make_demo")
        return 1

    a = post_file(args.api, DEMO / "proposal_v3.docx")
    b = post_file(args.api, DEMO / "proposal_v4.docx")
    print(f"uploaded A {a['id']} ({a['page_count']} pages)")
    print(f"uploaded B {b['id']} ({b['page_count']} pages)")

    created = post_json(
        args.api,
        "/api/comparisons",
        {
            "version_a_document_id": a["id"],
            "version_b_document_id": b["id"],
            "name": "Acme Website Redesign Proposal — v3 vs v4",
            "document_category": "proposal",
            "notes": "Client returned a revised proposal ahead of the September review.",
            "use_semantic": args.semantic,
        },
    )
    comparison_id = created["id"]
    print(f"comparison {comparison_id} queued")

    for _ in range(120):
        state = get_json(args.api, f"/api/comparisons/{comparison_id}")
        if state["status"] in ("COMPLETED", "PARTIAL", "FAILED"):
            break
        time.sleep(0.5)

    print(f"status: {state['status']}")
    if state["status"] == "FAILED":
        print(state.get("error"))
        return 1
    summary = state["summary"]
    print(f"{summary['total_changes']} changes — "
          f"{summary['high_attention']} high, {summary['medium_attention']} medium, "
          f"{summary['low_attention']} minor")
    print(f"open: http://localhost:3000/comparisons/{comparison_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
