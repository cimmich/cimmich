#!/usr/bin/env python3
"""Body appearance, overlays, and non-destructive Real-ESRGAN for the photo lab."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


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


def open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).convert("RGB")


def normalized_box(raw: dict) -> tuple[float, float, float, float]:
    values = tuple(float(raw[key]) for key in ("x", "y", "w", "h"))
    if any(not math.isfinite(value) for value in values):
        raise ValueError("box must be finite")
    x, y, width, height = values
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1.000001 or y + height > 1.000001:
        raise ValueError("box must fit the image")
    return x, y, width, height


def body_feature(image: Image.Image, raw_box: dict) -> tuple[list[float] | None, dict]:
    x, y, width, height = normalized_box(raw_box)
    image_width, image_height = image.size
    left = int(round(x * image_width))
    top = int(round(y * image_height))
    right = int(round((x + width) * image_width))
    bottom = int(round((y + height) * image_height))
    pixel_width = max(0, right - left)
    pixel_height = max(0, bottom - top)
    touches = sum(
        [x <= 0.005, y <= 0.005, x + width >= 0.995, y + height >= 0.995]
    )
    visibility = max(0.0, 1.0 - touches * 0.16)
    quality = {
        "pixelHeight": pixel_height,
        "pixelWidth": pixel_width,
        "truncation": round(min(1.0, touches * 0.25), 6),
        "visibility": round(visibility, 6),
    }
    if pixel_width < 24 or pixel_height < 48:
        return None, quality
    crop = image.crop((left, top, right, bottom))
    central = crop.crop(
        (
            int(crop.width * 0.14),
            int(crop.height * 0.08),
            max(int(crop.width * 0.86), int(crop.width * 0.14) + 1),
            max(int(crop.height * 0.94), int(crop.height * 0.08) + 1),
        )
    ).resize((32, 64), Image.Resampling.BILINEAR)
    rgb = np.asarray(central, dtype=np.float32) / 255.0
    hsv = np.asarray(central.convert("HSV"), dtype=np.float32) / 255.0
    values: list[float] = []
    for channel, bins in ((hsv[:, :, 0], 16), (hsv[:, :, 1], 8), (hsv[:, :, 2], 8)):
        histogram, _ = np.histogram(channel, bins=bins, range=(0, 1), density=False)
        values.extend(histogram.astype(np.float32).tolist())
    for channel_index in range(3):
        histogram, _ = np.histogram(rgb[:, :, channel_index], bins=8, range=(0, 1), density=False)
        values.extend(histogram.astype(np.float32).tolist())
    for row in np.array_split(rgb, 4, axis=0):
        for cell in np.array_split(row, 2, axis=1):
            values.extend(cell.mean(axis=(0, 1)).tolist())
    vector = np.asarray(values, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if not math.isfinite(norm) or norm <= 0:
        return None, quality
    return [round(float(value), 8) for value in vector / norm], quality


def probe() -> None:
    request = json.load(sys.stdin)
    if not isinstance(request, dict) or set(request) != {
        "imagePath",
        "maxInputPixels",
        "sourceContentDigest",
    }:
        raise ValueError("probe request fields are invalid")
    image_path = Path(request["imagePath"]).resolve(strict=True)
    if file_digest(image_path) != request["sourceContentDigest"]:
        raise ValueError("source digest changed")
    image = open_rgb(image_path)
    if image.width * image.height > int(request["maxInputPixels"]):
        raise ValueError("input pixel limit exceeded")
    print(
        json.dumps(
            {
                "height": image.height,
                "schemaVersion": "cimmich.local-ai-image-probe.v1",
                "width": image.width,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def appearance() -> None:
    request = json.load(sys.stdin)
    image_path = Path(request["imagePath"]).resolve(strict=True)
    if file_digest(image_path) != request["sourceContentDigest"]:
        raise ValueError("source digest changed")
    image = open_rgb(image_path)
    if image.width * image.height > int(request["maxInputPixels"]):
        raise ValueError("input pixel limit exceeded")
    rows = []
    for body in request["bodies"]:
        feature, quality = body_feature(image, body["box"])
        rows.append(
            {
                "appearanceFeature": feature,
                "featureDigest": canonical_digest(feature) if feature else None,
                "quality": quality,
                "state": "available" if feature else "abstained",
            }
        )
    print(
        json.dumps(
            {
                "appearanceConfigDigest": canonical_digest(
                    {
                        "centralCrop": [0.14, 0.08, 0.86, 0.94],
                        "feature": "hsv-rgb-spatial-histogram-v1",
                        "resize": [32, 64],
                    }
                ),
                "image": {"height": image.height, "width": image.width},
                "observations": rows,
                "schemaVersion": "cimmich.local-ai-body-appearance.v1",
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def tile_positions(length: int, tile: int, overlap: int) -> list[int]:
    if length <= tile:
        return [0]
    step = tile - overlap
    positions = list(range(0, max(1, length - tile + 1), step))
    last = length - tile
    if positions[-1] != last:
        positions.append(last)
    return positions


def enhancement_quality(
    source: Image.Image,
    enhanced: Image.Image,
    xs: list[int],
    ys: list[int],
    overlap: int,
    native_scale: int,
) -> dict:
    original = np.asarray(source, dtype=np.float32) / 255.0
    reconstructed = np.asarray(
        enhanced.resize(source.size, Image.Resampling.LANCZOS), dtype=np.float32
    ) / 255.0
    mae = float(np.mean(np.abs(original - reconstructed)))
    x_mean = float(original.mean())
    y_mean = float(reconstructed.mean())
    x_variance = float(original.var())
    y_variance = float(reconstructed.var())
    covariance = float(np.mean((original - x_mean) * (reconstructed - y_mean)))
    c1 = 0.01**2
    c2 = 0.03**2
    ssim = ((2 * x_mean * y_mean + c1) * (2 * covariance + c2)) / (
        (x_mean**2 + y_mean**2 + c1) * (x_variance + y_variance + c2)
    )
    original_edge = float(
        np.mean(np.abs(np.diff(original, axis=0)))
        + np.mean(np.abs(np.diff(original, axis=1)))
    )
    reconstructed_edge = float(
        np.mean(np.abs(np.diff(reconstructed, axis=0)))
        + np.mean(np.abs(np.diff(reconstructed, axis=1)))
    )
    output = np.asarray(enhanced, dtype=np.float32) / 255.0
    output_scale = enhanced.width / source.width
    seam_values: list[float] = []
    for axis, positions, maximum in (
        (1, xs[1:], enhanced.width),
        (0, ys[1:], enhanced.height),
    ):
        for position in positions:
            boundary = int(round((position + overlap / 2) * output_scale))
            if boundary < 2 or boundary >= maximum - 2:
                continue
            if axis == 1:
                seam = float(np.mean(np.abs(output[:, boundary] - output[:, boundary - 1])))
                nearby = [
                    float(np.mean(np.abs(output[:, index] - output[:, index - 1])))
                    for index in range(boundary - 4, boundary + 5)
                    if 1 <= index < maximum and index != boundary
                ]
            else:
                seam = float(np.mean(np.abs(output[boundary] - output[boundary - 1])))
                nearby = [
                    float(np.mean(np.abs(output[index] - output[index - 1])))
                    for index in range(boundary - 4, boundary + 5)
                    if 1 <= index < maximum and index != boundary
                ]
            baseline = float(np.median(nearby)) if nearby else 0.0
            seam_values.append(seam / max(baseline, 1e-6))
    return {
        "downsampleMae": round(mae, 6),
        "downsampleSsim": round(max(-1.0, min(1.0, ssim)), 6),
        "edgeEnergyRatio": round(reconstructed_edge / max(original_edge, 1e-6), 6),
        "maximumSeamRatio": round(max(seam_values, default=0.0), 6),
        "metricVersion": "derived-preview-fidelity-v1",
        "nativeScale": native_scale,
    }


def enhance(args: argparse.Namespace) -> None:
    import onnxruntime as ort

    source = Path(args.input).resolve(strict=True)
    model = Path(args.model).resolve(strict=True)
    output = Path(args.output).resolve()
    image = open_rgb(source)
    if image.width * image.height > args.max_input_pixels:
        raise ValueError("enhance input pixel limit exceeded")
    providers = ["CPUExecutionProvider"]
    if args.device == "coreml":
        if "CoreMLExecutionProvider" not in ort.get_available_providers():
            raise ValueError("CoreMLExecutionProvider unavailable")
        providers = ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    session = ort.InferenceSession(str(model), providers=providers)
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    tile = 256
    overlap = 32
    scale = 4
    padded_width = max(tile, image.width)
    padded_height = max(tile, image.height)
    padded = Image.new("RGB", (padded_width, padded_height))
    padded.paste(image, (0, 0))
    if image.width < padded_width or image.height < padded_height:
        reflected = ImageOps.expand(image, border=(0, 0, padded_width - image.width, padded_height - image.height))
        padded.paste(reflected.resize((padded_width, padded_height), Image.Resampling.BILINEAR), (0, 0))
        padded.paste(image, (0, 0))
    result = Image.new("RGB", (padded_width * scale, padded_height * scale))
    xs = tile_positions(padded_width, tile, overlap)
    ys = tile_positions(padded_height, tile, overlap)
    for y_index, y in enumerate(ys):
        for x_index, x in enumerate(xs):
            patch = np.asarray(padded.crop((x, y, x + tile, y + tile)), dtype=np.float32) / 255.0
            tensor = np.transpose(patch, (2, 0, 1))[None, ...]
            enhanced = session.run([output_name], {input_name: tensor})[0][0]
            enhanced = np.clip(np.transpose(enhanced, (1, 2, 0)), 0, 1)
            tile_image = Image.fromarray((enhanced * 255.0 + 0.5).astype(np.uint8), "RGB")
            crop_left = 0 if x_index == 0 else overlap // 2
            crop_top = 0 if y_index == 0 else overlap // 2
            crop_right = tile if x_index == len(xs) - 1 else tile - overlap // 2
            crop_bottom = tile if y_index == len(ys) - 1 else tile - overlap // 2
            cropped = tile_image.crop(
                (crop_left * scale, crop_top * scale, crop_right * scale, crop_bottom * scale)
            )
            result.paste(cropped, ((x + crop_left) * scale, (y + crop_top) * scale))
    result = result.crop((0, 0, image.width * scale, image.height * scale))
    if args.scale == 2:
        result = result.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    quality = enhancement_quality(image, result, xs, ys, overlap, scale)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, format="PNG", optimize=False)
    print(
        json.dumps(
            {
                "artifactDigest": file_digest(output),
                "configDigest": canonical_digest(
                    {
                        "device": args.device,
                        "modelDigest": file_digest(model),
                        "nativeScale": scale,
                        "overlap": overlap,
                        "requestedScale": args.scale,
                        "tile": tile,
                    }
                ),
                "height": result.height,
                "modelDigest": file_digest(model),
                "output": str(output),
                "provider": "realesrgan-onnx-local-photo-lab",
                "quality": quality,
                "scale": args.scale,
                "schemaVersion": "cimmich.local-ai-enhance-result.v1",
                "width": result.width,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


def overlay(args: argparse.Namespace) -> None:
    request = json.loads(Path(args.data).read_text())
    image = open_rgb(Path(args.input).resolve(strict=True))
    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    colors = {"body": "#47A7FF", "face": "#FF5B78"}
    for kind in ("bodies", "faces"):
        for index, item in enumerate(request.get(kind, [])):
            x, y, width, height = normalized_box(item["box"])
            points = (
                round(x * image.width),
                round(y * image.height),
                round((x + width) * image.width),
                round((y + height) * image.height),
            )
            color = colors["body" if kind == "bodies" else "face"]
            draw.rectangle(points, outline=color, width=4)
            label = f"{kind[:-1].title()} {index + 1}"
            draw.text((points[0] + 4, max(0, points[1] - 14)), label, fill=color, font=font, stroke_width=2, stroke_fill="black")
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG")
    print(json.dumps({"artifactDigest": file_digest(output), "output": str(output)}, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("probe")
    sub.add_parser("appearance")
    enhance_parser = sub.add_parser("enhance")
    enhance_parser.add_argument("--input", required=True)
    enhance_parser.add_argument("--model", required=True)
    enhance_parser.add_argument("--output", required=True)
    enhance_parser.add_argument("--scale", required=True, type=int, choices=[2, 4])
    enhance_parser.add_argument("--device", required=True, choices=["coreml", "cpu"])
    enhance_parser.add_argument("--max-input-pixels", required=True, type=int)
    overlay_parser = sub.add_parser("overlay")
    overlay_parser.add_argument("--input", required=True)
    overlay_parser.add_argument("--data", required=True)
    overlay_parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "probe":
        probe()
    elif args.command == "appearance":
        appearance()
    elif args.command == "enhance":
        enhance(args)
    else:
        overlay(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(json.dumps({"error": {"code": "LOCAL_AI_IMAGE_TOOL_FAILED", "message": type(error).__name__}}) + "\n")
        raise SystemExit(1)
