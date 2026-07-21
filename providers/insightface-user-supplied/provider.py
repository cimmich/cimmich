#!/usr/bin/env python3
"""Offline Cimmich provider for operator-supplied InsightFace ONNX models."""

from __future__ import annotations

import argparse
from io import BytesIO
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from insightface.model_zoo.arcface_onnx import ArcFaceONNX
from insightface.model_zoo.scrfd import SCRFD
from insightface.utils import face_align
from PIL import Image


REQUEST_SCHEMA = "cimmich.recognition-request.v1"
OBSERVATION_SCHEMA = "cimmich.recognition-observation.v1"
PROVIDER_SCHEMA = "cimmich.recognition-provider.v1"
DETECTOR_INPUT_SIZE = (640, 640)


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
    core = {
        "detector": manifest["detector"],
        "embedding": manifest["embedding"],
        "preprocessing": manifest["preprocessing"],
        "provider": manifest["provider"],
        "recognizer": manifest["recognizer"],
    }
    if manifest.get("recognitionSpace") is not None:
        core["recognitionSpace"] = manifest["recognitionSpace"]
    return core


def derive_manifest_ids(manifest: dict[str, Any]) -> tuple[str, str]:
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
    return vector_space_id, config_digest


def derive_recognition_space_config_digest(manifest: dict[str, Any]) -> str:
    declared = manifest.get("recognitionSpace")
    if declared is None:
        return derive_manifest_ids(manifest)[1]
    return digest(
        {
            "det_size": declared["detectorInputSize"],
            "model_family": declared["modelFamily"],
            "model_version": declared["modelVersion"],
            "pipeline": declared["pipelineVersion"],
            "recognition_model_sha256": declared["recognitionModelSha256"],
        }
    )


def validate_manifest(manifest: dict[str, Any]) -> tuple[str, str]:
    if manifest.get("schemaVersion") != PROVIDER_SCHEMA:
        raise ValueError(f"provider schema must be {PROVIDER_SCHEMA}")
    if manifest.get("execution", {}).get("network") != "forbidden":
        raise ValueError("provider network access must be forbidden")
    if manifest.get("execution", {}).get("threads") != 1:
        raise ValueError("user-supplied provider execution.threads must be 1")
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
        raise ValueError("user-supplied provider detector.inputSize must be [640, 640]")
    if manifest.get("embedding", {}).get("dimension") != 512:
        raise ValueError("this provider adapter requires 512-dimensional embeddings")
    if not manifest.get("licensing", {}).get("model", "").startswith("user-supplied"):
        raise ValueError("model licensing must explicitly declare user-supplied status")
    vector_space_id, config_digest = derive_manifest_ids(manifest)
    if manifest.get("vectorSpaceId") != vector_space_id:
        raise ValueError("manifest vectorSpaceId does not match its contents")
    if manifest.get("providerConfigDigest") != config_digest:
        raise ValueError("manifest providerConfigDigest does not match its contents")
    recognition_space = manifest.get("recognitionSpace")
    if recognition_space is not None:
        if set(recognition_space) != {
            "detectorInputSize",
            "modelFamily",
            "modelVersion",
            "pipelineVersion",
            "recognitionModelSha256",
        }:
            raise ValueError("manifest recognitionSpace fields are invalid")
        if recognition_space["detectorInputSize"] != manifest["detector"]["inputSize"]:
            raise ValueError("manifest recognitionSpace detector size conflicts")
        if recognition_space["recognitionModelSha256"] != manifest["recognizer"]["artifactSha256"]:
            raise ValueError("manifest recognitionSpace artifact conflicts")
    recognition_space_digest = derive_recognition_space_config_digest(manifest)
    if recognition_space is not None and manifest.get("recognitionSpaceConfigDigest") != recognition_space_digest:
        raise ValueError("manifest recognitionSpaceConfigDigest does not match its contents")
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
    boxes: np.ndarray | None,
    expected_center: tuple[float, float],
    crop_shape: tuple[int, ...],
    *,
    ambiguity_delta: float = 0.035,
) -> int | None:
    if boxes is None or len(boxes) == 0:
        return None
    diagonal = max(1.0, math.hypot(crop_shape[1], crop_shape[0]))
    scored: list[tuple[float, float, float, int]] = []
    for index, box in enumerate(boxes):
        center = (float((box[0] + box[2]) / 2), float((box[1] + box[3]) / 2))
        distance = math.hypot(center[0] - expected_center[0], center[1] - expected_center[1]) / diagonal
        confidence = float(box[4])
        scored.append((distance - 0.02 * confidence, distance, -confidence, index))
    scored.sort()
    if scored[0][1] > 0.36:
        return None
    if len(scored) > 1 and scored[1][0] - scored[0][0] < ambiguity_delta:
        return None
    return scored[0][3]


def inference_session(path: Path, threads: int) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(
        str(path), sess_options=options, providers=["CPUExecutionProvider"]
    )


class UserSuppliedInsightFaceProvider:
    def __init__(
        self,
        detector_path: Path,
        recognizer_path: Path,
        score_threshold: float,
        threads: int,
    ):
        detector_session = inference_session(detector_path, threads)
        recognizer_session = inference_session(recognizer_path, threads)
        self.detector = SCRFD(model_file=str(detector_path), session=detector_session)
        self.detector.prepare(
            ctx_id=0,
            input_size=DETECTOR_INPUT_SIZE,
            det_thresh=score_threshold,
            nms_thresh=0.4,
        )
        self.recognizer = ArcFaceONNX(
            model_file=str(recognizer_path), session=recognizer_session
        )
        self.recognizer.prepare(ctx_id=0)

    def _embed_crop(
        self,
        crop: np.ndarray,
        expected_center: tuple[float, float],
        *,
        selection: str,
        route: str,
    ):
        if crop.size == 0 or min(crop.shape[:2]) < 8:
            return None
        boxes, landmarks = self.detector.detect(
            crop, input_size=DETECTOR_INPUT_SIZE, max_num=0
        )
        if boxes is None or len(boxes) == 0 or landmarks is None:
            return None
        if selection == "strict":
            selected = select_target_face(boxes, expected_center, crop.shape)
        elif selection == "target_centric_v2":
            diagonal = max(1.0, math.hypot(crop.shape[1], crop.shape[0]))
            selected = max(
                range(len(boxes)),
                key=lambda index: float(boxes[index][4])
                + max(
                    0.0,
                    1.0
                    - math.hypot(
                        float((boxes[index][0] + boxes[index][2]) / 2)
                        - expected_center[0],
                        float((boxes[index][1] + boxes[index][3]) / 2)
                        - expected_center[1],
                    )
                    / diagonal,
                ),
            )
        else:
            raise ValueError("unsupported target selection policy")
        if selected is None:
            return None
        aligned = face_align.norm_crop(
            crop, landmark=landmarks[selected], image_size=112
        )
        feature = self.recognizer.get_feat(aligned).reshape(-1).astype(np.float32)
        norm = float(np.linalg.norm(feature))
        if feature.size != 512 or not math.isfinite(norm) or norm <= 0:
            return None
        vector = (feature / norm).astype("<f4")
        crop_hash = hashlib.sha256()
        crop_hash.update(np.asarray(aligned.shape, dtype="<i4").tobytes())
        crop_hash.update(aligned.tobytes())
        return route, crop_hash.hexdigest(), vector

    def embed(self, image: np.ndarray, box: tuple[float, float, float, float]):
        for factor, route in ((1.0, "tight_target"), (2.4, "expanded_source_fallback")):
            left, top, right, bottom, expected_center = crop_geometry(image.shape, box, factor)
            crop = image[top:bottom, left:right]
            result = self._embed_crop(
                crop,
                expected_center,
                selection="strict",
                route=route,
            )
            if result is not None:
                return result
        return None

    def embed_target_centric_v2(
        self, image: np.ndarray, box: tuple[float, float, float, float]
    ):
        image_height, image_width = image.shape[:2]
        x, y, width, height = box
        x1, y1 = x * image_width, y * image_height
        x2, y2 = (x + width) * image_width, (y + height) * image_height
        pad_x, pad_y = max(1.0, x2 - x1) * 0.22, max(1.0, y2 - y1) * 0.22
        tight_box = (
            max(0, min(image_width - 1, int(round(x1 - pad_x)))),
            max(0, min(image_height - 1, int(round(y1 - pad_y)))),
            max(1, min(image_width, int(round(x2 + pad_x)))),
            max(1, min(image_height, int(round(y2 + pad_y)))),
        )
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        preview = Image.fromarray(rgb).crop(tight_box)
        preview.thumbnail((360, 360), Image.Resampling.LANCZOS)
        encoded = BytesIO()
        preview.save(encoded, "JPEG", quality=92)
        tight = cv2.imdecode(
            np.frombuffer(encoded.getvalue(), dtype=np.uint8), cv2.IMREAD_COLOR
        )
        if tight is not None:
            result = self._embed_crop(
                tight,
                (tight.shape[1] / 2.0, tight.shape[0] / 2.0),
                selection="target_centric_v2",
                route="tight_target",
            )
            if result is not None:
                return result

        center_x, center_y = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        expanded_width = max(1.0, (x2 - x1) * 2.4)
        expanded_height = max(1.0, (y2 - y1) * 2.4)
        expanded_box = (
            max(0, int(round(center_x - expanded_width / 2.0))),
            max(0, int(round(center_y - expanded_height / 2.0))),
            min(image_width, int(round(center_x + expanded_width / 2.0))),
            min(image_height, int(round(center_y + expanded_height / 2.0))),
        )
        left, top, right, bottom = expanded_box
        expanded = image[top:bottom, left:right]
        return self._embed_crop(
            expanded,
            (center_x - left, center_y - top),
            selection="target_centric_v2",
            route="expanded_source_fallback",
        )


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
    return message if message in allowed else "provider-inference-failed"


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
    provider = UserSuppliedInsightFaceProvider(
        args.detector_model,
        args.recognizer_model,
        manifest_score_threshold,
        int(manifest["execution"]["threads"]),
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
            packet = terminal_packet(
                request,
                vector_space_id,
                config_digest,
                provider.embed(image, box),
            )
        except Exception as error:
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
    counts = {
        state: sum(row["state"] == state for row in packets)
        for state in ("embedded", "abstained", "failed")
    }
    print(
        canonical_json(
            {
                "execute": args.execute,
                "requests": len(requests),
                "counts": counts,
                "providerConfigDigest": config_digest,
                "vectorSpaceId": vector_space_id,
            }
        )
    )


if __name__ == "__main__":
    main()
