"""Evaluation harness (TRD §40-43).

Scores the engine against human-labelled document pairs and reports recall, precision,
F1, severity-weighted recall and a per-category breakdown — because an overall 95% can
hide a weak category (TRD §41).

  python -m eval.run_eval                        # all pairs under eval/dataset + fixtures/demo
  python -m eval.run_eval --pair fixtures/demo   # one pair
  python -m eval.run_eval --json report.json --semantic

A dataset pair is a directory containing ground_truth.json plus the two documents.
Unmatched detections are reported separately from false alerts: on a partially-labelled
pair, an unlabelled detection may well be a real change nobody wrote down yet.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine import Importance, Stage, compare_documents

ROOT = Path(__file__).resolve().parent.parent
DATASET_DIRS = [ROOT / "eval" / "dataset", ROOT / "fixtures"]

SEVERITY_WEIGHT = {"CRITICAL": 5, "HIGH": 4, "MEDIUM": 2, "LOW": 1}


@dataclass
class PairScore:
    pair: str
    known: int = 0
    detected: int = 0
    missed: list[dict[str, Any]] = field(default_factory=list)
    unmatched: list[dict[str, Any]] = field(default_factory=list)
    citation_ok: int = 0
    citation_checked: int = 0
    category_ok: int = 0
    weighted_known: float = 0.0
    weighted_detected: float = 0.0
    by_category: dict[str, dict[str, int]] = field(default_factory=dict)
    total_changes: int = 0
    status: str = ""


def find_pairs() -> list[Path]:
    out: list[Path] = []
    for base in DATASET_DIRS:
        if not base.exists():
            continue
        for gt in sorted(base.rglob("ground_truth.json")):
            out.append(gt.parent)
    return out


def score_pair(pair_dir: Path, use_semantic: bool) -> PairScore:
    gt_path = pair_dir / "ground_truth.json"
    spec = json.loads(gt_path.read_text(encoding="utf-8"))
    path_a = pair_dir / spec["version_a"]
    path_b = pair_dir / spec["version_b"]

    result = compare_documents(
        path_a,
        path_b,
        label_a=spec["version_a"],
        label_b=spec["version_b"],
        use_semantic=use_semantic,
    )
    score = PairScore(pair=spec.get("pair", pair_dir.name), status=result.status.value)
    if result.status is Stage.FAILED:
        score.missed = [{"id": c["id"], "note": "comparison failed"} for c in spec["changes"]]
        score.known = len(spec["changes"])
        return score

    score.total_changes = len(result.changes)
    changes = result.changes
    claimed: set[str] = set()

    for record in spec["changes"]:
        category = record.get("category", "?")
        weight = SEVERITY_WEIGHT.get(record.get("importance", "MEDIUM"), 2)
        score.known += 1
        score.weighted_known += weight
        bucket = score.by_category.setdefault(
            category, {"known": 0, "detected": 0, "missed": 0, "wrong_category": 0}
        )
        bucket["known"] += 1

        hit = _find_match(record, changes)
        if hit is None:
            score.missed.append({"id": record["id"], "note": record.get("note", "")})
            bucket["missed"] += 1
            continue

        claimed.add(hit.id)
        score.detected += 1
        score.weighted_detected += weight
        bucket["detected"] += 1

        if category in [c.value for c in hit.categories]:
            score.category_ok += 1
        else:
            bucket["wrong_category"] += 1

        score.citation_checked += 1
        if _citation_supports(record, hit):
            score.citation_ok += 1

    for change in changes:
        if change.id in claimed:
            continue
        if change.importance is Importance.LOW:
            continue  # minor changes are collapsed in the UI and not labelled
        score.unmatched.append(
            {
                "id": change.id,
                "category": change.category.value,
                "importance": change.importance.value,
                "summary": change.summary,
            }
        )
    return score


def _find_match(record: dict[str, Any], changes: list) -> Any:
    """A labelled change is detected when some reported change carries its markers."""
    needles = [str(m).lower() for m in record.get("match", [])]
    expect = record.get("expect", {})
    best = None
    best_rank = -1.0
    for change in changes:
        haystack = " ".join(
            [
                change.summary,
                change.text_a,
                change.text_b,
                json.dumps(change.old_value or {}, ensure_ascii=False),
                json.dumps(change.new_value or {}, ensure_ascii=False),
                change.section_a or "",
                change.section_b or "",
            ]
        ).lower()
        if needles and not all(n in haystack for n in needles):
            continue
        rank = 1.0
        if _values_agree(expect, change):
            rank += 2.0
        if record.get("category") in [c.value for c in change.categories]:
            rank += 1.0
        if change.importance is not Importance.LOW:
            rank += 0.5
        if rank > best_rank:
            best, best_rank = change, rank
    return best


def _values_agree(expect: dict[str, Any], change: Any) -> bool:
    """Check the numeric expectations the label states, when it states any."""
    checks = 0
    passed = 0
    for key, field_ in (("old", "old_value"), ("new", "new_value")):
        if key not in expect:
            continue
        checks += 1
        holder = getattr(change, field_) or {}
        if _same_number(expect[key], holder.get("value")):
            passed += 1
    for key, path in (("absolute", "absolute"), ("percentage", "percentage"),
                      ("days", "days"), ("percentage_points", "percentage_points")):
        if key not in expect:
            continue
        checks += 1
        if _same_number(expect[key], (change.delta or {}).get(path)):
            passed += 1
    return checks > 0 and passed == checks


def _same_number(expected: Any, actual: Any) -> bool:
    try:
        return abs(float(expected) - float(actual)) < 0.01
    except (TypeError, ValueError):
        return str(expected).lower() == str(actual).lower()


def _citation_supports(record: dict[str, Any], change: Any) -> bool:
    """Citation accuracy: the cited text must actually contain the labelled marker."""
    needles = [str(m).lower() for m in record.get("match", [])]
    if not needles:
        return True
    cited = " ".join(
        [
            change.citation_a.text if change.citation_a else "",
            change.citation_b.text if change.citation_b else "",
            change.text_a,
            change.text_b,
        ]
    ).lower()
    return any(n in cited for n in needles)


def aggregate(scores: list[PairScore]) -> dict[str, Any]:
    known = sum(s.known for s in scores)
    detected = sum(s.detected for s in scores)
    missed = sum(len(s.missed) for s in scores)
    unmatched = sum(len(s.unmatched) for s in scores)
    weighted_known = sum(s.weighted_known for s in scores)
    weighted_detected = sum(s.weighted_detected for s in scores)
    citation_ok = sum(s.citation_ok for s in scores)
    citation_checked = sum(s.citation_checked for s in scores)
    category_ok = sum(s.category_ok for s in scores)

    recall = detected / known if known else 0.0
    precision = detected / (detected + unmatched) if (detected + unmatched) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    by_category: dict[str, dict[str, int]] = {}
    for s in scores:
        for cat, row in s.by_category.items():
            target = by_category.setdefault(
                cat, {"known": 0, "detected": 0, "missed": 0, "wrong_category": 0}
            )
            for key, value in row.items():
                target[key] += value

    return {
        "pairs": len(scores),
        "known_changes": known,
        "detected": detected,
        "missed": missed,
        "unmatched_detections": unmatched,
        "recall": round(recall, 4),
        "precision_vs_labels": round(precision, 4),
        "f1": round(f1, 4),
        "severity_weighted_recall": round(
            weighted_detected / weighted_known if weighted_known else 0.0, 4
        ),
        "citation_accuracy": round(citation_ok / citation_checked if citation_checked else 0.0, 4),
        "category_accuracy": round(category_ok / detected if detected else 0.0, 4),
        "by_category": by_category,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the VersionLens evaluation suite.")
    parser.add_argument("--pair", help="a single dataset directory")
    parser.add_argument("--semantic", action="store_true", help="include the LLM layer")
    parser.add_argument("--json", dest="json_out")
    parser.add_argument("--min-recall", type=float, default=0.0,
                        help="exit non-zero below this recall (for CI)")
    args = parser.parse_args(argv)

    pairs = [Path(args.pair)] if args.pair else find_pairs()
    if not pairs:
        print("No labelled pairs found. Run: python -m fixtures.make_demo")
        return 1

    scores = [score_pair(p, args.semantic) for p in pairs]
    report = aggregate(scores)

    print(f"\nEvaluation — {report['pairs']} pair(s), "
          f"{'with' if args.semantic else 'without'} semantic layer\n")
    print(f"  Known changes              {report['known_changes']}")
    print(f"  Detected                   {report['detected']}")
    print(f"  Missed                     {report['missed']}")
    print(f"  Unmatched detections       {report['unmatched_detections']}")
    print(f"  Recall                     {report['recall']:.1%}")
    print(f"  Precision (vs labels)      {report['precision_vs_labels']:.1%}")
    print(f"  F1                         {report['f1']:.1%}")
    print(f"  Severity-weighted recall   {report['severity_weighted_recall']:.1%}")
    print(f"  Citation accuracy          {report['citation_accuracy']:.1%}")
    print(f"  Category accuracy          {report['category_accuracy']:.1%}")

    print(f"\n  {'Category':<20}{'Known':>7}{'Found':>7}{'Missed':>8}{'WrongCat':>10}")
    for cat, row in sorted(report["by_category"].items()):
        print(f"  {cat:<20}{row['known']:>7}{row['detected']:>7}"
              f"{row['missed']:>8}{row['wrong_category']:>10}")

    for s in scores:
        if s.missed:
            print(f"\n  MISSED in {s.pair}:")
            for m in s.missed:
                print(f"    - {m['id']}: {m['note']}")
        if s.unmatched:
            print(f"\n  UNMATCHED detections in {s.pair} "
                  f"(review: unlabelled real change, or false alert):")
            for u in s.unmatched:
                print(f"    ? {u['importance']:<7}{u['category']:<18}{u['summary'][:90]}")

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps(
                {"summary": report, "pairs": [s.__dict__ for s in scores]},
                indent=2,
                ensure_ascii=False,
                default=str,
            ),
            encoding="utf-8",
        )
        print(f"\nwrote {args.json_out}")

    if args.min_recall and report["recall"] < args.min_recall:
        print(f"\nFAIL: recall {report['recall']:.1%} below required {args.min_recall:.1%}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
