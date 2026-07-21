#!/usr/bin/env python3
"""Read framed target metadata and encoded media, then emit InsightFace packets."""

from __future__ import annotations

import argparse
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps

from provider import (
    UserSuppliedInsightFaceProvider,
    canonical_json,
    file_digest,
    terminal_packet,
    validate_box,
    validate_manifest,
)


def read_frame(max_metadata_bytes: int, max_input_bytes: int) -> tuple[dict[str, Any], bytes]:
    header = sys.stdin.buffer.read(8)
    if len(header) != 8:
        raise ValueError("recognition input frame is missing")
    metadata_length = struct.unpack(">Q", header)[0]
    if metadata_length < 2 or metadata_length > max_metadata_bytes:
        raise ValueError("recognition metadata is oversized")
    metadata_raw = sys.stdin.buffer.read(metadata_length)
    if len(metadata_raw) != metadata_length:
        raise ValueError("recognition metadata frame is truncated")
    encoded = sys.stdin.buffer.read(max_input_bytes + 1)
    if not encoded or len(encoded) > max_input_bytes:
        raise ValueError("source media input is empty or oversized")
    return json.loads(metadata_raw.decode("utf-8")), encoded


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--detector-model", required=True, type=Path)
    parser.add_argument("--recognizer-model", required=True, type=Path)
    parser.add_argument("--max-metadata-bytes", type=int, default=4 * 1024 * 1024)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    vector_space_id, config_digest = validate_manifest(manifest)
    if file_digest(args.detector_model) != manifest["detector"]["artifactSha256"]:
        raise ValueError("detector artifact digest does not match the manifest")
    if file_digest(args.recognizer_model) != manifest["recognizer"]["artifactSha256"]:
        raise ValueError("recognizer artifact digest does not match the manifest")
    metadata, encoded = read_frame(args.max_metadata_bytes, args.max_input_bytes)
    try:
        with Image.open(BytesIO(encoded)) as opened:
            oriented = ImageOps.exif_transpose(opened).convert("RGB")
            image = cv2.cvtColor(np.asarray(oriented), cv2.COLOR_RGB2BGR)
    except (OSError, ValueError):
        image = None
    if image is None:
        raise ValueError("source media is not a readable image")
    requests = metadata.get("requests")
    if not isinstance(requests, list) or not requests or len(requests) > 1000:
        raise ValueError("recognition request list is invalid")

    provider = UserSuppliedInsightFaceProvider(
        args.detector_model,
        args.recognizer_model,
        float(manifest["detector"]["scoreThreshold"]),
        int(manifest["execution"]["threads"]),
    )
    packets = []
    pipeline_version = manifest["preprocessing"]["pipelineVersion"]
    for request in requests:
        box = validate_box(request.get("targetBox"))
        result = (
            provider.embed_target_centric_v2(image, box)
            if pipeline_version
            == "target-centric-tight-crop+2.4x-source-fallback-v2"
            else provider.embed(image, box)
        )
        packets.append(terminal_packet(request, vector_space_id, config_digest, result))
    sys.stdout.write(canonical_json({"packets": packets}))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
