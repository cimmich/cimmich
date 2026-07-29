#!/usr/bin/env python3
"""Read framed target metadata and encoded media, then emit InsightFace packets.

The default one-shot protocol remains available for narrow conformance calls.
``--serve`` keeps the verified ONNX sessions resident and accepts a sequence of
length-delimited requests so archive operators do not reload both models for
every asset.
"""

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
from PIL import Image, ImageFile, ImageOps

from provider import (
    UserSuppliedInsightFaceProvider,
    canonical_json,
    failed_packet,
    file_digest,
    public_failure_reason,
    terminal_packet,
    validate_box,
    validate_manifest,
)


def read_exact(length: int) -> bytes:
    value = sys.stdin.buffer.read(length)
    if len(value) != length:
        raise EOFError("recognition input frame is truncated")
    return value


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


def read_service_frame(
    max_metadata_bytes: int, max_input_bytes: int
) -> tuple[dict[str, Any], bytes] | None:
    header = sys.stdin.buffer.read(16)
    if not header:
        return None
    if len(header) != 16:
        raise ValueError("recognition service frame header is truncated")
    metadata_length, input_length = struct.unpack(">QQ", header)
    if metadata_length < 2 or metadata_length > max_metadata_bytes:
        raise ValueError("recognition metadata is oversized")
    if input_length < 1 or input_length > max_input_bytes:
        raise ValueError("source media input is empty or oversized")
    metadata_raw = read_exact(metadata_length)
    encoded = read_exact(input_length)
    return json.loads(metadata_raw.decode("utf-8")), encoded


def decode_image(encoded: bytes) -> np.ndarray:
    try:
        # Some otherwise-decodable archive JPEGs are missing only their final
        # end-of-image marker. Immich can render these and Pillow can recover
        # their complete pixel raster; permit that bounded recovery before
        # failing the observation as unreadable.
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        with Image.open(BytesIO(encoded)) as opened:
            oriented = ImageOps.exif_transpose(opened).convert("RGB")
            image = cv2.cvtColor(np.asarray(oriented), cv2.COLOR_RGB2BGR)
    except (OSError, ValueError):
        image = None
    if image is None:
        raise ValueError("source media is not a readable image")
    return image


def recognize(
    provider: UserSuppliedInsightFaceProvider,
    manifest: dict[str, Any],
    vector_space_id: str,
    config_digest: str,
    metadata: dict[str, Any],
    encoded: bytes,
) -> dict[str, Any]:
    if metadata.get("operation") == "detect":
        image = decode_image(encoded)
        faces = provider.detect_faces(image)
        return {
            "faces": faces,
            "state": "faces_detected" if faces else "no_face",
        }
    requests = metadata.get("requests")
    if not isinstance(requests, list) or not requests or len(requests) > 1000:
        raise ValueError("recognition request list is invalid")
    try:
        image = decode_image(encoded)
    except Exception as error:
        return {
            "packets": [
                failed_packet(
                    request, vector_space_id, config_digest, error
                )
                for request in requests
            ]
        }
    packets = []
    pipeline_version = manifest["preprocessing"]["pipelineVersion"]
    for request in requests:
        try:
            box = validate_box(request.get("targetBox"))
            result = (
                provider.embed_target_centric_v2(image, box)
                if pipeline_version
                == "target-centric-tight-crop+2.4x-source-fallback-v2"
                else provider.embed(image, box)
            )
            packets.append(
                terminal_packet(
                    request, vector_space_id, config_digest, result
                )
            )
        except Exception as error:
            packets.append(
                failed_packet(
                    request, vector_space_id, config_digest, error
                )
            )
    return {"packets": packets}


def write_service_result(result: dict[str, Any]) -> None:
    payload = canonical_json(result).encode("utf-8")
    sys.stdout.buffer.write(struct.pack(">Q", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--detector-model", required=True, type=Path)
    parser.add_argument("--recognizer-model", required=True, type=Path)
    parser.add_argument("--max-metadata-bytes", type=int, default=4 * 1024 * 1024)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    vector_space_id, config_digest = validate_manifest(manifest)
    if file_digest(args.detector_model) != manifest["detector"]["artifactSha256"]:
        raise ValueError("detector artifact digest does not match the manifest")
    if file_digest(args.recognizer_model) != manifest["recognizer"]["artifactSha256"]:
        raise ValueError("recognizer artifact digest does not match the manifest")
    provider = UserSuppliedInsightFaceProvider(
        args.detector_model,
        args.recognizer_model,
        float(manifest["detector"]["scoreThreshold"]),
        int(manifest["execution"]["threads"]),
        str(manifest["execution"]["device"]),
    )
    if args.serve:
        while True:
            frame = read_service_frame(
                args.max_metadata_bytes, args.max_input_bytes
            )
            if frame is None:
                return
            metadata, encoded = frame
            try:
                result = recognize(
                    provider,
                    manifest,
                    vector_space_id,
                    config_digest,
                    metadata,
                    encoded,
                )
            except Exception as error:
                result = {
                    "error": {
                        "code": "PROVIDER_REQUEST_FAILED",
                        "reason": public_failure_reason(error),
                    }
                }
            write_service_result(result)
    metadata, encoded = read_frame(args.max_metadata_bytes, args.max_input_bytes)
    sys.stdout.write(
        canonical_json(
            recognize(
                provider,
                manifest,
                vector_space_id,
                config_digest,
                metadata,
                encoded,
            )
        )
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
