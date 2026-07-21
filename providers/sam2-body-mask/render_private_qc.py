#!/usr/bin/env python3
"""Render an operator-private contact sheet from a Body-mask QC packet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


COLORS = (
    (0, 214, 170),
    (255, 184, 0),
    (98, 151, 255),
    (255, 90, 128),
    (185, 116, 255),
    (68, 207, 255),
)


def decode_mask(value: dict) -> Image.Image:
    total = value["width"] * value["height"]
    pixels = bytearray(total)
    offset = 0
    state = 0
    for count in value["runs"]:
        if state:
            pixels[offset : offset + count] = b"\xff" * count
        offset += count
        state = 1 - state
    if offset != total:
        raise ValueError("Mask RLE is incomplete")
    return Image.frombytes("L", (value["width"], value["height"]), bytes(pixels))


def pixel_box(box: dict, width: int, height: int) -> tuple[int, int, int, int]:
    return (
        round(box["x"] * width),
        round(box["y"] * height),
        round((box["x"] + box["w"]) * width),
        round((box["y"] + box["h"]) * height),
    )


def render_case(row: dict, card_width: int = 720) -> Image.Image:
    image = ImageOps.exif_transpose(Image.open(row["imagePath"])).convert("RGB")
    scale = min(1.0, card_width / image.width, 560 / image.height)
    image = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    bodies = {item["bodyId"]: item for item in row["bodyProjection"]["bodies"]}
    masks = row["maskProjection"]["items"] if row["maskProjection"] else []
    for index, item in enumerate(masks):
        color = COLORS[index % len(COLORS)]
        body = bodies[item["bodyId"]]
        body_box = pixel_box(body["box"], *image.size)
        draw.rectangle(body_box, outline=(*color, 255), width=3)
        if item["mask"]:
            mask = decode_mask(item["mask"])
            mask_box = pixel_box(item["mask"]["box"], *image.size)
            mask = mask.resize(
                (max(1, mask_box[2] - mask_box[0]), max(1, mask_box[3] - mask_box[1])),
                Image.Resampling.NEAREST,
            )
            fill = Image.new("RGBA", mask.size, (*color, 96))
            overlay.paste(fill, (mask_box[0], mask_box[1]), mask)
        label = f"{index + 1} {item['state']} · {item['reason']}"
        text_box = draw.textbbox((0, 0), label)
        label_y = max(0, body_box[1] - (text_box[3] - text_box[1]) - 6)
        draw.rectangle(
            (body_box[0], label_y, body_box[0] + text_box[2] + 8, body_box[1]),
            fill=(0, 0, 0, 190),
        )
        draw.text((body_box[0] + 4, label_y + 2), label, fill=(255, 255, 255, 255))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    title_height = 52
    card = Image.new("RGB", (card_width, image.height + title_height), "#111318")
    card.paste(image, ((card_width - image.width) // 2, title_height))
    title = f"{row['caseId']} · {row['stratum']} · {len(masks)} masks"
    ImageDraw.Draw(card).text((14, 16), title, fill="white", font=ImageFont.load_default())
    return card


def render_mask_tiles(packet: dict, tile_width: int = 300, tile_height: int = 390) -> Image.Image:
    tiles = []
    for row in packet["rows"]:
        image = ImageOps.exif_transpose(Image.open(row["imagePath"])).convert("RGB")
        bodies = {item["bodyId"]: item for item in row["bodyProjection"]["bodies"]}
        masks = row["maskProjection"]["items"] if row["maskProjection"] else []
        for index, item in enumerate(masks):
            body = bodies[item["bodyId"]]
            x1, y1, x2, y2 = pixel_box(body["box"], *image.size)
            pad_x, pad_y = round((x2 - x1) * 0.12), round((y2 - y1) * 0.12)
            crop_box = (
                max(0, x1 - pad_x),
                max(0, y1 - pad_y),
                min(image.width, x2 + pad_x),
                min(image.height, y2 + pad_y),
            )
            overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
            if item["mask"]:
                mask = decode_mask(item["mask"])
                mask_box = pixel_box(item["mask"]["box"], *image.size)
                mask = mask.resize(
                    (
                        max(1, mask_box[2] - mask_box[0]),
                        max(1, mask_box[3] - mask_box[1]),
                    ),
                    Image.Resampling.NEAREST,
                )
                overlay.paste(
                    Image.new("RGBA", mask.size, (0, 220, 170, 112)),
                    (mask_box[0], mask_box[1]),
                    mask,
                )
            composed = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
            crop = composed.crop(crop_box)
            crop.thumbnail((tile_width, tile_height - 58), Image.Resampling.LANCZOS)
            tile = Image.new("RGB", (tile_width, tile_height), "#111318")
            tile.paste(crop, ((tile_width - crop.width) // 2, 42))
            title = f"{row['caseId']} · {index + 1}"
            metrics = item["metrics"]
            detail = f"area {metrics['maskAreaRatioToPrompt']:.2f} · inside {metrics['insideExpandedRatio']:.2f}"
            draw = ImageDraw.Draw(tile)
            draw.text((8, 8), title, fill="white")
            draw.text((8, 24), detail, fill="#aab2c2")
            tiles.append(tile)
    columns = 5
    gap = 10
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * tile_width + (columns + 1) * gap, rows * tile_height + (rows + 1) * gap),
        "#090b0f",
    )
    for index, tile in enumerate(tiles):
        x = gap + (index % columns) * (tile_width + gap)
        y = gap + (index // columns) * (tile_height + gap)
        sheet.paste(tile, (x, y))
    return sheet


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-dir", type=Path)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--mask-grid", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    packet = json.loads(args.input.read_text())
    if packet.get("schemaVersion") != "cimmich.body-mask-development-evaluation-private.v1":
        raise ValueError("Private QC packet schema is invalid")
    cards = [render_case(row) for row in packet["rows"]]
    if args.cards_dir:
        args.cards_dir.mkdir(parents=True, exist_ok=True)
        for row, card in zip(packet["rows"], cards):
            card.save(args.cards_dir / f"{row['caseId']}.png", optimize=True)
    columns = 3
    gap = 14
    rows = (len(cards) + columns - 1) // columns
    row_heights = [
        max(card.height for card in cards[index * columns : (index + 1) * columns])
        for index in range(rows)
    ]
    sheet = Image.new(
        "RGB",
        (columns * 720 + (columns + 1) * gap, sum(row_heights) + (rows + 1) * gap),
        "#090b0f",
    )
    y = gap
    for row_index in range(rows):
        x = gap
        for card in cards[row_index * columns : (row_index + 1) * columns]:
            sheet.paste(card, (x, y))
            x += 720 + gap
        y += row_heights[row_index] + gap
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, optimize=True)
    if args.mask_grid:
        args.mask_grid.parent.mkdir(parents=True, exist_ok=True)
        render_mask_tiles(packet).save(args.mask_grid, optimize=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
