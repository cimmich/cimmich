#!/usr/bin/env python3
"""Local, weight-free MiewID embedding adapter for Cimmich Pet evaluation."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


INPUT_SIZE = 440
EMBEDDING_DIMENSION = 2152
SCHEMA_VERSION = "cimmich.pet-reid-embedding.v1"


def select_device(requested: str):
    import torch

    if requested != "auto":
        return torch.device(requested)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_local_model(model_path: Path, device):
    import timm
    from transformers import AutoModel

    path = model_path.expanduser().resolve(strict=True)
    if not path.is_dir():
        raise ValueError("model path must be a local snapshot directory")

    # The upstream model constructor asks timm for generic ImageNet weights
    # before Transformers loads the complete MiewID checkpoint. Suppress that
    # redundant fetch so a downloaded snapshot works with networking disabled.
    original_create_model = timm.create_model

    def create_offline_model(*args, **kwargs):
        kwargs["pretrained"] = False
        return original_create_model(*args, **kwargs)

    timm.create_model = create_offline_model
    try:
        model = AutoModel.from_pretrained(
            str(path),
            local_files_only=True,
            trust_remote_code=True,
        )
    finally:
        timm.create_model = original_create_model

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


def pet_crop(
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
    side = max(8.0, min(side, float(max(image_width, image_height))))
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
    from torchvision import transforms

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


def read_records(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list) or not records:
        raise ValueError("input must contain a non-empty records array")
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("every record must be an object")
        record_id = str(record.get("id", "")).strip()
        if not record_id or record_id in seen:
            raise ValueError("record ids must be present and unique")
        seen.add(record_id)
        if not str(record.get("identity", "")).strip():
            raise ValueError(f"record {record_id} is missing identity")
        if not str(record.get("image", "")).strip():
            raise ValueError(f"record {record_id} is missing image")
        validate_box(record.get("box"))
    return records


def embed_records(
    model,
    records: list[dict[str, Any]],
    *,
    device,
    context: float,
) -> list[dict[str, Any]]:
    import torch
    import torch.nn.functional as functional

    prepare = preprocessing()
    output: list[dict[str, Any]] = []
    with torch.inference_mode():
        for record in records:
            image_path = Path(str(record["image"])).expanduser().resolve(strict=True)
            if not image_path.is_file():
                raise ValueError(f"record {record['id']} image is not a file")
            record_context = float(record.get("cropContext", context))
            if not math.isfinite(record_context) or not 1 <= record_context <= 12:
                raise ValueError(
                    f"record {record['id']} cropContext must be between 1 and 12"
                )
            with Image.open(image_path) as source:
                crop = pet_crop(
                    source,
                    validate_box(record.get("box")),
                    context=record_context,
                )
                tensor = prepare(crop).unsqueeze(0).to(device)
            embedding = model(tensor)
            if not isinstance(embedding, torch.Tensor) or embedding.shape != (
                1,
                EMBEDDING_DIMENSION,
            ):
                raise RuntimeError(
                    f"expected a 1x{EMBEDDING_DIMENSION} embedding, got {getattr(embedding, 'shape', None)}"
                )
            normalized = functional.normalize(embedding.float(), dim=1)[0].cpu()
            output.append(
                {
                    "embedding": normalized.tolist(),
                    "id": str(record["id"]),
                    "identity": str(record["identity"]),
                    "role": str(record.get("role", "query")),
                    "species": str(record.get("species", "unknown")),
                }
            )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--crop-context", type=float, default=4.0)
    args = parser.parse_args()
    if not 1 <= args.crop_context <= 12:
        raise ValueError("--crop-context must be between 1 and 12")

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    device = select_device(args.device)
    records = read_records(args.input)
    model = load_local_model(args.model, device)
    embeddings = embed_records(
        model,
        records,
        device=device,
        context=args.crop_context,
    )
    result = {
        "device": str(device),
        "embeddingDimension": EMBEDDING_DIMENSION,
        "model": args.model.name,
        "records": embeddings,
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
                "embedded": len(embeddings),
                "output": str(args.output),
                "status": "complete",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
