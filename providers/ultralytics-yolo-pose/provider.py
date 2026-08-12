#!/usr/bin/env python3
"""Execute one local YOLO COCO17 pose request over bounded in-memory media."""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
import re
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable


REQUEST_SCHEMA = "cimmich.ultralytics-yolo-pose-request.v2"
RESIDENT_REQUEST_SCHEMA = "cimmich.ultralytics-yolo-pose-resident-request.v2"
RESULT_SCHEMA = "cimmich.body-pose-result.v1"
MAX_HEADER_BYTES = 4096
MAX_RESIDENT_INPUT_BYTES = 128 * 1024 * 1024
MAX_RESIDENT_METADATA_BYTES = 64 * 1024
HEX64 = set("0123456789abcdef")
RAW_CONFIDENCE_FLOOR = 0.05
MAX_RAW_DETECTIONS = 100
MAX_RUNTIME_THREADS = 16
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
    def __init__(self, message: str, code: str = "ULTRALYTICS_POSE_PROVIDER_FAILED"):
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
        {
            "assetToken",
            "inputRevision",
            "presentationRotationQuarterTurns",
            "schemaVersion",
            "sourceContentDigest",
        },
        "request",
    )
    if header["schemaVersion"] != REQUEST_SCHEMA:
        raise ProviderError("request schema is invalid")
    for field in ("assetToken", "inputRevision", "sourceContentDigest"):
        digest_string(header[field], field)
    validate_quarter_turns(header["presentationRotationQuarterTurns"])
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
    bounded_integer(execution["threads"], 1, MAX_RUNTIME_THREADS, "threads")
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


def configure_runtime(manifest: dict, torch_module: Any = None) -> Any:
    runtime_cache = str(Path(tempfile.gettempdir()) / "cimmich-ultralytics-pose")
    os.environ.setdefault("YOLO_CONFIG_DIR", runtime_cache)
    os.environ.setdefault("MPLCONFIGDIR", runtime_cache)
    if torch_module is None:
        import torch as torch_module

    threads = manifest["execution"]["threads"]
    torch_module.set_num_threads(threads)
    try:
        torch_module.set_num_interop_threads(min(threads, 4))
    except RuntimeError:
        pass
    return torch_module


def round6(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 6)


def validate_quarter_turns(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 3:
        raise ProviderError("presentation rotation is invalid")
    return value


def source_point(x: float, y: float, quarter_turns: int) -> tuple[float, float]:
    """Map a point from corrected presentation coordinates back to source."""
    if quarter_turns == 1:
        return y, 1 - x
    if quarter_turns == 2:
        return 1 - x, 1 - y
    if quarter_turns == 3:
        return 1 - y, x
    return x, y


def source_box(box: dict, quarter_turns: int) -> dict:
    x, y, width, height = box["x"], box["y"], box["w"], box["h"]
    if quarter_turns == 1:
        return {"x": y, "y": 1 - x - width, "w": height, "h": width}
    if quarter_turns == 2:
        return {"x": 1 - x - width, "y": 1 - y - height, "w": width, "h": height}
    if quarter_turns == 3:
        return {"x": 1 - y - height, "y": x, "w": height, "h": width}
    return box


def presentation_image(image: Any, quarter_turns: int) -> Any:
    if quarter_turns == 0:
        return image
    try:
        import numpy as np

        return np.rot90(np.asarray(image), k=-quarter_turns).copy()
    except (TypeError, ValueError) as error:
        raise ProviderError(
            "source media is not a readable image",
            "ULTRALYTICS_POSE_SOURCE_UNREADABLE",
        ) from error


def project_result(
    request: dict,
    image: Any,
    manifest: dict,
    model: Any,
) -> dict:
    quarter_turns = validate_quarter_turns(
        request["presentationRotationQuarterTurns"]
    )
    device = manifest["execution"]["device"]
    runtime_device = "mps" if device == "gpu" else device
    with redirect_stdout(sys.stderr):
        results = model.predict(
            presentation_image(image, quarter_turns),
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
        source = source_box(
            {
                "h": (y2 - y1) / height,
                "w": (x2 - x1) / width,
                "x": x1 / width,
                "y": y1 / height,
            },
            quarter_turns,
        )
        left = round6(source["x"])
        top = round6(source["y"])
        box_width = round6(source["w"])
        box_height = round6(source["h"])
        if box_width <= 0 or box_height <= 0:
            continue
        keypoints = []
        for joint, point, score in zip(JOINTS, points[index], point_scores[index]):
            confidence_value = round6(score)
            visible = confidence_value >= manifest["pose"]["keypointThreshold"]
            source_x, source_y = source_point(
                point[0] / width, point[1] / height, quarter_turns
            )
            keypoints.append(
                {
                    "confidence": confidence_value,
                    "joint": joint,
                    "x": round6(source_x) if visible else None,
                    "y": round6(source_y) if visible else None,
                }
            )
        detections.append(
            {
                "box": {
                    "h": box_height,
                    "w": box_width,
                    "x": left,
                    "y": top,
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

def execute(
    request: dict,
    image_bytes: bytes,
    manifest: dict,
    model_path: Path,
    model_factory: Callable | None = None,
    image_decoder: Callable[[bytes], Any] | None = None,
) -> dict:
    if model_factory is None:
        with redirect_stdout(sys.stderr):
            configure_runtime(manifest)
            from ultralytics import YOLO

        model_factory = YOLO
    if image_decoder is None:
        from PIL import Image

        image_decoder = lambda value: Image.open(io.BytesIO(value)).convert("RGB")
    try:
        image = image_decoder(image_bytes)
    except Exception as error:
        raise ProviderError("source image is invalid") from error
    with redirect_stdout(sys.stderr):
        model = model_factory(str(model_path))
    return project_result(request, image, manifest, model)


def load_resident_request(value: Any) -> dict:
    exact_object(
        value,
        {
            "assetToken",
            "inputRevision",
            "presentationRotationQuarterTurns",
            "schemaVersion",
            "sourceContentDigest",
        },
        "resident request",
    )
    if value["schemaVersion"] != RESIDENT_REQUEST_SCHEMA:
        raise ProviderError("resident request schema is invalid")
    for field in ("assetToken", "inputRevision", "sourceContentDigest"):
        digest_string(value[field], field)
    validate_quarter_turns(value["presentationRotationQuarterTurns"])
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

        with Image.open(io.BytesIO(encoded)) as opened:
            return np.asarray(ImageOps.exif_transpose(opened).convert("RGB"))
    except (OSError, ValueError) as error:
        raise ProviderError(
            "resident source media is not a readable image",
            "ULTRALYTICS_POSE_SOURCE_UNREADABLE",
        ) from error


def execute_resident(request: dict, encoded: bytes, manifest: dict, model: Any) -> dict:
    if hashlib.sha256(encoded).hexdigest() != request["sourceContentDigest"]:
        raise ProviderError("resident source media digest changed")
    return project_result(request, decode_resident_image(encoded), manifest, model)


def write_resident_result(value: dict) -> None:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    sys.stdout.buffer.write(struct.pack(">Q", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def serve(manifest_path: Path, model_path: Path) -> int:
    manifest = load_manifest(manifest_path.resolve(), model_path.resolve())
    with redirect_stdout(sys.stderr):
        configure_runtime(manifest)
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
            write_resident_result({"error": {"code": "ULTRALYTICS_POSE_PROVIDER_FAILED"}})


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--model", type=Path)
    args, unknown = parser.parse_known_args()
    if unknown or args.manifest is None or args.model is None:
        return fail("ULTRALYTICS_POSE_PROVIDER_CONFIG_INVALID")
    if args.serve:
        try:
            return serve(args.manifest, args.model)
        except Exception:
            return fail("ULTRALYTICS_POSE_PROVIDER_FAILED")
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
