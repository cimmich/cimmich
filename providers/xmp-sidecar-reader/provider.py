#!/usr/bin/env python3
"""Read-only, path-minimizing XMP face-region scanner for Cimmich."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


SCHEMA_VERSION = "cimmich.xmp-sidecar-reader.v3"
MEDIA_EXTENSIONS = {
    ".arw", ".cr2", ".cr3", ".dng", ".heic", ".jpeg", ".jpg", ".nef",
    ".orf", ".png", ".rw2", ".tif", ".tiff", ".webp",
}
MAX_SIDECAR_BYTES = 16 * 1024 * 1024


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_text(value: str) -> str:
    return digest_bytes(value.encode("utf-8"))


def file_digest(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return digest.hexdigest(), size


def local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1].split(":", 1)[-1]


def attributes(element: ET.Element) -> dict[str, str]:
    return {local_name(key): str(value) for key, value in element.attrib.items()}


def clean_name(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def fixed(value: float) -> float:
    return float(f"{value:.9f}")


def valid_box(box: dict[str, float]) -> bool:
    return (
        0 <= box["x"] <= 1
        and 0 <= box["y"] <= 1
        and 0 < box["w"] <= 1
        and 0 < box["h"] <= 1
        and box["x"] + box["w"] <= 1.000001
        and box["y"] + box["h"] <= 1.000001
    )


def region_key(name: str, box: dict[str, float]) -> str:
    return digest_text(
        json.dumps(
            {"box": box, "rawName": name},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    )


def iou(left: dict[str, float], right: dict[str, float]) -> float:
    x1 = max(left["x"], right["x"])
    y1 = max(left["y"], right["y"])
    x2 = min(left["x"] + left["w"], right["x"] + right["w"])
    y2 = min(left["y"] + left["h"], right["y"] + right["h"])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = left["w"] * left["h"] + right["w"] * right["h"] - intersection
    return intersection / union if union > 0 else 0.0


def parse_mwg(root: ET.Element) -> list[dict[str, object]]:
    regions: list[dict[str, object]] = []
    for element in root.iter():
        if local_name(element.tag) != "Description":
            continue
        attrs = attributes(element)
        if attrs.get("Type", "").casefold() != "face":
            continue
        name = clean_name(attrs.get("Name", ""))
        if not name:
            continue
        area = None
        for child in element.iter():
            if local_name(child.tag) == "Area":
                area = attributes(child)
                break
        if not area or area.get("unit", "").casefold() != "normalized":
            continue
        try:
            width = float(area["w"])
            height = float(area["h"])
            center_x = float(area["x"])
            center_y = float(area["y"])
        except (KeyError, TypeError, ValueError):
            continue
        box = {
            "x": fixed(center_x - width / 2),
            "y": fixed(center_y - height / 2),
            "w": fixed(width),
            "h": fixed(height),
        }
        if valid_box(box):
            regions.append(
                {
                    "box": box,
                    "rawName": name,
                    "regionKey": region_key(name, box),
                    "source": "mwg-rs",
                }
            )
    return regions


def parse_microsoft(root: ET.Element) -> list[dict[str, object]]:
    regions: list[dict[str, object]] = []
    for element in root.iter():
        attrs = attributes(element)
        name = clean_name(attrs.get("PersonDisplayName", ""))
        rectangle = attrs.get("Rectangle", "")
        if not name or not rectangle:
            continue
        try:
            x, y, width, height = (float(value.strip()) for value in rectangle.split(","))
        except (TypeError, ValueError):
            continue
        box = {"x": fixed(x), "y": fixed(y), "w": fixed(width), "h": fixed(height)}
        if valid_box(box):
            regions.append(
                {
                    "box": box,
                    "rawName": name,
                    "regionKey": region_key(name, box),
                    "source": "microsoft-photo",
                }
            )
    return regions


def parse_faces(packet: bytes) -> list[dict[str, object]]:
    root = ET.fromstring(packet)
    mwg = parse_mwg(root)
    microsoft = parse_microsoft(root)
    combined = list(mwg)
    for candidate in microsoft:
        if any(
            candidate["rawName"].casefold() == existing["rawName"].casefold()
            and iou(candidate["box"], existing["box"]) >= 0.9
            for existing in mwg
        ):
            continue
        combined.append(candidate)
    unique: dict[str, dict[str, object]] = {}
    for region in combined:
        unique.setdefault(str(region["regionKey"]), region)
    return sorted(unique.values(), key=lambda value: str(value["regionKey"]))


def sidecars(root: Path):
    for directory, subdirectories, filenames in os.walk(root, followlinks=False):
        subdirectories[:] = sorted(
            name for name in subdirectories
            if name != ".dtrash" and not (Path(directory) / name).is_symlink()
        )
        for filename in sorted(filenames):
            if filename.lower().endswith(".xmp"):
                yield Path(directory) / filename


def paired_media(sidecar: Path) -> Path | None:
    media = sidecar.with_suffix("")
    if media.suffix.lower() in MEDIA_EXTENSIONS:
        return media if media.is_file() and not media.is_symlink() else None

    # XMP commonly replaces the media extension (photo.xmp beside photo.jpg)
    # instead of appending to it (photo.jpg.xmp). Accept only a single exact
    # stem match so JPEG/RAW sibling pairs cannot be selected heuristically.
    try:
        candidates = [
            candidate
            for candidate in sidecar.parent.iterdir()
            if candidate.stem.casefold() == sidecar.stem.casefold()
            and candidate.suffix.lower() in MEDIA_EXTENSIONS
            and candidate.is_file()
            and not candidate.is_symlink()
        ]
    except OSError:
        return None
    return candidates[0] if len(candidates) == 1 else None


def emit(value: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--limit-assets", type=int, default=1000)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir() or root.is_symlink():
        raise SystemExit("XMP_SIDECAR_ROOT_INVALID")
    if args.limit_assets < 1 or args.limit_assets > 100000:
        raise SystemExit("XMP_SIDECAR_LIMIT_INVALID")

    emit({"kind": "header", "schemaVersion": SCHEMA_VERSION})
    emitted = 0
    scanned = 0
    skipped = 0
    for sidecar in sidecars(root):
        scanned += 1
        try:
            stat = sidecar.stat()
            if (
                sidecar.is_symlink()
                or stat.st_size < 1
                or stat.st_size > MAX_SIDECAR_BYTES
            ):
                skipped += 1
                continue
            packet = sidecar.read_bytes()
            faces = parse_faces(packet)
        except (OSError, ET.ParseError):
            skipped += 1
            continue
        if not faces:
            continue
        media = paired_media(sidecar)
        if media is None:
            skipped += 1
            continue
        relative_sidecar = sidecar.relative_to(root).as_posix()
        content_digest, byte_length = file_digest(media)
        emit(
            {
                "byteLength": byte_length,
                "contentDigest": content_digest,
                "faces": faces,
                "kind": "asset",
                "sidecarDigest": digest_bytes(packet),
                "sourceLocatorDigest": digest_text(relative_sidecar),
            }
        )
        emitted += 1
        if emitted >= args.limit_assets:
            break
    emit(
        {
            "emittedAssets": emitted,
            "kind": "summary",
            "scannedSidecars": scanned,
            "skippedSidecars": skipped,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
