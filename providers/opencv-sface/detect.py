#!/usr/bin/env python3
"""Read one encoded image from stdin and emit identity-free YuNet detections."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any

import cv2
import numpy as np

from provider import (
    canonical_json,
    digest,
    file_digest,
    normalized_detection_observations,
)


SCHEMA = "cimmich.face-detector.v1"


def validate_detector_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schemaVersion") != SCHEMA:
        raise ValueError(f"detector schema must be {SCHEMA}")
    if manifest.get("execution", {}).get("network") != "forbidden":
        raise ValueError("detector network access must be forbidden")
    if manifest.get("execution", {}).get("threads") != 1:
        raise ValueError("reference detector execution.threads must be 1")
    if manifest.get("privacy") != {
        "externalUpload": "none",
        "sourceMedia": "local-read-only",
    }:
        raise ValueError("detector privacy boundary is not local-read-only")
    threshold = manifest.get("detector", {}).get("scoreThreshold")
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or not 0 < float(threshold) <= 1
    ):
        raise ValueError("detector scoreThreshold must be in (0, 1]")
    core = {
        key: manifest[key]
        for key in ("detector", "execution", "preprocessing", "privacy", "provider")
    }
    if manifest.get("detectorConfigDigest") != digest(core):
        raise ValueError("detector config digest does not match its contents")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--detector-model", required=True, type=Path)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    args = parser.parse_args()

    if args.max_input_bytes < 1024 * 1024 or args.max_input_bytes > 1024 * 1024 * 1024:
        raise ValueError("max input bytes must be between 1 MiB and 1 GiB")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    validate_detector_manifest(manifest)
    if file_digest(args.detector_model) != manifest["detector"]["artifactSha256"]:
        raise ValueError("detector artifact digest does not match the manifest")
    encoded = sys.stdin.buffer.read(args.max_input_bytes + 1)
    if not encoded or len(encoded) > args.max_input_bytes:
        raise ValueError("source media input is empty or oversized")
    image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("source media is not a readable image")

    cv2.setNumThreads(int(manifest["execution"]["threads"]))
    cv2.setRNGSeed(0)
    detector = cv2.FaceDetectorYN_create(
        str(args.detector_model),
        "",
        (image.shape[1], image.shape[0]),
        float(manifest["detector"]["scoreThreshold"]),
        0.3,
        5000,
    )
    _, faces = detector.detect(image)
    observations = normalized_detection_observations(faces, image.shape)
    sys.stdout.write(
        canonical_json(
            {
                "faces": observations,
                "state": "faces_detected" if observations else "no_face",
            }
        )
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
