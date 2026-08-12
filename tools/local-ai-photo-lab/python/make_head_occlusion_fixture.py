#!/usr/bin/env python3
"""Create the deterministic public three-frame Context benchmark fixture."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def canonical_digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    config = {
        "brightness": {"left": 0.99, "right": 1.01},
        "occlusion": [205, 60, 355, 305],
        "occlusionColor": [64, 70, 61],
        "occlusionRadius": 24,
        "size": [512, 768],
    }
    with Image.open(source) as opened:
        base = opened.convert("RGB").resize(
            tuple(config["size"]), Image.Resampling.LANCZOS
        )
    left = ImageEnhance.Brightness(base).enhance(config["brightness"]["left"])
    middle = base.copy()
    draw = ImageDraw.Draw(middle)
    draw.rounded_rectangle(
        tuple(config["occlusion"]),
        radius=config["occlusionRadius"],
        fill=tuple(config["occlusionColor"]),
    )
    right = ImageEnhance.Brightness(base).enhance(config["brightness"]["right"])
    files = {
        "left.png": left,
        "middle-head-occluded.png": middle,
        "right.png": right,
    }
    for name, image in files.items():
        image.save(output / name, format="PNG", optimize=False)
    receipt = {
        "artifacts": {
            name: file_digest(output / name) for name in sorted(files)
        },
        "configDigest": canonical_digest(config),
        "schemaVersion": "cimmich.local-ai-head-occlusion-fixture.v1",
        "source": {
            "basename": source.name,
            "digest": file_digest(source),
        },
    }
    (output / "fixture-receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    )
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
