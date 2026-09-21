#!/usr/bin/env python3
"""Every icon and share image boks serves, built from one master.

    python3 scripts/build-brand-assets.py

Input is `assets/brand/boks-logo.png` - the logo as delivered, kept at 1024px
because nothing generated from it is larger than 512 and the original was 11 MB.
Output goes to `public/`, which the Worker serves as static assets.

Two decisions worth keeping:

* **The tab icon is a PNG, not the SVG that used to be there.** A wordmark
  stacked in three rows is unreadable at 16px whatever the format; the PNGs are
  rendered with Lanczos from the master so the shapes stay legible, and the
  `.ico` carries 16/32/48 for the browsers that still ask for one - Yandex
  Browser among them.
* **The share image is 1200x630, built rather than cropped.** Telegram, WhatsApp
  and Slack give a wide image a large preview and a square one a thumbnail, and
  a centre crop of this logo would cut the wordmark in half. So the background
  is the logo's own gradient, sampled from a corner where there is no text and
  blown up, and the logo tile sits on it whole.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parent.parent
master_path = root / "assets" / "brand" / "boks-logo.png"
public = root / "public"

master = Image.open(master_path).convert("RGBA")

# Square icons. `apple-touch-icon` is flattened: iOS composites transparency
# onto black, and this logo has an opaque background anyway.
icons = {
    "favicon-16.png": 16,
    "favicon-32.png": 32,
    "favicon-48.png": 48,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "apple-touch-icon.png": 180,
}

for name, size in icons.items():
    icon = master.resize((size, size), Image.LANCZOS)
    if name == "apple-touch-icon.png":
        flat = Image.new("RGB", (size, size), (255, 120, 73))
        flat.paste(icon, (0, 0), icon)
        icon = flat
    icon.save(public / name, optimize=True)
    print(f"{name:24} {size}x{size}")

# One .ico with the three sizes a browser may ask for.
master.resize((48, 48), Image.LANCZOS).save(
    public / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
)
print(f"{'favicon.ico':24} 16/32/48")


def rounded(image: Image.Image, radius: int) -> Image.Image:
    """The tile, with the corner radius the logo is drawn with."""
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (image.width - 1, image.height - 1)], radius, fill=255)
    out = image.copy()
    out.putalpha(mask)
    return out


def share_cover(width: int = 1200, height: int = 630, tile: int = 470) -> Image.Image:
    """The gradient of the logo, with the logo on it."""
    # The strip above the wordmark: gradient across the full width, and no
    # letters in it. The first attempt cropped a corner box that clipped the top
    # of the "B", and blurring it left a dark smudge in the finished cover.
    letters_start = int(master.height * 0.1)
    corner = master.crop((0, 0, master.width, letters_start)).convert("RGB")
    background = corner.resize((width, height), Image.BICUBIC).filter(ImageFilter.GaussianBlur(28))

    # A soft shadow, so the tile reads as a tile rather than a paste.
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shadow_box = ((width - tile) // 2, (height - tile) // 2, (width + tile) // 2, (height + tile) // 2)
    ImageDraw.Draw(shadow).rounded_rectangle(shadow_box, tile // 8, fill=(90, 30, 0, 90))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    background = Image.alpha_composite(background.convert("RGBA"), shadow)

    logo = rounded(master.resize((tile, tile), Image.LANCZOS), tile // 8)
    background.paste(logo, (shadow_box[0], shadow_box[1]), logo)
    return background.convert("RGB")


cover = share_cover()
cover.save(public / "og-cover.png", optimize=True)
print(f"{'og-cover.png':24} {cover.width}x{cover.height}")
