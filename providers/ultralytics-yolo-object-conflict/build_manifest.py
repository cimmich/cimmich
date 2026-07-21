#!/usr/bin/env python3
"""Build one local-only cat/dog conflict manifest for a YOLO checkpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


SCHEMA = "cimmich.body-object-conflict-provider.v1"


def digest(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def build(args: argparse.Namespace) -> dict:
    artifact = args.model.resolve()
    if not artifact.is_file():
        raise ValueError("Model checkpoint is unavailable")
    core = {
        "detector": {
            "artifactDigest": file_digest(artifact),
            "classes": ["cat", "dog"],
            "modelId": args.model_id,
            "modelVersionId": args.model_version,
            "scoreThreshold": args.threshold,
        },
        "execution": {
            "device": args.device,
            "network": "forbidden",
            "runtimeId": args.runtime_id,
            "threads": args.threads,
        },
        "licensing": {
            "code": "declared",
            "model": args.model_rights,
            "trainingData": args.training_data_rights,
        },
        "preprocessing": {
            "colorSpace": "rgb",
            "coordinateSpace": "normalized_image",
            "inputHeight": args.image_size,
            "inputWidth": args.image_size,
            "resizeMode": "letterbox",
        },
        "privacy": {
            "externalUpload": "none",
            "sourceMedia": "local-read-only",
        },
        "provider": {
            "providerId": "ultralytics-yolo-object-conflict",
            "versionId": "v1",
        },
        "resources": {
            "maxMemoryMiB": args.max_memory_mib,
            "maxRuntimeMs": args.max_runtime_ms,
        },
        "schemaVersion": SCHEMA,
    }
    return {**core, "objectConfigDigest": digest(core)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--max-memory-mib", type=int, default=16384)
    parser.add_argument("--max-runtime-ms", type=int, default=120000)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--model-rights", choices=("declared", "unknown"), default="unknown")
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-id", default="ultralytics-8.4.92")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--threshold", type=float, default=0.25)
    parser.add_argument("--training-data-rights", choices=("declared", "unknown"), default="unknown")
    args = parser.parse_args()
    manifest = build(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
