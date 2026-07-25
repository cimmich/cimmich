#!/usr/bin/env python3
"""Local, weight-free PetFace ArcFace embedding adapter."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
import torch
import torch.nn.functional as functional
from torch import nn
from torchvision import transforms
from torchvision.models import resnet50


INPUT_SIZE = 224
EMBEDDING_DIMENSION = 512
SCHEMA_VERSION = "cimmich.petface-embedding.v1"
SUPPORTED_SPECIES = {"cat", "dog"}


def select_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_model(weight_path: Path, device: torch.device):
    checkpoint = torch.load(
        weight_path.expanduser().resolve(strict=True),
        map_location="cpu",
        weights_only=True,
    )
    state = checkpoint.get("state_dict_backbone")
    if not isinstance(state, dict):
        raise ValueError("PetFace checkpoint has no state_dict_backbone")
    model = resnet50(weights=None)
    model.fc = nn.Sequential(
        nn.Linear(model.fc.in_features, EMBEDDING_DIMENSION),
        nn.BatchNorm1d(EMBEDDING_DIMENSION),
    )
    model.load_state_dict(state)
    model.eval()
    model.to(device)
    return model


def validate_box(raw: Any) -> tuple[float, float, float, float] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("box must be an object")
    values = tuple(float(raw[key]) for key in ("x", "y", "w", "h"))
    if not all(math.isfinite(value) for value in values):
        raise ValueError("box values must be finite")
    x, y, width, height = values
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1 or y + height > 1:
        raise ValueError("box must fit within normalized image coordinates")
    return values


def face_crop(
    image: Image.Image,
    box: tuple[float, float, float, float] | None,
    *,
    context: float,
) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    if box is None:
        return image
    x, y, width, height = box
    image_width, image_height = image.size
    center_x = (x + width / 2) * image_width
    center_y = (y + height / 2) * image_height
    side = max(width * image_width, height * image_height) * context
    left = max(0.0, center_x - side / 2)
    top = max(0.0, center_y - side / 2)
    right = min(float(image_width), center_x + side / 2)
    bottom = min(float(image_height), center_y + side / 2)
    return image.crop(
        (
            int(math.floor(left)),
            int(math.floor(top)),
            int(math.ceil(right)),
            int(math.ceil(bottom)),
        )
    )


def preprocessing():
    return transforms.Compose(
        [
            transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cat-weight", required=True, type=Path)
    parser.add_argument("--dog-weight", type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--crop-context", type=float, default=1.35)
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records = payload.get("records")
    if not isinstance(records, list) or not records:
        raise ValueError("input must contain a non-empty records array")
    species = {str(record.get("species", "")) for record in records}
    unsupported = species - SUPPORTED_SPECIES
    if unsupported:
        raise ValueError(f"unsupported species: {sorted(unsupported)}")
    if "dog" in species and args.dog_weight is None:
        raise ValueError("--dog-weight is required for dog records")

    device = select_device(args.device)
    paths = {"cat": args.cat_weight, "dog": args.dog_weight}
    models = {
        name: load_model(path, device)
        for name, path in paths.items()
        if name in species and path is not None
    }
    prepare = preprocessing()
    output: list[dict[str, Any]] = []
    with torch.inference_mode():
        for record in records:
            record_context = float(record.get("cropContext", args.crop_context))
            if not math.isfinite(record_context) or not 1 <= record_context <= 4:
                raise ValueError(
                    f"record {record.get('id')} cropContext must be between 1 and 4"
                )
            path = Path(str(record["image"])).expanduser().resolve(strict=True)
            with Image.open(path) as source:
                crop = face_crop(
                    source,
                    validate_box(record.get("box")),
                    context=record_context,
                )
                tensor = prepare(crop).unsqueeze(0).to(device)
            embedding = models[record["species"]](tensor)
            normalized = functional.normalize(embedding.float(), dim=1)[0].cpu()
            output.append(
                {
                    "embedding": normalized.tolist(),
                    "id": str(record["id"]),
                    "identity": str(record["identity"]),
                    "role": str(record.get("role", "query")),
                    "species": str(record["species"]),
                }
            )

    result = {
        "device": str(device),
        "embeddingDimension": EMBEDDING_DIMENSION,
        "records": output,
        "schemaVersion": SCHEMA_VERSION,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "device": str(device),
                "embedded": len(output),
                "output": str(args.output),
                "status": "complete",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
