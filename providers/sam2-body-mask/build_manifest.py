#!/usr/bin/env python3
"""Build the local-only SAM2 Body-mask manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


SCHEMA = "cimmich.body-mask-provider.v1"


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
    checkpoint = args.checkpoint.resolve()
    if not checkpoint.is_file():
        raise ValueError("SAM2 checkpoint is unavailable")
    core = {
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
        "mask": {
            "artifactDigest": file_digest(checkpoint),
            "configId": args.config_id,
            "maxSide": args.max_side,
            "modelId": args.model_id,
            "modelVersionId": args.model_version,
            "multiMaskCount": 3,
            "selectionPolicyId": "sam2-bounded-box-v1",
            "thresholds": {
                "expandedFraction": 0.08,
                "rejectMaxAreaRatio": 1.35,
                "rejectMinAreaRatio": 0.05,
                "rejectMinInside": 0.62,
                "validMaxAreaRatio": 0.92,
                "validMinInside": 0.78,
                "validMinScore": 0.35,
            },
        },
        "preprocessing": {
            "colorSpace": "rgb",
            "coordinateSpace": "normalized_image",
            "orientation": "exif_transposed_top_left",
            "promptKind": "body_box",
        },
        "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
        "provider": {"providerId": "sam2-body-mask", "versionId": "v1"},
        "resources": {
            "maxInputBytes": args.max_input_bytes,
            "maxMemoryMiB": args.max_memory_mib,
            "maxOutputBytes": args.max_output_bytes,
            "maxRuntimeMs": args.max_runtime_ms,
        },
        "schemaVersion": SCHEMA,
    }
    return {**core, "maskConfigDigest": digest(core)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--config-id", default="sam2.1-hiera-tiny")
    parser.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--max-memory-mib", type=int, default=16384)
    parser.add_argument("--max-output-bytes", type=int, default=32 * 1024 * 1024)
    parser.add_argument("--max-runtime-ms", type=int, default=300000)
    parser.add_argument("--max-side", type=int, default=1600)
    parser.add_argument("--model-id", default="sam2-hiera-tiny")
    parser.add_argument("--model-rights", choices=("declared", "unknown"), default="unknown")
    parser.add_argument("--model-version", default="2.1")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-id", default="sam2-1.0")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--training-data-rights", choices=("declared", "unknown"), default="unknown")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(build(args), indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
