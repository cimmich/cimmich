#!/usr/bin/env python3
"""Classify XMP sidecar coverage without hashing media or exposing paths."""

from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import provider


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    root = Path(args.root).resolve()
    if not root.is_dir() or root.is_symlink():
        raise SystemExit("XMP_SIDECAR_ROOT_INVALID")

    counts: Counter[str] = Counter()
    for sidecar in provider.sidecars(root):
        counts["sidecars"] += 1
        try:
            stat = sidecar.stat()
            if (
                sidecar.is_symlink()
                or stat.st_size < 1
                or stat.st_size > provider.MAX_SIDECAR_BYTES
            ):
                counts["invalid_sidecar_file"] += 1
                continue
            packet = sidecar.read_bytes()
            faces = provider.parse_faces(packet)
        except ET.ParseError:
            counts["invalid_xml"] += 1
            continue
        except OSError:
            counts["read_error"] += 1
            continue
        if not faces:
            counts["without_named_face"] += 1
            continue

        counts["with_named_face"] += 1
        counts["named_face_regions"] += len(faces)
        media = sidecar.with_suffix("")
        if media.suffix.lower() not in provider.MEDIA_EXTENSIONS:
            counts["unsupported_media_extension"] += 1
            try:
                candidates = [
                    candidate
                    for candidate in sidecar.parent.iterdir()
                    if candidate.stem.casefold() == sidecar.stem.casefold()
                    and candidate.suffix.lower() in provider.MEDIA_EXTENSIONS
                    and candidate.is_file()
                    and not candidate.is_symlink()
                ]
            except OSError:
                candidates = []
            counts[f"replacement_style_candidates_{len(candidates)}"] += 1
            for candidate in candidates:
                counts[
                    f"replacement_style_extension_{candidate.suffix.lower()}"
                ] += 1
        elif not media.exists():
            counts["missing_paired_media"] += 1
        elif media.is_symlink():
            counts["symlink_paired_media"] += 1
        elif not media.is_file():
            counts["non_file_paired_media"] += 1
        else:
            counts["importable"] += 1
            counts["importable_named_face_regions"] += len(faces)

    output = {
        "kind": "xmp_sidecar_coverage_audit",
        **{key: counts[key] for key in sorted(counts)},
    }
    print(json.dumps(output, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
