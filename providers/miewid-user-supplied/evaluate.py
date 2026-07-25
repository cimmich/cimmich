#!/usr/bin/env python3
"""Evaluate pet re-identification embeddings without exposing source paths."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch


SCHEMA_VERSION = "cimmich.pet-reid-evaluation.v1"


def cosine(left: list[float], right: list[float]) -> float:
    a = torch.tensor(left, dtype=torch.float32)
    b = torch.tensor(right, dtype=torch.float32)
    return float(torch.dot(a, b))


def evaluate(records: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: list[dict[str, Any]] = []
    for left_index, left in enumerate(records):
        for right in records[left_index + 1 :]:
            pairs.append(
                {
                    "left": left["id"],
                    "right": right["id"],
                    "sameIdentity": left["identity"] == right["identity"],
                    "score": round(cosine(left["embedding"], right["embedding"]), 6),
                }
            )

    explicit_gallery = [
        record for record in records if record.get("role") == "gallery"
    ]
    queries = (
        [record for record in records if record.get("role") != "gallery"]
        if explicit_gallery
        else records
    )
    gallery_identities = {record["identity"] for record in explicit_gallery}
    decisions: list[dict[str, Any]] = []
    known_target_scores: list[float] = []
    known_impostor_scores: list[float] = []
    unknown_scores: list[float] = []
    for query in queries:
        query_species = query.get("species")
        candidates = (
            [
                candidate
                for candidate in explicit_gallery
                if query_species in (None, "unknown")
                or candidate.get("species") == query_species
            ]
            if explicit_gallery
            else [
                candidate
                for candidate in records
                if candidate["id"] != query["id"]
                and (
                    query_species in (None, "unknown")
                    or candidate.get("species") == query_species
                )
            ]
        )
        if not candidates:
            raise ValueError(f"query {query['id']} has no same-species candidates")
        ranked = sorted(
            (
                (cosine(query["embedding"], candidate["embedding"]), candidate)
                for candidate in candidates
            ),
            key=lambda item: (-item[0], item[1]["id"]),
        )
        best_score, best = ranked[0]
        second_score = ranked[1][0] if len(ranked) > 1 else None
        expected_known = (
            query["identity"] in gallery_identities
            if explicit_gallery
            else True
        )
        if expected_known:
            known_target_scores.append(
                max(
                    score
                    for score, candidate in ranked
                    if candidate["identity"] == query["identity"]
                )
            )
            known_impostor_scores.extend(
                score
                for score, candidate in ranked
                if candidate["identity"] != query["identity"]
            )
        else:
            unknown_scores.append(best_score)
        decisions.append(
            {
                "correct": (
                    best["identity"] == query["identity"]
                    if expected_known
                    else None
                ),
                "expectedIdentity": (
                    query["identity"] if expected_known else "unknown"
                ),
                "expectedKnown": expected_known,
                "predictedIdentity": best["identity"],
                "query": query["id"],
                "score": round(best_score, 6),
                "topTwoMargin": (
                    round(best_score - second_score, 6)
                    if second_score is not None
                    else None
                ),
            }
        )

    same_scores = [pair["score"] for pair in pairs if pair["sameIdentity"]]
    different_scores = [pair["score"] for pair in pairs if not pair["sameIdentity"]]
    known_decisions = [
        decision for decision in decisions if decision["expectedKnown"]
    ]
    correct = sum(1 for decision in known_decisions if decision["correct"])
    return {
        "decisionCount": len(decisions),
        "differentIdentity": {
            "maximum": max(different_scores) if different_scores else None,
            "minimum": min(different_scores) if different_scores else None,
        },
        "knownQueryAccuracy": (
            round(correct / len(known_decisions), 6)
            if known_decisions
            else None
        ),
        "nearestNeighbour": decisions,
        "openSet": {
            "knownImpostorMaximum": (
                round(max(known_impostor_scores), 6)
                if known_impostor_scores
                else None
            ),
            "knownTargetMinimum": (
                round(min(known_target_scores), 6)
                if known_target_scores
                else None
            ),
            "unknownMaximum": (
                round(max(unknown_scores), 6) if unknown_scores else None
            ),
        },
        "pairCount": len(pairs),
        "pairs": pairs,
        "sameIdentity": {
            "maximum": max(same_scores) if same_scores else None,
            "minimum": min(same_scores) if same_scores else None,
        },
        "schemaVersion": SCHEMA_VERSION,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    payload = json.loads(args.embeddings.read_text(encoding="utf-8"))
    records = payload.get("records")
    if not isinstance(records, list) or len(records) < 2:
        raise ValueError("at least two embedding records are required")
    report = evaluate(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "accuracy": report["knownQueryAccuracy"],
                "decisions": report["decisionCount"],
                "output": str(args.output),
                "status": "complete",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
