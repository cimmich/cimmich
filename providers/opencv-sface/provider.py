#!/usr/bin/env python3
"""Offline YuNet + SFace implementation of the Cimmich provider contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any

import cv2
import numpy as np


REQUEST_SCHEMA = "cimmich.recognition-request.v1"
OBSERVATION_SCHEMA = "cimmich.recognition-observation.v1"
PROVIDER_SCHEMA = "cimmich.recognition-provider.v1"
DETECTOR_INPUT_SIZE = (320, 320)


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: Any) -> str:
    text = value if isinstance(value, str) else canonical_json(value)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def normalized_manifest_core(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "detector": manifest["detector"],
        "embedding": manifest["embedding"],
        "preprocessing": manifest["preprocessing"],
        "provider": manifest["provider"],
        "recognizer": manifest["recognizer"],
    }


def validate_manifest(manifest: dict[str, Any]) -> tuple[str, str]:
    if manifest.get("schemaVersion") != PROVIDER_SCHEMA:
        raise ValueError(f"provider schema must be {PROVIDER_SCHEMA}")
    if manifest.get("execution", {}).get("network") != "forbidden":
        raise ValueError("provider network access must be forbidden")
    if manifest.get("execution", {}).get("threads") != 1:
        raise ValueError("reference provider execution.threads must be 1")
    if manifest.get("privacy") != {
        "externalUpload": "none",
        "sourceMedia": "local-read-only",
    }:
        raise ValueError("provider privacy boundary is not local-read-only")
    score_threshold = manifest.get("detector", {}).get("scoreThreshold")
    if (
        isinstance(score_threshold, bool)
        or not isinstance(score_threshold, (int, float))
        or not math.isfinite(float(score_threshold))
        or not 0 < float(score_threshold) <= 1
    ):
        raise ValueError("detector scoreThreshold must be in (0, 1]")
    if manifest.get("detector", {}).get("inputSize") != list(DETECTOR_INPUT_SIZE):
        raise ValueError("reference provider detector.inputSize must be [320, 320]")
    core = normalized_manifest_core(manifest)
    vector_space_id = "vector_space_" + digest(
        {
            "embedding": core["embedding"],
            "preprocessing": core["preprocessing"],
            "recognizer": core["recognizer"],
        }
    )
    config_digest = digest(
        {
            **core,
            "execution": manifest["execution"],
            "licensing": manifest["licensing"],
            "privacy": manifest["privacy"],
        }
    )
    if manifest.get("vectorSpaceId") != vector_space_id:
        raise ValueError("manifest vectorSpaceId does not match its contents")
    if manifest.get("providerConfigDigest") != config_digest:
        raise ValueError("manifest providerConfigDigest does not match its contents")
    return vector_space_id, config_digest


def confined_path(media_root: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = media_root / candidate
    candidate = candidate.resolve(strict=True)
    root = media_root.resolve(strict=True)
    if candidate != root and root not in candidate.parents:
        raise ValueError("sourcePath escapes the configured media root")
    if not candidate.is_file():
        raise ValueError("sourcePath is not a file")
    return candidate


def validate_box(raw: Any) -> tuple[float, float, float, float]:
    if not isinstance(raw, dict) or raw.get("coordinateSpace") != "normalized":
        raise ValueError("targetBox must use normalized coordinates")
    box = tuple(float(raw[key]) for key in ("x", "y", "w", "h"))
    if not all(math.isfinite(value) for value in box):
        raise ValueError("targetBox must be finite")
    x, y, width, height = box
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1 or y + height > 1:
        raise ValueError("targetBox must fit inside the source image")
    return box


def crop_geometry(
    image_shape: tuple[int, ...], box: tuple[float, float, float, float], factor: float
) -> tuple[int, int, int, int, tuple[float, float]]:
    image_height, image_width = image_shape[:2]
    x, y, width, height = box
    center_x = (x + width / 2) * image_width
    center_y = (y + height / 2) * image_height
    crop_width = max(2.0, width * image_width * factor)
    crop_height = max(2.0, height * image_height * factor)
    left = max(0, int(math.floor(center_x - crop_width / 2)))
    top = max(0, int(math.floor(center_y - crop_height / 2)))
    right = min(image_width, int(math.ceil(center_x + crop_width / 2)))
    bottom = min(image_height, int(math.ceil(center_y + crop_height / 2)))
    return left, top, right, bottom, (center_x - left, center_y - top)


def select_target_face(
    faces: np.ndarray | None,
    expected_center: tuple[float, float],
    crop_shape: tuple[int, ...],
    *,
    ambiguity_delta: float = 0.035,
) -> np.ndarray | None:
    if faces is None or len(faces) == 0:
        return None
    diagonal = max(1.0, math.hypot(crop_shape[1], crop_shape[0]))
    scored: list[tuple[float, float, np.ndarray]] = []
    for face in faces:
        center = (float(face[0] + face[2] / 2), float(face[1] + face[3] / 2))
        distance = math.hypot(center[0] - expected_center[0], center[1] - expected_center[1]) / diagonal
        score = distance - 0.02 * float(face[14])
        scored.append((score, distance, face))
    scored.sort(key=lambda row: (row[0], -float(row[2][14])))
    if scored[0][1] > 0.36:
        return None
    if len(scored) > 1 and scored[1][0] - scored[0][0] < ambiguity_delta:
        return None
    return scored[0][2]


def normalized_detection_observations(
    faces: np.ndarray | None, image_shape: tuple[int, ...]
) -> list[dict[str, Any]]:
    image_height, image_width = image_shape[:2]
    if image_height < 1 or image_width < 1:
        raise ValueError("source media is not a readable image")
    observations: list[dict[str, Any]] = []
    if faces is None:
        return observations
    for face in faces:
        x = max(0.0, float(face[0]) / image_width)
        y = max(0.0, float(face[1]) / image_height)
        width = min(1.0 - x, max(0.0, float(face[2]) / image_width))
        height = min(1.0 - y, max(0.0, float(face[3]) / image_height))
        if width <= 0 or height <= 0:
            continue
        landmarks = np.asarray(face[4:14], dtype="<f4")
        observations.append(
            {
                "box": {"x": x, "y": y, "w": width, "h": height},
                "confidence": float(face[14]),
                "landmarkDigest": hashlib.sha256(landmarks.tobytes()).hexdigest(),
                "quality": {"detector": "YuNet"},
            }
        )
    observations.sort(key=lambda row: canonical_json(row))
    return observations


class OpenCvSFaceProvider:
    def __init__(self, detector_path: Path, recognizer_path: Path, score_threshold: float):
        self.detector = cv2.FaceDetectorYN_create(
            str(detector_path), "", DETECTOR_INPUT_SIZE, score_threshold, 0.3, 5000
        )
        self.recognizer = cv2.FaceRecognizerSF_create(str(recognizer_path), "")

    def detect_all(self, image: np.ndarray) -> list[dict[str, Any]]:
        """Return every YuNet face as normalized, identity-free evidence."""
        image_height, image_width = image.shape[:2]
        if image_height < 1 or image_width < 1:
            raise ValueError("source media is not a readable image")
        self.detector.setInputSize((image_width, image_height))
        _, faces = self.detector.detect(image)
        return normalized_detection_observations(faces, image.shape)

    def embed(self, image: np.ndarray, box: tuple[float, float, float, float]):
        for factor, route in ((1.0, "tight_target"), (2.4, "expanded_source_fallback")):
            left, top, right, bottom, expected_center = crop_geometry(image.shape, box, factor)
            crop = image[top:bottom, left:right]
            if crop.size == 0 or min(crop.shape[:2]) < 8:
                continue
            working = cv2.resize(crop, DETECTOR_INPUT_SIZE, interpolation=cv2.INTER_LINEAR)
            self.detector.setInputSize(DETECTOR_INPUT_SIZE)
            scaled_center = (
                expected_center[0] * DETECTOR_INPUT_SIZE[0] / crop.shape[1],
                expected_center[1] * DETECTOR_INPUT_SIZE[1] / crop.shape[0],
            )
            _, faces = self.detector.detect(working)
            selected = select_target_face(faces, scaled_center, working.shape)
            if selected is None:
                continue
            aligned = self.recognizer.alignCrop(working, selected)
            feature = self.recognizer.feature(aligned).reshape(-1).astype(np.float32)
            norm = float(np.linalg.norm(feature))
            if feature.size != 128 or not math.isfinite(norm) or norm <= 0:
                continue
            vector = (feature / norm).astype("<f4")
            crop_hash = hashlib.sha256()
            crop_hash.update(np.asarray(aligned.shape, dtype="<i4").tobytes())
            crop_hash.update(aligned.tobytes())
            return route, crop_hash.hexdigest(), vector
        return None


def terminal_packet(
    request: dict[str, Any], vector_space_id: str, config_digest: str, result: Any
) -> dict[str, Any]:
    common = {
        "schemaVersion": OBSERVATION_SCHEMA,
        "observationId": str(request["observationId"]),
        "assetToken": str(request["assetToken"]),
        "providerConfigDigest": config_digest,
        "vectorSpaceId": vector_space_id,
    }
    if result is None:
        return {
            **common,
            "route": "expanded_source_fallback",
            "state": "abstained",
            "reason": "no-unambiguous-target-face",
        }
    route, crop_digest, vector = result
    return {
        **common,
        "route": route,
        "state": "embedded",
        "cropDigest": crop_digest,
        "vector": [float(value) for value in vector],
        "vectorDigest": hashlib.sha256(vector.tobytes()).hexdigest(),
    }


def public_failure_reason(error: Exception) -> str:
    """Return a stable failure code without exposing a private filesystem path."""
    if isinstance(error, cv2.error):
        return "provider-inference-failed"
    if isinstance(error, OSError):
        return "source-read-failed"
    allowed = {
        "sourcePath escapes the configured media root",
        "sourcePath is not a file",
        "sourceSha256 does not match sourcePath",
        "source media is not a readable image",
        "targetBox must use normalized coordinates",
        "targetBox must be finite",
        "targetBox must fit inside the source image",
    }
    message = str(error)
    return message if message in allowed else "invalid-provider-request"


def atomic_write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--requests", required=True, type=Path)
    parser.add_argument("--packets", required=True, type=Path)
    parser.add_argument("--media-root", required=True, type=Path)
    parser.add_argument("--detector-model", required=True, type=Path)
    parser.add_argument("--recognizer-model", required=True, type=Path)
    parser.add_argument("--score-threshold", type=float)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    vector_space_id, config_digest = validate_manifest(manifest)
    cv2.setNumThreads(int(manifest["execution"]["threads"]))
    cv2.setRNGSeed(0)
    manifest_score_threshold = float(manifest["detector"]["scoreThreshold"])
    if args.score_threshold is not None and not math.isclose(
        args.score_threshold, manifest_score_threshold, rel_tol=0.0, abs_tol=1e-12
    ):
        raise ValueError("score-threshold override does not match the provider manifest")
    if file_digest(args.detector_model) != manifest["detector"]["artifactSha256"]:
        raise ValueError("detector artifact digest does not match the manifest")
    if file_digest(args.recognizer_model) != manifest["recognizer"]["artifactSha256"]:
        raise ValueError("recognizer artifact digest does not match the manifest")
    requests = [
        json.loads(line)
        for line in args.requests.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    provider = OpenCvSFaceProvider(
        args.detector_model, args.recognizer_model, manifest_score_threshold
    )
    packets = []
    cached_source: Path | None = None
    cached_image: np.ndarray | None = None
    for request in requests:
        if request.get("schemaVersion") != REQUEST_SCHEMA:
            raise ValueError(f"request schema must be {REQUEST_SCHEMA}")
        if not str(request.get("observationId", "")).strip() or not str(
            request.get("assetToken", "")
        ).strip():
            raise ValueError("request requires observationId and assetToken")
        try:
            source = confined_path(args.media_root, str(request.get("sourcePath", "")))
            if request.get("sourceSha256") and file_digest(source) != request["sourceSha256"]:
                raise ValueError("sourceSha256 does not match sourcePath")
            box = validate_box(request.get("targetBox"))
            if cached_source == source and cached_image is not None:
                image = cached_image
            else:
                image = cv2.imread(str(source), cv2.IMREAD_COLOR)
                cached_source = source
                cached_image = image
            if image is None:
                raise ValueError("source media is not a readable image")
            result = provider.embed(image, box)
            packet = terminal_packet(request, vector_space_id, config_digest, result)
        except (OSError, ValueError, cv2.error) as error:
            packet = {
                "schemaVersion": OBSERVATION_SCHEMA,
                "observationId": str(request.get("observationId", "invalid")),
                "assetToken": str(request.get("assetToken", "invalid")),
                "providerConfigDigest": config_digest,
                "vectorSpaceId": vector_space_id,
                "route": "not-run",
                "state": "failed",
                "reason": public_failure_reason(error),
            }
        packets.append(packet)

    body = "".join(canonical_json(packet) + "\n" for packet in packets)
    if args.execute:
        atomic_write(args.packets, body)
    counts = {state: sum(row["state"] == state for row in packets) for state in ("embedded", "abstained", "failed")}
    print(canonical_json({"execute": args.execute, "requests": len(requests), "counts": counts, "providerConfigDigest": config_digest, "vectorSpaceId": vector_space_id}))


if __name__ == "__main__":
    main()
