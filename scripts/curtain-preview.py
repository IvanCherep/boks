#!/usr/bin/env python3
"""Curtain link previews, offline: a still poster and a short loop per card.

    python3 scripts/curtain-preview.py cards.json --out DIR [--video]

Every published bok gets its curtain card from the app itself
(`lib/boks/curtain.tsx`, `/b/<id>/image`) and its loop from the server job
(`deploy/curtain/`). This script is for cards outside the catalogue, such as
an author's portrait card (`authorPortraits[].share` and `shareLoop`), and for
trying a design. `cards.json` is a list of descriptors:

    {"key": "prokhorov-curtain-share", "title": "Алексей Прохоров",
     "byline": "@prokhorov", "art": "/path/portrait.png", "focus": [1, 0.5]}

`art` may be missing (a neutral background), `byline` may be missing (no line),
`cropTop` (a share of the scaled art's height) or `focus` [x, y] places the
art. It writes `<key>.jpg` (1200x630) and with `--video` `<key>.mp4` (960x504,
10 s, 30 fps, silent). The shared layers - curtain, yellow bar, knob, the word
boks - are in `public/share/curtain/`.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
LAYERS = ROOT / "public/share/curtain"
TITLE_FONT = ROOT / "public/share/fonts/boks-preview-serif-450.ttf"
BYLINE_FONT = ROOT / "public/share/fonts/noto-sans.ttf"
STAGE = 1920
ART_LEFT = 352  # the art starts here, always under the curtain
INK = "#f7f6ef"
NEUTRAL = "#1c242a"
POSTER = (1200, 630)
LOOP = (960, 504)
FPS, FRAMES = 30, 300


def clamp(value, lower, upper):
    return min(upper, max(lower, value))


def phase(frame: int) -> int:
    """0 is open, 84 closed: open, close, hold, open again, hold (timeline.json)."""
    return clamp(frame - 45 if frame < 141 else 225 - frame, 0, 84)


def background(card: dict, size: tuple[int, int]) -> Image.Image:
    width, height = size
    left = round(width * ART_LEFT / STAGE)
    region = width - left
    canvas = Image.new("RGBA", size, NEUTRAL)
    if not card.get("art"):
        return canvas
    try:
        art = ImageOps.exif_transpose(Image.open(card["art"])).convert("RGB")
    except (OSError, ValueError):
        return canvas  # a broken picture gets the neutral card, not a failed run
    scale = max(region / art.width, height / art.height)
    art = art.resize((max(region, round(art.width * scale)), max(height, round(art.height * scale))), Image.Resampling.LANCZOS)
    fx, fy = card.get("focus", (0.5, 0.5))
    travel_x, travel_y = art.width - region, art.height - height
    x = round(clamp(travel_x * fx, 0, travel_x))
    # cropTop is a share of the scaled art's full height, not a CSS object-position
    y = round(clamp(card["cropTop"] * art.height if "cropTop" in card else travel_y * fy, 0, travel_y))
    canvas.paste(art.crop((x, y, x + region, y + height)), (left, 0))
    return canvas


def graphemes(text: str) -> list[str]:
    units: list[str] = []
    for char in text:
        if units and unicodedata.combining(char):
            units[-1] += char
        else:
            units.append(char)
    return units


def width_of(text: str, font, tracking: float) -> float:
    return font.getlength(text) + max(0, len(graphemes(text)) - 1) * tracking


def fit(text: str, font, tracking: float, maximum: float) -> str:
    """The text, or as much of it as fits with an ellipsis - at a word if one is near."""
    if width_of(text, font, tracking) <= maximum:
        return text
    units = graphemes(text)
    while units and width_of("".join(units).rstrip() + "…", font, tracking) > maximum:
        units.pop()
    cut = "".join(units)
    word = cut.rsplit(" ", 1)[0]
    if " " in cut and len(word) > len(cut) * 0.6:
        cut = word
    return cut.rstrip(" ,.;:-–—") + "…"


def title_lines(text: str, scale: float, preferred: int):
    maximum = 1183 * scale
    for point in range(preferred, 71, -2):
        font = ImageFont.truetype(str(TITLE_FONT), round(point * scale))
        tracking = -font.size * 0.045
        if width_of(text, font, tracking) <= maximum:
            return [text], font, tracking
    # still too long at the smallest size: two lines, the second ending in an ellipsis
    font = ImageFont.truetype(str(TITLE_FONT), round(74 * scale))
    tracking = -font.size * 0.045
    words, first = text.split(), ""
    while words and width_of(" ".join(filter(None, (first, words[0]))), font, tracking) <= maximum:
        first = " ".join(filter(None, (first, words.pop(0))))
    if not first:  # one word longer than the line
        return [fit(text, font, tracking, maximum)], font, tracking
    return [first, fit(" ".join(words), font, tracking, maximum)] if words else [first], font, tracking


def draw_line(draw, text, x, y, font, tracking):
    bbox = font.getbbox(text, anchor="la")
    left, origin = x - bbox[0], y - bbox[1]
    prefix = ""
    for i, unit in enumerate(graphemes(text)):
        advance = font.getlength(prefix + unit) - font.getlength(unit)  # keeps kerning
        draw.text((left + advance + tracking * i, origin), unit, font=font, fill=255, anchor="la")
        prefix += unit


def typography(card: dict, size: tuple[int, int]) -> Image.Image:
    scale = size[0] / STAGE
    lines, font, tracking = title_lines(" ".join(card["title"].split()), scale, card.get("titleSize", 106))
    mask = Image.new("L", size)
    draw = ImageDraw.Draw(mask)
    top, step = round((784 + 0.30 * (font.size / scale)) * scale), round(font.size * 0.96)
    for i, line in enumerate(lines):
        draw_line(draw, line, round(76 * scale), top - (len(lines) - 1 - i) * step, font, tracking)
    if card.get("byline"):
        sans = ImageFont.truetype(str(BYLINE_FONT), round(34 * scale))
        draw_line(draw, fit(" ".join(card["byline"].split()), sans, 0, 1183 * scale), round(81 * scale), round(934 * scale), sans, 0)
    shadow_mask = Image.new("L", size)
    shadow_mask.paste(mask, (0, max(1, round(3 * scale))))
    shadow = Image.new("RGBA", size, "#0b0807")
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(5 * scale)).point(lambda v: round(v * 0.75)))
    ink = Image.new("RGBA", size, INK)
    ink.putalpha(mask)
    return Image.alpha_composite(shadow, ink)


def poster(card: dict, path: Path):
    overlay = Image.open(LAYERS / "overlay-1200x630.png").convert("RGBA")
    image = Image.alpha_composite(Image.alpha_composite(background(card, POSTER), overlay), typography(card, POSTER))
    image.convert("RGB").save(path, quality=85, optimize=True, progressive=True, subsampling=1)


def loop(card: dict, path: Path, crf: int):
    art, text = background(card, LOOP), typography(card, LOOP)
    args = ["ffmpeg", "-y", "-nostdin", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", f"{LOOP[0]}x{LOOP[1]}", "-framerate", str(FPS), "-i", "-", "-an",
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(path)]
    cache: dict[int, bytes] = {}
    with subprocess.Popen(args, stdin=subprocess.PIPE) as ffmpeg:
        assert ffmpeg.stdin is not None
        for n in range(FRAMES):
            index = phase(n)
            if index not in cache:
                with Image.open(LAYERS / f"phases/phase-{index:03d}.webp") as plate:
                    cache[index] = Image.alpha_composite(Image.alpha_composite(art, plate.convert("RGBA")), text).convert("RGB").tobytes()
            ffmpeg.stdin.write(cache[index])
        ffmpeg.stdin.close()
        if ffmpeg.wait() != 0:
            raise RuntimeError(f"ffmpeg failed for {path.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cards", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--video", action="store_true")
    parser.add_argument("--crf", type=int, default=26, help="x264 quality; 26 keeps a loop near 0.4-0.6 MB with clean velvet")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for card in json.loads(args.cards.read_text()):
        poster(card, args.out / f"{card['key']}.jpg")
        made = [args.out / f"{card['key']}.jpg"]
        if args.video:
            loop(card, args.out / f"{card['key']}.mp4", args.crf)
            made.append(args.out / f"{card['key']}.mp4")
        print("  ".join(f"{p.name} {p.stat().st_size // 1024} KB" for p in made))


if __name__ == "__main__":
    main()
