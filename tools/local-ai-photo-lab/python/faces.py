#!/usr/bin/env python3
"""Run local SCRFD face detection for the standalone Cimmich photo lab."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import sys

import cv2
import numpy as np
import onnxruntime as ort
from insightface.model_zoo.scrfd import SCRFD
from PIL import Image, ImageOps


SCHEMA = "cimmich.local-ai-face-scan.v1"


def sha256_file(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def canonical_digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def fail(message: str, code: str = "LOCAL_AI_FACE_PROVIDER_FAILED") -> None:
    sys.stderr.write(json.dumps({"error": {"code": code, "message": message}}) + "\n")
    raise SystemExit(1)


def session(path: Path, device: str) -> ort.InferenceSession:
    providers = ["CPUExecutionProvider"]
    if device == "coreml":
        if "CoreMLExecutionProvider" not in ort.get_available_providers():
            fail("CoreMLExecutionProvider is unavailable", "LOCAL_AI_FACE_DEVICE_UNAVAILABLE")
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return ort.InferenceSession(str(path), sess_options=options, providers=providers)


def main() -> None:
    try:
        request = json.load(sys.stdin)
        expected = {
            "assetToken",
            "device",
            "imagePath",
            "maxInputPixels",
            "modelPath",
            "scoreThreshold",
            "sourceContentDigest",
        }
        if not isinstance(request, dict) or set(request) != expected:
            fail("request fields are invalid")
        image_path = Path(request["imagePath"]).resolve(strict=True)
        model_path = Path(request["modelPath"]).resolve(strict=True)
        if sha256_file(image_path) != request["sourceContentDigest"]:
            fail("source image digest changed", "LOCAL_AI_SOURCE_CHANGED")
        threshold = float(request["scoreThreshold"])
        if not math.isfinite(threshold) or not 0 < threshold <= 1:
            fail("score threshold is invalid")
        with Image.open(image_path) as opened:
            image = np.asarray(ImageOps.exif_transpose(opened).convert("RGB"))
        height, width = image.shape[:2]
        if width * height > int(request["maxInputPixels"]):
            fail("source image exceeds the pixel limit", "LOCAL_AI_INPUT_TOO_LARGE")
        bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
        detector = SCRFD(model_file=str(model_path), session=session(model_path, request["device"]))
        detector.prepare(ctx_id=0, input_size=(640, 640), det_thresh=threshold, nms_thresh=0.4)
        boxes, landmarks = detector.detect(bgr, input_size=(640, 640), max_num=0)
        model_digest = sha256_file(model_path)
        config_digest = canonical_digest(
            {
                "device": request["device"],
                "inputSize": [640, 640],
                "modelDigest": model_digest,
                "provider": "insightface-scrfd-local-photo-lab",
                "scoreThreshold": threshold,
            }
        )
        faces = []
        if boxes is not None:
            for index, raw in enumerate(boxes):
                left = max(0.0, min(float(width), float(raw[0])))
                top = max(0.0, min(float(height), float(raw[1])))
                right = max(left, min(float(width), float(raw[2])))
                bottom = max(top, min(float(height), float(raw[3])))
                if right - left < 1 or bottom - top < 1:
                    continue
                box = {
                    "h": round((bottom - top) / height, 6),
                    "w": round((right - left) / width, 6),
                    "x": round(left / width, 6),
                    "y": round(top / height, 6),
                }
                pixel_width = round(right - left)
                pixel_height = round(bottom - top)
                confidence = round(float(raw[4]), 6)
                review_reasons = []
                if confidence < 0.5:
                    review_reasons.append("LOW_CONFIDENCE")
                if pixel_width < 32 or pixel_height < 32:
                    review_reasons.append("TINY_FACE")
                landmark_digest = None
                if landmarks is not None and index < len(landmarks):
                    normalized = np.asarray(landmarks[index], dtype="<f4").copy()
                    normalized[:, 0] /= max(1, width)
                    normalized[:, 1] /= max(1, height)
                    landmark_digest = hashlib.sha256(normalized.tobytes()).hexdigest()
                faces.append(
                    {
                        "box": box,
                        "confidence": confidence,
                        "faceId": "face_" + canonical_digest(
                            {
                                "assetToken": request["assetToken"],
                                "box": box,
                                "configDigest": config_digest,
                            }
                        )[:40],
                        "landmarkDigest": landmark_digest,
                        "quality": {
                            "pixelHeight": pixel_height,
                            "pixelWidth": pixel_width,
                            "reviewReasons": review_reasons,
                        },
                    }
                )
        faces.sort(key=lambda face: (face["box"]["y"], face["box"]["x"], face["faceId"]))
        print(
            json.dumps(
                {
                    "assetToken": request["assetToken"],
                    "faces": faces,
                    "image": {"height": height, "width": width},
                    "provider": {
                        "activationAuthority": "none",
                        "configDigest": config_digest,
                        "device": request["device"],
                        "modelDigest": model_digest,
                        "network": "forbidden",
                        "providerId": "insightface-scrfd-local-photo-lab",
                    },
                    "schemaVersion": SCHEMA,
                    "sourceContentDigest": request["sourceContentDigest"],
                    "state": "faces_detected" if faces else "no_face",
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
    except SystemExit:
        raise
    except Exception as error:
        fail(type(error).__name__)


if __name__ == "__main__":
    main()
