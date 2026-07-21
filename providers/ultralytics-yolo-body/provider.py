#!/usr/bin/env python3
"""Execute one local YOLO body detection request and emit the Cimmich result."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any


REQUEST_SCHEMA = "cimmich.ultralytics-yolo-body-request.v1"
RESULT_SCHEMA = "cimmich.body-detection-result.v1"
MAX_INPUT_BYTES = 1024 * 1024
HEX64 = set("0123456789abcdef")
RAW_CONFIDENCE_FLOOR = 0.05
MAX_RAW_DETECTIONS = 100


class ProviderError(Exception):
    pass


def fail(code: str) -> int:
    sys.stderr.write(json.dumps({"error": {"code": code}}, separators=(",", ":")) + "\n")
    return 1


def exact_object(value: Any, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ProviderError(f"{label} fields are invalid")
    return value


def digest_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(char not in HEX64 for char in value):
        raise ProviderError(f"{label} is invalid")
    return value


def canonical_digest(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_request(raw: bytes) -> dict:
    if not raw or len(raw) > MAX_INPUT_BYTES:
        raise ProviderError("request size is invalid")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ProviderError("request JSON is invalid") from error
    exact_object(
        value,
        {
            "assetToken",
            "imagePath",
            "inputRevision",
            "manifestPath",
            "modelPath",
            "schemaVersion",
            "sourceContentDigest",
        },
        "request",
    )
    if value["schemaVersion"] != REQUEST_SCHEMA:
        raise ProviderError("request schema is invalid")
    for field in ("assetToken", "inputRevision", "sourceContentDigest"):
        digest_string(value[field], field)
    for field in ("imagePath", "manifestPath", "modelPath"):
        if not isinstance(value[field], str) or not value[field] or "\x00" in value[field]:
            raise ProviderError(f"{field} is invalid")
    return value


def load_manifest(path: Path, model_path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ProviderError("manifest is unavailable") from error
    expected = set(manifest) - {"detectorConfigDigest"}
    if manifest.get("schemaVersion") != "cimmich.body-detector.v1":
        raise ProviderError("manifest schema is invalid")
    if manifest.get("detectorConfigDigest") != canonical_digest(
        {key: manifest[key] for key in sorted(expected)}
    ):
        raise ProviderError("manifest config digest is invalid")
    if manifest.get("execution", {}).get("network") != "forbidden":
        raise ProviderError("provider network must be forbidden")
    if manifest.get("privacy") != {
        "externalUpload": "none",
        "sourceMedia": "local-read-only",
    }:
        raise ProviderError("provider privacy boundary is invalid")
    if manifest.get("detector", {}).get("artifactDigest") != file_digest(model_path):
        raise ProviderError("model checkpoint does not match the manifest")
    return manifest


def round6(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 6)


def execute(request: dict, model_factory=None) -> dict:
    image_path = Path(request["imagePath"]).resolve()
    model_path = Path(request["modelPath"]).resolve()
    manifest = load_manifest(Path(request["manifestPath"]).resolve(), model_path)
    if not image_path.is_file():
        raise ProviderError("source image is unavailable")
    if file_digest(image_path) != request["sourceContentDigest"]:
        raise ProviderError("source image digest changed")
    if model_factory is None:
        from ultralytics import YOLO

        model_factory = YOLO
    model = model_factory(str(model_path))
    device = manifest["execution"]["device"]
    runtime_device = "mps" if device == "gpu" else device
    results = model.predict(
        str(image_path),
        classes=[0],
        conf=RAW_CONFIDENCE_FLOOR,
        device=runtime_device,
        imgsz=manifest["preprocessing"]["inputWidth"],
        max_det=MAX_RAW_DETECTIONS,
        verbose=False,
    )
    if len(results) != 1:
        raise ProviderError("provider returned an invalid result count")
    result = results[0]
    height, width = result.orig_shape
    bodies = []
    if result.boxes is not None:
        for coords, confidence, class_id in zip(
            result.boxes.xyxy.cpu().tolist(),
            result.boxes.conf.cpu().tolist(),
            result.boxes.cls.cpu().tolist(),
        ):
            if str(result.names[int(class_id)]) != "person":
                continue
            if float(confidence) < manifest["detector"]["scoreThreshold"]:
                continue
            x1, y1, x2, y2 = coords
            bodies.append(
                {
                    "box": {
                        "h": round6((y2 - y1) / height),
                        "w": round6((x2 - x1) / width),
                        "x": round6(x1 / width),
                        "y": round6(y1 / height),
                    },
                    "confidence": round6(confidence),
                }
            )
    bodies.sort(key=lambda row: canonical_digest(row))
    return {
        "assetToken": request["assetToken"],
        "bodies": bodies,
        "detectorConfigDigest": manifest["detectorConfigDigest"],
        "inputRevision": request["inputRevision"],
        "schemaVersion": RESULT_SCHEMA,
        "sourceContentDigest": request["sourceContentDigest"],
        "state": "bodies_detected" if bodies else "no_body",
    }


def main() -> int:
    try:
        request = load_request(sys.stdin.buffer.read(MAX_INPUT_BYTES + 1))
        result = execute(request)
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except Exception:
        return fail("ULTRALYTICS_BODY_PROVIDER_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
