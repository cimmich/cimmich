#!/usr/bin/env python3
"""Execute one local YOLO body detection request and emit the Cimmich result."""

from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
import struct
import sys
from pathlib import Path
from typing import Any


REQUEST_SCHEMA = "cimmich.ultralytics-yolo-body-request.v1"
RESIDENT_REQUEST_SCHEMA = "cimmich.ultralytics-yolo-body-resident-request.v1"
RESULT_SCHEMA = "cimmich.body-detection-result.v1"
MAX_INPUT_BYTES = 1024 * 1024
MAX_RESIDENT_INPUT_BYTES = 128 * 1024 * 1024
MAX_RESIDENT_METADATA_BYTES = 64 * 1024
HEX64 = set("0123456789abcdef")
RAW_CONFIDENCE_FLOOR = 0.05
MAX_RAW_DETECTIONS = 100


class ProviderError(Exception):
    def __init__(self, message: str, code: str = "ULTRALYTICS_BODY_PROVIDER_FAILED"):
        super().__init__(message)
        self.code = code


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


def project_result(request: dict, manifest: dict, model: Any, image_input: Any) -> dict:
    device = manifest["execution"]["device"]
    runtime_device = "mps" if device == "gpu" else device
    results = model.predict(
        image_input,
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
    return project_result(request, manifest, model, str(image_path))


def load_resident_request(value: Any) -> dict:
    exact_object(
        value,
        {
            "assetToken",
            "inputRevision",
            "schemaVersion",
            "sourceContentDigest",
        },
        "resident request",
    )
    if value["schemaVersion"] != RESIDENT_REQUEST_SCHEMA:
        raise ProviderError("resident request schema is invalid")
    for field in ("assetToken", "inputRevision", "sourceContentDigest"):
        digest_string(value[field], field)
    return value


def read_exact(length: int) -> bytes:
    value = sys.stdin.buffer.read(length)
    if len(value) != length:
        raise EOFError("resident request frame is truncated")
    return value


def read_resident_frame() -> tuple[dict, bytes] | None:
    header = sys.stdin.buffer.read(16)
    if not header:
        return None
    if len(header) != 16:
        raise ProviderError("resident request header is invalid")
    metadata_length, input_length = struct.unpack(">QQ", header)
    if metadata_length < 2 or metadata_length > MAX_RESIDENT_METADATA_BYTES:
        raise ProviderError("resident request metadata is oversized")
    if input_length < 1 or input_length > MAX_RESIDENT_INPUT_BYTES:
        raise ProviderError("resident source media is oversized")
    try:
        metadata = json.loads(read_exact(metadata_length))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("resident request JSON is invalid") from error
    return load_resident_request(metadata), read_exact(input_length)


def decode_resident_image(encoded: bytes) -> Any:
    try:
        import numpy as np
        from PIL import Image, ImageOps

        with Image.open(BytesIO(encoded)) as opened:
            return np.asarray(ImageOps.exif_transpose(opened).convert("RGB"))
    except (OSError, ValueError) as error:
        raise ProviderError(
            "resident source media is not a readable image",
            "ULTRALYTICS_BODY_SOURCE_UNREADABLE",
        ) from error


def execute_resident(request: dict, encoded: bytes, manifest: dict, model: Any) -> dict:
    if hashlib.sha256(encoded).hexdigest() != request["sourceContentDigest"]:
        raise ProviderError("resident source media digest changed")
    return project_result(request, manifest, model, decode_resident_image(encoded))


def write_resident_result(value: dict) -> None:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    sys.stdout.buffer.write(struct.pack(">Q", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def serve(manifest_path: Path, model_path: Path) -> int:
    manifest = load_manifest(manifest_path.resolve(), model_path.resolve())
    from ultralytics import YOLO

    model = YOLO(str(model_path.resolve()))
    while True:
        try:
            frame = read_resident_frame()
            if frame is None:
                return 0
            request, encoded = frame
            write_resident_result(execute_resident(request, encoded, manifest, model))
        except ProviderError as error:
            write_resident_result({"error": {"code": error.code}})
        except Exception:
            write_resident_result({"error": {"code": "ULTRALYTICS_BODY_PROVIDER_FAILED"}})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--model", type=Path)
    args, unknown = parser.parse_known_args()
    if unknown:
        return fail("ULTRALYTICS_BODY_PROVIDER_FAILED")
    if args.serve:
        if args.manifest is None or args.model is None:
            return fail("ULTRALYTICS_BODY_PROVIDER_FAILED")
        try:
            return serve(args.manifest, args.model)
        except Exception:
            return fail("ULTRALYTICS_BODY_PROVIDER_FAILED")
    try:
        request = load_request(sys.stdin.buffer.read(MAX_INPUT_BYTES + 1))
        result = execute(request)
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except Exception:
        return fail("ULTRALYTICS_BODY_PROVIDER_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
