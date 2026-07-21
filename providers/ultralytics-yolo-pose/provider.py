#!/usr/bin/env python3
"""Execute one local YOLO COCO17 pose request over bounded in-memory media."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import struct
import sys
from pathlib import Path
from typing import Any, Callable


REQUEST_SCHEMA = "cimmich.ultralytics-yolo-pose-request.v1"
RESULT_SCHEMA = "cimmich.body-pose-result.v1"
MAX_HEADER_BYTES = 4096
HEX64 = set("0123456789abcdef")
RAW_CONFIDENCE_FLOOR = 0.05
MAX_RAW_DETECTIONS = 100
JOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
MANIFEST_KEYS = {
    "execution", "licensing", "pose", "poseConfigDigest", "preprocessing",
    "privacy", "provider", "resources", "schemaVersion",
}
PUBLIC_ID = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,63})$")


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


def public_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or PUBLIC_ID.fullmatch(value) is None:
        raise ProviderError(f"{label} is invalid")
    return value


def bounded_integer(value: Any, minimum: int, maximum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ProviderError(f"{label} is invalid")
    return value


def unit_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 1:
        raise ProviderError(f"{label} is invalid")
    return float(value)


def canonical_digest(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_packet(raw: bytes, maximum: int) -> tuple[dict, bytes]:
    if len(raw) < 5 or len(raw) > maximum + MAX_HEADER_BYTES + 4:
        raise ProviderError("request size is invalid")
    header_size = struct.unpack(">I", raw[:4])[0]
    if header_size < 2 or header_size > MAX_HEADER_BYTES or len(raw) <= 4 + header_size:
        raise ProviderError("request framing is invalid")
    try:
        header = json.loads(raw[4 : 4 + header_size])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProviderError("request header is invalid") from error
    exact_object(
        header,
        {"assetToken", "inputRevision", "schemaVersion", "sourceContentDigest"},
        "request",
    )
    if header["schemaVersion"] != REQUEST_SCHEMA:
        raise ProviderError("request schema is invalid")
    for field in ("assetToken", "inputRevision", "sourceContentDigest"):
        digest_string(header[field], field)
    image_bytes = raw[4 + header_size :]
    if not image_bytes or len(image_bytes) > maximum:
        raise ProviderError("source image size is invalid")
    if hashlib.sha256(image_bytes).hexdigest() != header["sourceContentDigest"]:
        raise ProviderError("source image digest changed")
    return header, image_bytes


def load_manifest(path: Path, model_path: Path) -> dict:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ProviderError("manifest is unavailable") from error
    exact_object(manifest, MANIFEST_KEYS, "manifest")
    expected = MANIFEST_KEYS - {"poseConfigDigest"}
    if manifest.get("schemaVersion") != "cimmich.body-pose-provider.v1":
        raise ProviderError("manifest schema is invalid")
    execution = exact_object(
        manifest.get("execution"), {"device", "network", "runtimeId", "threads"}, "execution"
    )
    licensing = exact_object(
        manifest.get("licensing"), {"code", "model", "trainingData"}, "licensing"
    )
    pose = exact_object(
        manifest.get("pose"),
        {
            "artifactDigest", "jointSchema", "keypointThreshold", "modelId",
            "modelVersionId", "scoreThreshold", "topologyId",
        },
        "pose",
    )
    preprocessing = exact_object(
        manifest.get("preprocessing"),
        {"colorSpace", "coordinateSpace", "inputHeight", "inputWidth", "resizeMode"},
        "preprocessing",
    )
    privacy = exact_object(
        manifest.get("privacy"), {"externalUpload", "sourceMedia"}, "privacy"
    )
    provider = exact_object(
        manifest.get("provider"), {"providerId", "versionId"}, "provider"
    )
    resources = exact_object(
        manifest.get("resources"), {"maxMemoryMiB", "maxRuntimeMs"}, "resources"
    )
    if manifest.get("poseConfigDigest") != canonical_digest(
        {key: manifest[key] for key in sorted(expected)}
    ):
        raise ProviderError("manifest config digest is invalid")
    if execution["device"] not in {"auto", "cpu", "gpu"} or execution["network"] != "forbidden":
        raise ProviderError("provider network must be forbidden")
    public_id(execution["runtimeId"], "runtimeId")
    bounded_integer(execution["threads"], 1, 64, "threads")
    if licensing["code"] != "declared" or licensing["model"] not in {"declared", "unknown"}:
        raise ProviderError("licensing declaration is invalid")
    if licensing["trainingData"] not in {"declared", "unknown"}:
        raise ProviderError("training-data declaration is invalid")
    if pose["jointSchema"] != "coco17" or pose["topologyId"] != "coco17.v1":
        raise ProviderError("pose topology is invalid")
    digest_string(pose["artifactDigest"], "artifactDigest")
    public_id(pose["modelId"], "modelId")
    public_id(pose["modelVersionId"], "modelVersionId")
    unit_number(pose["keypointThreshold"], "keypointThreshold")
    unit_number(pose["scoreThreshold"], "scoreThreshold")
    if preprocessing["colorSpace"] != "rgb" or preprocessing["coordinateSpace"] != "normalized_image":
        raise ProviderError("preprocessing coordinate contract is invalid")
    if preprocessing["resizeMode"] != "letterbox":
        raise ProviderError("preprocessing resize contract is invalid")
    bounded_integer(preprocessing["inputHeight"], 128, 4096, "inputHeight")
    bounded_integer(preprocessing["inputWidth"], 128, 4096, "inputWidth")
    if privacy != {
        "externalUpload": "none",
        "sourceMedia": "local-read-only",
    }:
        raise ProviderError("provider privacy boundary is invalid")
    if provider != {"providerId": "ultralytics-yolo-pose", "versionId": "v1"}:
        raise ProviderError("provider identity is invalid")
    bounded_integer(resources["maxMemoryMiB"], 64, 65536, "maxMemoryMiB")
    bounded_integer(resources["maxRuntimeMs"], 1000, 600000, "maxRuntimeMs")
    if pose["artifactDigest"] != file_digest(model_path):
        raise ProviderError("pose checkpoint does not match the manifest")
    return manifest


def round6(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 6)


def execute(
    request: dict,
    image_bytes: bytes,
    manifest: dict,
    model_path: Path,
    model_factory: Callable | None = None,
    image_decoder: Callable[[bytes], Any] | None = None,
) -> dict:
    if model_factory is None:
        from ultralytics import YOLO

        model_factory = YOLO
    if image_decoder is None:
        from PIL import Image

        image_decoder = lambda value: Image.open(io.BytesIO(value)).convert("RGB")
    try:
        image = image_decoder(image_bytes)
    except Exception as error:
        raise ProviderError("source image is invalid") from error
    model = model_factory(str(model_path))
    device = manifest["execution"]["device"]
    runtime_device = "mps" if device == "gpu" else device
    results = model.predict(
        image,
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
    if result.keypoints is None or result.keypoints.conf is None:
        raise ProviderError("pose checkpoint returned no COCO17 keypoints")
    height, width = result.orig_shape
    if height <= 0 or width <= 0:
        raise ProviderError("provider image dimensions are invalid")
    boxes = result.boxes.xyxy.cpu().tolist() if result.boxes is not None else []
    confidences = result.boxes.conf.cpu().tolist() if result.boxes is not None else []
    classes = result.boxes.cls.cpu().tolist() if result.boxes is not None else []
    points = result.keypoints.xy.cpu().tolist()
    point_scores = result.keypoints.conf.cpu().tolist()
    if not (
        len(boxes)
        == len(confidences)
        == len(classes)
        == len(points)
        == len(point_scores)
    ):
        raise ProviderError("pose result does not align with its Body boxes")
    detections = []
    for index, (coords, confidence, class_id) in enumerate(zip(boxes, confidences, classes)):
        if str(result.names[int(class_id)]) != "person":
            continue
        if float(confidence) < manifest["pose"]["scoreThreshold"]:
            continue
        if index >= len(points) or index >= len(point_scores):
            raise ProviderError("pose result does not align with its Body boxes")
        if len(points[index]) != len(JOINTS) or len(point_scores[index]) != len(JOINTS):
            raise ProviderError("pose result is not COCO17")
        x1, y1, x2, y2 = coords
        if x2 <= x1 or y2 <= y1:
            raise ProviderError("pose result contains an invalid Body box")
        keypoints = []
        for joint, point, score in zip(JOINTS, points[index], point_scores[index]):
            confidence_value = round6(score)
            visible = confidence_value >= manifest["pose"]["keypointThreshold"]
            keypoints.append(
                {
                    "confidence": confidence_value,
                    "joint": joint,
                    "x": round6(point[0] / width) if visible else None,
                    "y": round6(point[1] / height) if visible else None,
                }
            )
        detections.append(
            {
                "box": {
                    "h": round6((y2 - y1) / height),
                    "w": round6((x2 - x1) / width),
                    "x": round6(x1 / width),
                    "y": round6(y1 / height),
                },
                "confidence": round6(confidence),
                "keypoints": keypoints,
            }
        )
    detections.sort(key=canonical_digest)
    return {
        "assetToken": request["assetToken"],
        "detections": detections,
        "inputRevision": request["inputRevision"],
        "poseConfigDigest": manifest["poseConfigDigest"],
        "schemaVersion": RESULT_SCHEMA,
        "sourceContentDigest": request["sourceContentDigest"],
        "state": "poses_detected" if detections else "no_pose",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    if args.max_input_bytes < 1024 or args.max_input_bytes > 512 * 1024 * 1024:
        return fail("ULTRALYTICS_POSE_PROVIDER_CONFIG_INVALID")
    try:
        model_path = args.model.resolve(strict=True)
        manifest = load_manifest(args.manifest.resolve(strict=True), model_path)
        request, image_bytes = load_packet(
            sys.stdin.buffer.read(args.max_input_bytes + MAX_HEADER_BYTES + 5),
            args.max_input_bytes,
        )
        result = execute(request, image_bytes, manifest, model_path)
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except Exception:
        return fail("ULTRALYTICS_POSE_PROVIDER_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
