#!/usr/bin/env python3
"""Materialize a private Cimmich manifest for operator-supplied ONNX weights."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile

import insightface
import onnxruntime

from provider import (
    derive_manifest_ids,
    derive_recognition_space_config_digest,
    file_digest,
)


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
    parser.add_argument("--detector-model", required=True, type=Path)
    parser.add_argument("--recognizer-model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--detector-name", required=True)
    parser.add_argument("--recognizer-name", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--score-threshold", type=float, default=0.5)
    parser.add_argument("--model-licence", required=True)
    parser.add_argument("--training-data", required=True)
    parser.add_argument("--recognition-space-model-family")
    parser.add_argument("--recognition-space-model-version")
    parser.add_argument("--pipeline-version", default="target-centric-fixed640-tight-crop+2.4x-source-fallback-v1")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    manifest = {
        "schemaVersion": "cimmich.recognition-provider.v1",
        "detector": {
            "artifactSha256": file_digest(args.detector_model),
            "inputSize": [640, 640],
            "model": args.detector_name,
            "modelVersion": args.model_version,
            "scoreThreshold": args.score_threshold,
        },
        "recognizer": {
            "artifactSha256": file_digest(args.recognizer_model),
            "model": args.recognizer_name,
            "modelVersion": args.model_version,
        },
        "embedding": {"dimension": 512, "metric": "cosine", "normalized": True},
        "preprocessing": {
            "alignment": "insightface-five-point-norm-crop",
            "colorSpace": "bgr-source-rgb-recognizer",
            "inputSize": [112, 112],
            "pipelineVersion": args.pipeline_version,
        },
        "provider": {"name": "insightface-user-supplied-cpu", "version": "1"},
        "execution": {
            "device": "cpu",
            "network": "forbidden",
            "runtime": f"onnxruntime-{onnxruntime.__version__}+insightface-{insightface.__version__}",
            "threads": 1,
        },
        "licensing": {
            "code": "InsightFace Python code MIT",
            "model": f"user-supplied; {args.model_licence}",
            "trainingData": args.training_data,
        },
        "privacy": {"externalUpload": "none", "sourceMedia": "local-read-only"},
    }
    if args.recognition_space_model_family or args.recognition_space_model_version:
        if not args.recognition_space_model_family or not args.recognition_space_model_version:
            raise ValueError("both recognition-space model fields are required")
        manifest["recognitionSpace"] = {
            "detectorInputSize": [640, 640],
            "modelFamily": args.recognition_space_model_family,
            "modelVersion": args.recognition_space_model_version,
            "pipelineVersion": args.pipeline_version,
            "recognitionModelSha256": manifest["recognizer"]["artifactSha256"],
        }
    manifest["vectorSpaceId"], manifest["providerConfigDigest"] = derive_manifest_ids(manifest)
    if manifest.get("recognitionSpace") is not None:
        manifest["recognitionSpaceConfigDigest"] = derive_recognition_space_config_digest(manifest)
    body = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if args.execute:
        atomic_write(args.output, body)
    print(body, end="")


if __name__ == "__main__":
    main()
