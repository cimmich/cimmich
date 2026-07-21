#!/usr/bin/env python3
"""Compare two encoded images with a bounded local 64-bit difference hash."""

from __future__ import annotations

import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
from typing import Any

from PIL import Image, ImageOps, __version__ as PILLOW_VERSION


PROVIDER_SCHEMA = "cimmich.asset-similarity-provider.v1"
MAX_PIXELS = 200_000_000
REQUIRED_PILLOW_VERSION = "12.2.0"


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def digest(value: object) -> str:
    payload = value if isinstance(value, str) else canonical_json(value)
    return sha256(payload.encode("utf-8")).hexdigest()


def file_digest(path: Path) -> str:
    hasher = sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def validate_manifest(value: dict[str, Any], script_path: Path) -> None:
    expected_keys = {
        "execution",
        "featureSpaceId",
        "licensing",
        "preprocessing",
        "privacy",
        "provider",
        "providerConfigDigest",
        "resources",
        "schemaVersion",
        "similarity",
    }
    if set(value) != expected_keys or value.get("schemaVersion") != PROVIDER_SCHEMA:
        raise ValueError("asset-similarity manifest is invalid")
    if value.get("execution", {}).get("network") != "forbidden":
        raise ValueError("asset-similarity networking must be forbidden")
    if value.get("execution", {}).get("runtimeId") != "python-pillow-12.2.0":
        raise ValueError("asset-similarity runtime identity is invalid")
    if PILLOW_VERSION != REQUIRED_PILLOW_VERSION:
        raise ValueError("asset-similarity Pillow runtime does not match")
    if value.get("privacy") != {
        "externalUpload": "none",
        "sourceMedia": "local-read-only",
    }:
        raise ValueError("asset-similarity privacy boundary is invalid")
    if value.get("similarity", {}).get("scoreSemantics") != "symmetric_unit_similarity":
        raise ValueError("asset-similarity score semantics are invalid")
    if value.get("similarity", {}).get("artifactDigest") != file_digest(script_path):
        raise ValueError("asset-similarity artifact digest does not match")
    core = {key: child for key, child in value.items() if key not in {"featureSpaceId", "providerConfigDigest"}}
    if value.get("providerConfigDigest") != digest(core):
        raise ValueError("asset-similarity provider config digest does not match")
    feature_core = {
        "preprocessing": value["preprocessing"],
        "similarity": value["similarity"],
    }
    if value.get("featureSpaceId") != f"feature_space_{digest(feature_core)}":
        raise ValueError("asset-similarity feature space does not match")


def read_frame(max_input_bytes: int) -> tuple[bytes, bytes]:
    header = sys.stdin.buffer.read(16)
    if len(header) != 16:
        raise ValueError("asset-similarity input frame is missing")
    left_length, right_length = struct.unpack(">QQ", header)
    if not 1 <= left_length <= max_input_bytes or not 1 <= right_length <= max_input_bytes:
        raise ValueError("asset-similarity input is outside its byte bound")
    left = sys.stdin.buffer.read(left_length)
    right = sys.stdin.buffer.read(right_length)
    if len(left) != left_length or len(right) != right_length:
        raise ValueError("asset-similarity input frame is truncated")
    if sys.stdin.buffer.read(1):
        raise ValueError("asset-similarity input frame has trailing bytes")
    return left, right


def difference_hash(encoded: bytes) -> int:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with Image.open(BytesIO(encoded)) as source:
        if source.width * source.height > MAX_PIXELS:
            raise ValueError("asset-similarity image exceeds its pixel bound")
        image = ImageOps.exif_transpose(source).convert("L").resize(
            (9, 8), Image.Resampling.LANCZOS
        )
        pixels = list(image.get_flattened_data())
    bits = 0
    for y in range(8):
        row_start = y * 9
        for x in range(8):
            bits = (bits << 1) | int(pixels[row_start + x] > pixels[row_start + x + 1])
    return bits


def similarity(left: bytes, right: bytes) -> float:
    distance = bin(difference_hash(left) ^ difference_hash(right)).count("1")
    return round(1 - distance / 64, 6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    args = parser.parse_args()
    if not 1 <= args.max_input_bytes <= 512 * 1024 * 1024:
        raise ValueError("asset-similarity byte limit is invalid")
    script_path = Path(__file__).resolve()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    validate_manifest(manifest, script_path)
    left, right = read_frame(args.max_input_bytes)
    sys.stdout.write(canonical_json({"similarity": similarity(left, right)}))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
