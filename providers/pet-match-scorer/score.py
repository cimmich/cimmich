#!/usr/bin/env python3
"""Turn local Pet embeddings into bounded, review-only Cimmich proposals."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


QUERY_SCHEMA = "cimmich.pet-match-query.v1"
IMPORT_SCHEMA = "cimmich.pet-matching.v1"
LANES = {"face", "whole_animal"}


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("embedding dimensions do not match")
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm <= 0 or right_norm <= 0:
        raise ValueError("embeddings must have non-zero length")
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def bounded_number(value: Any, label: str, minimum: float, maximum: float) -> float:
    number = float(value)
    if not math.isfinite(number) or number < minimum or number > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return number


def build_packet(embedding_payload: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    if plan.get("schemaVersion") != QUERY_SCHEMA:
        raise ValueError(f"plan schemaVersion must be {QUERY_SCHEMA}")
    lane = str(plan.get("lane", ""))
    if lane not in LANES:
        raise ValueError("lane must be face or whole_animal")
    species_kind = str(plan.get("speciesKind", ""))
    if not species_kind:
        raise ValueError("speciesKind is required")
    candidate_floor = bounded_number(plan.get("candidateFloor"), "candidateFloor", -1, 1)
    max_candidates = int(plan.get("maxCandidates", 5))
    if max_candidates < 1 or max_candidates > 5:
        raise ValueError("maxCandidates must be between 1 and 5")
    records = embedding_payload.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("embedding result must contain records")

    galleries: dict[tuple[str, str], list[list[float]]] = {}
    queries_by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        record_id = str(record.get("id", ""))
        role = str(record.get("role", ""))
        species = str(record.get("species", ""))
        identity = str(record.get("identity", ""))
        embedding = record.get("embedding")
        if not record_id or not species or not isinstance(embedding, list):
            raise ValueError("each embedding record needs id, species, and embedding")
        if species != species_kind:
            raise ValueError("one run must use exactly one species and vector space")
        vector = [float(value) for value in embedding]
        if not all(math.isfinite(value) for value in vector):
            raise ValueError(f"record {record_id} embedding is invalid")
        if role == "gallery":
            if not identity:
                raise ValueError(f"gallery record {record_id} needs a Pet identity")
            galleries.setdefault((species, identity), []).append(vector)
        elif role == "query":
            if record_id in queries_by_id:
                raise ValueError("query record IDs must be unique")
            queries_by_id[record_id] = {
                "embedding": vector,
                "embeddingDigest": canonical_digest(vector),
                "species": species,
            }
        else:
            raise ValueError(f"record {record_id} role must be gallery or query")

    query_metadata = plan.get("queries")
    if not isinstance(query_metadata, list) or not query_metadata:
        raise ValueError("plan queries must be a non-empty array")
    observations = []
    for item in query_metadata:
        query_id = str(item.get("id", ""))
        query = queries_by_id.get(query_id)
        if query is None:
            raise ValueError(f"query {query_id} has no embedding")
        box = item.get("box")
        if not isinstance(box, dict):
            raise ValueError(f"query {query_id} box is required")
        normalized_box = {
            key: bounded_number(box.get(key), f"query {query_id} box.{key}", 0, 1)
            for key in ("x", "y", "w", "h")
        }
        if (
            normalized_box["w"] <= 0
            or normalized_box["h"] <= 0
            or normalized_box["x"] + normalized_box["w"] > 1
            or normalized_box["y"] + normalized_box["h"] > 1
        ):
            raise ValueError(f"query {query_id} box must fit inside the image")
        candidates = []
        for (species, pet_id), gallery in galleries.items():
            if species != query["species"]:
                continue
            # A Pet can look radically different by angle, age, coat, and crop.
            # The closest confirmed image is the useful evidence; galleryCount
            # remains visible so the user can judge how much support existed.
            score = max(cosine(query["embedding"], reference) for reference in gallery)
            if score >= candidate_floor:
                candidates.append(
                    {
                        "galleryCount": len(gallery),
                        "petId": pet_id,
                        "score": round(max(-1.0, min(1.0, score)), 8),
                    }
                )
        candidates.sort(key=lambda candidate: (-candidate["score"], candidate["petId"]))
        observations.append(
            {
                "assetId": str(item.get("assetId", "")),
                "box": normalized_box,
                "candidates": candidates[:max_candidates],
                "detectionConfidence": bounded_number(
                    item.get("detectionConfidence"),
                    f"query {query_id} detectionConfidence",
                    0,
                    1,
                ),
                "embeddingDigest": query["embeddingDigest"],
                "observationId": query_id,
                "speciesKind": query["species"],
            }
        )

    provider = plan.get("provider")
    if not isinstance(provider, dict):
        raise ValueError("plan provider is required")
    config = {
        "candidateFloor": candidate_floor,
        "lane": lane,
        "maxCandidates": max_candidates,
        "modelFamily": str(provider.get("modelFamily", "")),
        "modelVersion": str(provider.get("modelVersion", "")),
        "providerId": str(provider.get("providerId", "")),
        "speciesKind": species_kind,
        "vectorSpaceId": str(provider.get("vectorSpaceId", "")),
    }
    if not all(config[key] for key in ("modelFamily", "modelVersion", "providerId", "vectorSpaceId")):
        raise ValueError("provider identifiers are required")
    return {
        "observations": observations,
        "provider": {
            **{key: config[key] for key in ("lane", "modelFamily", "modelVersion", "providerId", "speciesKind", "vectorSpaceId")},
            "configDigest": canonical_digest(config),
        },
        "runId": str(plan.get("runId", "")),
        "schemaVersion": IMPORT_SCHEMA,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embeddings", required=True, type=Path)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    packet = build_packet(load_json(args.embeddings), load_json(args.plan))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(packet, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "observations": len(packet["observations"]),
                "output": str(args.output),
                "status": "complete",
                "unknown": sum(
                    not observation["candidates"]
                    for observation in packet["observations"]
                ),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
