#!/usr/bin/env python3
"""Detect same-photo derivatives with local perceptual and feature evidence."""

from __future__ import annotations

import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import struct
import sys
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps, __version__ as PILLOW_VERSION


PROVIDER_SCHEMA = "cimmich.asset-similarity-provider.v1"
MAX_PIXELS = 200_000_000
REQUIRED_PILLOW_VERSION = "12.3.0"
REQUIRED_NUMPY_VERSION = "1.26.4"
REQUIRED_OPENCV_VERSION = "4.11.0"


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
    if (
        value.get("execution", {}).get("runtimeId")
        != "python-pillow-12.3.0-opencv-4.11.0-numpy-1.26.4"
    ):
        raise ValueError("asset-similarity runtime identity is invalid")
    if (
        PILLOW_VERSION != REQUIRED_PILLOW_VERSION
        or cv2.__version__ != REQUIRED_OPENCV_VERSION
        or np.__version__ != REQUIRED_NUMPY_VERSION
    ):
        raise ValueError("asset-similarity image runtime does not match")
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


def decoded_image(encoded: bytes) -> tuple[Image.Image, np.ndarray[Any, Any]]:
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with Image.open(BytesIO(encoded)) as source:
        if source.width * source.height > MAX_PIXELS:
            raise ValueError("asset-similarity image exceeds its pixel bound")
        image = ImageOps.exif_transpose(source).convert("RGB")
    gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
    return image, gray


def directional_correspondence(
    left: np.ndarray[Any, Any],
    right: np.ndarray[Any, Any],
) -> tuple[int, int, float]:
    detector = cv2.ORB_create(nfeatures=3000)
    left_points, left_descriptors = detector.detectAndCompute(left, None)
    right_points, right_descriptors = detector.detectAndCompute(right, None)
    if left_descriptors is None or right_descriptors is None:
        return 0, 0, 0
    matches = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
        left_descriptors,
        right_descriptors,
        k=2,
    )
    good = [
        first
        for first, second in matches
        if first.distance < 0.75 * second.distance
    ]
    if len(good) < 4:
        return len(good), 0, 0
    left_xy = np.float32([left_points[item.queryIdx].pt for item in good]).reshape(
        -1, 1, 2
    )
    right_xy = np.float32([right_points[item.trainIdx].pt for item in good]).reshape(
        -1, 1, 2
    )
    _, mask = cv2.findHomography(left_xy, right_xy, cv2.RANSAC, 5.0)
    inliers = int(mask.sum()) if mask is not None else 0
    return len(good), inliers, inliers / len(good)


def directional_scale_invariant_correspondence(
    left: np.ndarray[Any, Any],
    right: np.ndarray[Any, Any],
) -> tuple[int, int, float]:
    detector = cv2.SIFT_create(nfeatures=3000)
    left_points, left_descriptors = detector.detectAndCompute(left, None)
    right_points, right_descriptors = detector.detectAndCompute(right, None)
    if left_descriptors is None or right_descriptors is None:
        return 0, 0, 0
    matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(
        left_descriptors,
        right_descriptors,
        k=2,
    )
    good = [
        first
        for first, second in matches
        if first.distance < 0.75 * second.distance
    ]
    if len(good) < 4:
        return len(good), 0, 0
    left_xy = np.float32([left_points[item.queryIdx].pt for item in good]).reshape(
        -1, 1, 2
    )
    right_xy = np.float32([right_points[item.trainIdx].pt for item in good]).reshape(
        -1, 1, 2
    )
    _, mask = cv2.findHomography(left_xy, right_xy, cv2.RANSAC, 5.0)
    inliers = int(mask.sum()) if mask is not None else 0
    return len(good), inliers, inliers / len(good)


def bounded_correspondence_score(
    good: int,
    inliers: int,
    inlier_ratio: float,
) -> float:
    broad_support = min(good / 30, inliers / 10, inlier_ratio / 0.25)
    return max(0, min(1, broad_support))


def similarity(left: bytes, right: bytes) -> float:
    if left == right:
        return 1.0
    left_image, left_gray = decoded_image(left)
    right_image, right_gray = decoded_image(right)
    distance = bin(difference_hash(left) ^ difference_hash(right)).count("1")
    hash_similarity = 1 - distance / 64
    forward = directional_correspondence(left_gray, right_gray)
    reverse = directional_correspondence(right_gray, left_gray)
    good = min(forward[0], reverse[0])
    inliers = min(forward[1], reverse[1])
    inlier_ratio = min(forward[2], reverse[2])
    broad_support = bounded_correspondence_score(good, inliers, inlier_ratio)
    sift_forward = directional_scale_invariant_correspondence(
        left_gray,
        right_gray,
    )
    sift_reverse = directional_scale_invariant_correspondence(
        right_gray,
        left_gray,
    )
    sift_support = max(
        0,
        min(
            1,
            min(sift_forward[0], sift_reverse[0]) / 60,
            min(sift_forward[1], sift_reverse[1]) / 20,
            min(sift_forward[2], sift_reverse[2]) / 0.25,
        ),
    )
    low_texture_support = min(
        hash_similarity / 0.95,
        good / 10,
        inliers / 5,
    )
    left_image.close()
    right_image.close()
    return round(
        max(broad_support, sift_support, min(1, low_texture_support)),
        6,
    )


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
