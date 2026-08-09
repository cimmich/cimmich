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

try:
    # Preferred: defusedxml blocks entity-expansion attacks outright.
    from defusedxml.ElementTree import fromstring as _defused_fromstring
except ImportError:  # pragma: no cover - depends on the host environment
    _defused_fromstring = None


SCHEMA_VERSION = "cimmich.xmp-sidecar-reader.v4"
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


def source_coordinate_frame(root: ET.Element) -> tuple[int, dict[str, int] | None]:
    """Return the EXIF transform that maps XMP regions to displayed pixels.

    MWG regions are expressed against ``AppliedToDimensions`` before the
    image's TIFF orientation is applied. Cimmich and Immich display decoded,
    EXIF-transposed pixels, so rotated sidecars must be projected into that
    same top-left coordinate frame before their boxes are stored.
    """
    orientation = 1
    for element in root.iter():
        for key, value in element.attrib.items():
            if (
                local_name(key) == "Orientation"
                and "ns.adobe.com/tiff" in key
            ):
                try:
                    candidate = int(str(value).strip())
                except (TypeError, ValueError):
                    candidate = 1
                if 1 <= candidate <= 8:
                    orientation = candidate
                break

    dimensions = None
    for element in root.iter():
        if local_name(element.tag) != "AppliedToDimensions":
            continue
        for candidate in element.iter():
            attrs = attributes(candidate)
            try:
                width = int(float(attrs["w"]))
                height = int(float(attrs["h"]))
            except (KeyError, TypeError, ValueError):
                continue
            if width > 0 and height > 0:
                dimensions = {"height": height, "width": width}
                break
        if dimensions is not None:
            break

    # Without AppliedToDimensions there is no source-frame assertion strong
    # enough to justify moving stored evidence. Preserve the region unchanged.
    return (orientation if dimensions is not None else 1), dimensions


def displayed_box(
    box: dict[str, float], orientation: int
) -> dict[str, float]:
    x, y, width, height = box["x"], box["y"], box["w"], box["h"]
    if orientation == 1:
        transformed = {"x": x, "y": y, "w": width, "h": height}
    elif orientation == 2:
        transformed = {"x": 1 - x - width, "y": y, "w": width, "h": height}
    elif orientation == 3:
        transformed = {
            "x": 1 - x - width,
            "y": 1 - y - height,
            "w": width,
            "h": height,
        }
    elif orientation == 4:
        transformed = {"x": x, "y": 1 - y - height, "w": width, "h": height}
    elif orientation == 5:
        transformed = {"x": y, "y": x, "w": height, "h": width}
    elif orientation == 6:
        transformed = {"x": 1 - y - height, "y": x, "w": height, "h": width}
    elif orientation == 7:
        transformed = {
            "x": 1 - y - height,
            "y": 1 - x - width,
            "w": height,
            "h": width,
        }
    elif orientation == 8:
        transformed = {"x": y, "y": 1 - x - width, "w": height, "h": width}
    else:  # Defensive: source_coordinate_frame already bounds this value.
        transformed = {"x": x, "y": y, "w": width, "h": height}
    normalized = {key: fixed(value) for key, value in transformed.items()}
    # Legacy region writers sometimes round a source edge to 1.000000x. The
    # source-frame validator permits only that sub-pixel tolerance; after a
    # mirror/rotation it appears as a tiny negative origin. Canonicalize that
    # rounding residue to the display edge without moving a real region.
    for key in ("x", "y"):
        if -0.000001 <= normalized[key] < 0:
            normalized[key] = 0.0
    return normalized


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


def parse_xml(packet: bytes) -> ET.Element:
    if _defused_fromstring is not None:
        try:
            return _defused_fromstring(packet)
        except ET.ParseError:
            raise
        except Exception as error:  # DefusedXmlException and friends
            raise ET.ParseError(str(error)) from error
    # Stdlib fallback: ElementTree does not expand external entities, but it
    # is still vulnerable to internal-entity blowups. Legitimate XMP sidecars
    # never carry a DTD, so reject any packet that declares one.
    if b"<!DOCTYPE" in packet or b"<!ENTITY" in packet:
        raise ET.ParseError("DTD/entity declarations are not allowed in XMP")
    return ET.fromstring(packet)


def parse_faces(packet: bytes) -> list[dict[str, object]]:
    root = parse_xml(packet)
    orientation, dimensions = source_coordinate_frame(root)
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
    projected = []
    for region in unique.values():
        source_box = region["box"]
        projected.append(
            {
                **region,
                "box": displayed_box(source_box, orientation),
                "exifOrientation": orientation,
                "sourceBox": source_box,
                "sourceDimensions": dimensions,
            }
        )
    return sorted(projected, key=lambda value: str(value["regionKey"]))


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
