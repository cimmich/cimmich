#!/usr/bin/env python3
"""Produce bounded box-prompted SAM2 masks over one in-memory image."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import sys
from pathlib import Path
from typing import Any


REQUEST_SCHEMA = "cimmich.sam2-body-mask-request.v1"
RESULT_SCHEMA = "cimmich.body-mask-result.v1"
MANIFEST_SCHEMA = "cimmich.body-mask-provider.v1"
MAX_HEADER_BYTES = 1024 * 1024
PUBLIC_ID = __import__("re").compile(r"^[a-z0-9](?:[a-z0-9._-]{0,95})$")


class ProviderError(Exception):
    pass


def fail(code: str) -> int:
    sys.stderr.write(json.dumps({"error": {"code": code}}, separators=(",", ":")) + "\n")
    return 1


def exact(value: Any, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise ProviderError(f"{label} fields are invalid")
    return value


def canonical_json_value(value: Any) -> Any:
    """Match JSON.stringify for canonical finite numbers shared with Node."""
    if isinstance(value, dict):
        return {key: canonical_json_value(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [canonical_json_value(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(canonical_json_value(value), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def digest_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
        raise ProviderError(f"{label} is invalid")
    return value


def public_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or PUBLIC_ID.fullmatch(value) is None:
        raise ProviderError(f"{label} is invalid")
    return value


def unit(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1:
        raise ProviderError(f"{label} is invalid")
    return float(value)


def round6(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return round(max(minimum, min(maximum, float(value))), 6)


def round_pixel(value: float) -> int:
    return math.floor(value + 0.5)


def round_ratio6(numerator: int, denominator: int) -> float:
    return math.floor((numerator * 1_000_000) / denominator + 0.5) / 1_000_000


def mask_payload_digest(value: dict) -> str:
    return digest(
        {
            "box": {key: f'{value["box"][key]:.6f}' for key in ("h", "w", "x", "y")},
            "height": value["height"],
            "originX": value["originX"],
            "originY": value["originY"],
            "runs": value["runs"],
            "width": value["width"],
        }
    )


def normalized_box(value: Any, label: str) -> dict:
    value = exact(value, {"h", "w", "x", "y"}, label)
    result = {key: unit(value[key], f"{label}.{key}") for key in ("h", "w", "x", "y")}
    if result["h"] <= 0 or result["w"] <= 0 or result["x"] + result["w"] > 1.000001 or result["y"] + result["h"] > 1.000001:
        raise ProviderError(f"{label} is outside the normalized image")
    return result


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
    exact(
        header,
        {"assetToken", "bodyResultDigest", "inputRevision", "prompts", "schemaVersion", "sourceContentDigest"},
        "request",
    )
    if header["schemaVersion"] != REQUEST_SCHEMA:
        raise ProviderError("request schema is invalid")
    for field in ("assetToken", "bodyResultDigest", "inputRevision", "sourceContentDigest"):
        digest_string(header[field], field)
    prompts = header["prompts"]
    if not isinstance(prompts, list) or not prompts or len(prompts) > 1000:
        raise ProviderError("request prompts are invalid")
    body_ids = set()
    for index, prompt in enumerate(prompts):
        exact(prompt, {"bodyId", "box"}, f"prompts[{index}]")
        body_id = public_id(prompt["bodyId"], f"prompts[{index}].bodyId")
        if body_id in body_ids:
            raise ProviderError("request prompts contain duplicate Bodies")
        body_ids.add(body_id)
        prompt["box"] = normalized_box(prompt["box"], f"prompts[{index}].box")
    image = raw[4 + header_size :]
    if not image or len(image) > maximum or hashlib.sha256(image).hexdigest() != header["sourceContentDigest"]:
        raise ProviderError("source image binding is invalid")
    return header, image


def load_manifest(path: Path, checkpoint: Path) -> dict:
    try:
        manifest = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ProviderError("manifest is unavailable") from error
    exact(
        manifest,
        {"execution", "licensing", "mask", "maskConfigDigest", "preprocessing", "privacy", "provider", "resources", "schemaVersion"},
        "manifest",
    )
    if manifest["schemaVersion"] != MANIFEST_SCHEMA:
        raise ProviderError("manifest schema is invalid")
    core = {key: manifest[key] for key in sorted(set(manifest) - {"maskConfigDigest"})}
    if manifest["maskConfigDigest"] != digest(core):
        raise ProviderError("manifest config digest is invalid")
    mask = manifest["mask"]
    exact(mask, {"artifactDigest", "configId", "maxSide", "modelId", "modelVersionId", "multiMaskCount", "selectionPolicyId", "thresholds"}, "mask")
    exact(mask["thresholds"], {"expandedFraction", "rejectMaxAreaRatio", "rejectMinAreaRatio", "rejectMinInside", "validMaxAreaRatio", "validMinInside", "validMinScore"}, "thresholds")
    if manifest["provider"] != {"providerId": "sam2-body-mask", "versionId": "v1"}:
        raise ProviderError("provider identity is invalid")
    if manifest["execution"]["network"] != "forbidden" or manifest["privacy"] != {"externalUpload": "none", "sourceMedia": "local-read-only"}:
        raise ProviderError("provider boundary is invalid")
    if mask["selectionPolicyId"] != "sam2-bounded-box-v1" or mask["multiMaskCount"] != 3:
        raise ProviderError("mask selection policy is invalid")
    if mask["artifactDigest"] != file_digest(checkpoint):
        raise ProviderError("checkpoint does not match the manifest")
    return manifest


def fit_size(width: int, height: int, max_side: int) -> tuple[int, int, float]:
    scale = min(1.0, max_side / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale)), scale


def pixel_box(box: dict, width: int, height: int) -> list[int]:
    x1 = max(0, min(width - 1, round_pixel(box["x"] * width)))
    y1 = max(0, min(height - 1, round_pixel(box["y"] * height)))
    x2 = max(x1 + 1, min(width, round_pixel((box["x"] + box["w"]) * width)))
    y2 = max(y1 + 1, min(height, round_pixel((box["y"] + box["h"]) * height)))
    return [x1, y1, x2, y2]


def expand(box: list[int], width: int, height: int, fraction: float) -> list[int]:
    x1, y1, x2, y2 = box
    box_width, box_height = x2 - x1, y2 - y1
    return [
        max(0, round_pixel(x1 - box_width * fraction)),
        max(0, round_pixel(y1 - box_height * fraction)),
        min(width, round_pixel(x2 + box_width * fraction)),
        min(height, round_pixel(y2 + box_height * fraction)),
    ]


def metrics(mask, score: float, box: list[int], expanded: list[int]) -> dict:
    x1, y1, x2, y2 = box
    ex1, ey1, ex2, ey2 = expanded
    prompt_area = max(1, (x2 - x1) * (y2 - y1))
    mask_area = int(mask.sum())
    inside = int(mask[ey1:ey2, ex1:ex2].sum())
    return {
        "insideExpandedRatio": round_ratio6(inside, max(1, mask_area)),
        "maskArea": mask_area,
        "maskAreaRatioToPrompt": round_ratio6(mask_area, prompt_area),
        "score": round6(score),
    }


def ranked_score(value: dict) -> float:
    ratio, inside = value["maskAreaRatioToPrompt"], value["insideExpandedRatio"]
    penalty = 0.35 if ratio < 0.05 else 0.0
    if ratio > 1.10:
        penalty += min(0.55, (ratio - 1.10) * 0.35)
    if inside < 0.78:
        penalty += min(0.70, (0.78 - inside) * 1.10)
    return value["score"] - penalty


def classify(value: dict, thresholds: dict) -> tuple[str, str]:
    area, ratio, inside, score = value["maskArea"], value["maskAreaRatioToPrompt"], value["insideExpandedRatio"], value["score"]
    if area == 0:
        return "abstained", "empty_mask"
    if inside < thresholds["rejectMinInside"]:
        return "abstained", "mask_bleeds_outside_prompt_area"
    if ratio < thresholds["rejectMinAreaRatio"]:
        return "abstained", "mask_too_small_for_prompt_box"
    if ratio > thresholds["rejectMaxAreaRatio"]:
        return "abstained", "mask_too_broad_for_prompt_box"
    if inside < thresholds["validMinInside"]:
        return "review", "mask_partly_outside_prompt_area"
    if ratio > thresholds["validMaxAreaRatio"]:
        return "review", "broad_mask_needs_visual_qc"
    if score < thresholds["validMinScore"]:
        return "review", "low_score_needs_visual_qc"
    return "geometry_valid", "geometry_valid_semantics_unverified"


def mask_bbox(mask) -> list[int]:
    import numpy as np

    ys, xs = np.nonzero(mask)
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1] if len(xs) else [0, 0, 0, 0]


def rle(mask) -> list[int]:
    values = mask.reshape(-1).astype("uint8").tolist()
    runs = []
    current, count = 0, 0
    for value in values:
        if value == current:
            count += 1
        else:
            runs.append(count)
            current, count = value, 1
    runs.append(count)
    return runs


def execute(request: dict, image_bytes: bytes, manifest: dict, checkpoint: Path, sam2_source: Path, sam2_deps: Path) -> dict:
    import numpy as np
    import torch
    from PIL import Image, ImageOps

    sys.path[:0] = [str(sam2_deps.resolve()), str(sam2_source.resolve())]
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    except Exception as error:
        raise ProviderError("source image is invalid") from error
    width, height, _ = fit_size(image.width, image.height, manifest["mask"]["maxSide"])
    if (width, height) != image.size:
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    device_name = manifest["execution"]["device"]
    device = torch.device("mps" if device_name in {"auto", "gpu"} and torch.backends.mps.is_available() else "cpu")
    config = {
        "sam2.1-hiera-tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
        "sam2.1-hiera-large": "configs/sam2.1/sam2.1_hiera_l.yaml",
    }.get(manifest["mask"]["configId"])
    if config is None:
        raise ProviderError("SAM2 config is unsupported")
    predictor = SAM2ImagePredictor(build_sam2(config, str(checkpoint.resolve()), device=device))
    predictor.set_image(np.asarray(image).copy())
    thresholds = manifest["mask"]["thresholds"]
    observations = []
    with torch.inference_mode():
        for prompt in request["prompts"]:
            box = pixel_box(prompt["box"], width, height)
            expanded = expand(box, width, height, thresholds["expandedFraction"])
            masks, scores, _ = predictor.predict(box=np.asarray(box, dtype=np.float32), multimask_output=True)
            candidates = []
            for candidate_index, (candidate_mask, score) in enumerate(zip(masks, scores)):
                value = metrics(candidate_mask.astype(bool), float(score), box, expanded)
                candidates.append((ranked_score(value), value["score"], candidate_index, value))
            _, _, selected_index, selected = max(candidates)
            selected_mask = masks[selected_index].astype(bool)
            state, reason = classify(selected, thresholds)
            bbox = mask_bbox(selected_mask)
            mask_value = None
            if selected["maskArea"]:
                x1, y1, x2, y2 = bbox
                crop = selected_mask[y1:y2, x1:x2]
                mask_core = {
                    "box": {
                        "h": round_ratio6(y2 - y1, height),
                        "w": round_ratio6(x2 - x1, width),
                        "x": round_ratio6(x1, width),
                        "y": round_ratio6(y1, height),
                    },
                    "height": int(crop.shape[0]),
                    "originX": x1,
                    "originY": y1,
                    "runs": rle(crop),
                    "width": int(crop.shape[1]),
                }
                mask_value = {**mask_core, "digest": mask_payload_digest(mask_core)}
            observations.append(
                {
                    "bodyId": prompt["bodyId"],
                    "mask": mask_value,
                    "metrics": {key: selected[key] for key in ("insideExpandedRatio", "maskArea", "maskAreaRatioToPrompt")},
                    "reason": reason,
                    "score": selected["score"],
                    "state": state,
                }
            )
    observations.sort(key=lambda item: item["bodyId"])
    return {
        "assetToken": request["assetToken"],
        "bodyResultDigest": request["bodyResultDigest"],
        "canvas": {"height": height, "width": width},
        "inputRevision": request["inputRevision"],
        "maskConfigDigest": manifest["maskConfigDigest"],
        "observations": observations,
        "schemaVersion": RESULT_SCHEMA,
        "sourceContentDigest": request["sourceContentDigest"],
        "state": "masks_produced" if any(item["state"] != "abstained" for item in observations) else "all_abstained",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--max-input-bytes", type=int, default=128 * 1024 * 1024)
    parser.add_argument("--sam2-deps", type=Path, required=True)
    parser.add_argument("--sam2-source", type=Path, required=True)
    args = parser.parse_args()
    try:
        checkpoint = args.checkpoint.resolve(strict=True)
        manifest = load_manifest(args.manifest.resolve(strict=True), checkpoint)
        request, image = load_packet(sys.stdin.buffer.read(args.max_input_bytes + MAX_HEADER_BYTES + 5), args.max_input_bytes)
        result = execute(request, image, manifest, checkpoint, args.sam2_source, args.sam2_deps)
        sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
        return 0
    except Exception:
        return fail("SAM2_BODY_MASK_PROVIDER_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
