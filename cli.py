"""Command-line comparison. Useful for debugging the engine without the web stack.

  python cli.py fixtures/demo/proposal_v3.docx fixtures/demo/proposal_v4.docx
  python cli.py a.pdf b.pdf --json out.json --no-semantic
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from engine import Stage, compare_documents

_BADGE = {"HIGH": "HIGH  ", "MEDIUM": "MEDIUM", "LOW": "LOW   "}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two document versions.")
    parser.add_argument("version_a")
    parser.add_argument("version_b")
    parser.add_argument("--json", dest="json_out", help="write the full result to this path")
    parser.add_argument("--no-semantic", action="store_true", help="deterministic layers only")
    parser.add_argument("--locale", default="DMY", choices=["DMY", "MDY"])
    parser.add_argument("--all", action="store_true", help="include minor changes")
    args = parser.parse_args(argv)

    def progress(stage: Stage, message: str) -> None:
        print(f"  [{stage.value:<18}] {message}", file=sys.stderr)

    result = compare_documents(
        args.version_a,
        args.version_b,
        label_a=Path(args.version_a).name,
        label_b=Path(args.version_b).name,
        use_semantic=not args.no_semantic,
        locale=args.locale,
        progress=progress,
    )

    if result.status is Stage.FAILED:
        print(f"FAILED: {result.error}", file=sys.stderr)
        return 1

    s = result.summary
    print()
    print(s["headline"])
    print(
        f"  {s['high_attention']} high attention · {s['medium_attention']} medium · "
        f"{s['low_attention']} minor"
    )
    if result.warnings:
        print()
        for w in result.warnings:
            print(f"  ! {w}")

    print()
    for change in result.changes:
        if not args.all and change.importance.value == "LOW":
            continue
        print(f"{_BADGE[change.importance.value]} {change.category.value:<16} {change.summary}")
        if change.citation_a:
            print(f"         A  {change.citation_a.section} · p{change.citation_a.page}")
        if change.citation_b:
            print(f"         B  {change.citation_b.section} · p{change.citation_b.page}")
        print(f"         {change.confidence_label} · {', '.join(change.detectors)}")
        print()

    hidden = sum(1 for c in result.changes if c.importance.value == "LOW")
    if hidden and not args.all:
        print(f"{hidden} minor change(s) hidden — pass --all to show them.")

    print(f"\n{result.disclaimer}")

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(result.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"\nwrote {args.json_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
