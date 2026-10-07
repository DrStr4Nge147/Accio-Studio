"""Draw the Accio app icons (the open ring with the gold spark, design/proposal.html #ring) into frontend/public.

Run again after changing the mark:  env\\Scripts\\python.exe scripts\\make_icons.py
Outputs: icon-192.png, icon-512.png (rounded, "any"), maskable-512.png (full bleed, safe zone), monochrome-512.png,
apple-touch-icon.png (180, full bleed) and favicon.svg.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public"
INK = (11, 10, 15, 255)
GOLD = (232, 176, 74, 255)
PAPER = (241, 234, 219, 255)
SS = 4  # supersampling factor

# The mark in a 0-100 box (same geometry as components/Wordmark.tsx Ring).
CENTER, RADIUS, STROKE = (50.0, 50.0), 40.0, 11.0
ARC_FROM, ARC_TO = 2.9, 320.9  # degrees, clockwise from 3 o'clock: the ring is open between -39.1 and 2.9
SPARK = [(92, 14), (95.6, 23.4), (105, 27), (95.6, 30.6), (92, 40), (88.4, 30.6), (79, 27), (88.4, 23.4)]
SPARK_SHIFT = -14.0
MARK_CENTER = (50.0, 55.0)  # centre of the mark's visual extent, so it sits in the middle of the icon


def mark(size: int, fraction: float, ring_color, spark_color) -> Image.Image:
    """The mark on a transparent square canvas; `fraction` is the ring's diameter as a share of the canvas."""
    big = size * SS
    scale = big * fraction / (2 * RADIUS + STROKE)
    ox, oy = big / 2 - MARK_CENTER[0] * scale, big / 2 - MARK_CENTER[1] * scale
    p = lambda x, y: (ox + x * scale, oy + y * scale)
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = p(*CENTER)
    r = RADIUS * scale
    w = max(1, round(STROKE * scale))
    outer = r + w / 2  # PIL draws the stroke inwards from the box, so grow the box to centre the stroke on the radius
    d.arc((cx - outer, cy - outer, cx + outer, cy + outer), ARC_FROM, ARC_TO, fill=ring_color, width=w)
    for a in (ARC_FROM, ARC_TO):  # round caps
        ex, ey = cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))
        d.ellipse((ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2), fill=ring_color)
    d.polygon([p(x + SPARK_SHIFT, y) for x, y in SPARK], fill=spark_color)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def tile(size: int, fraction: float, rounded: bool) -> Image.Image:
    big = size * SS
    bg = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.22) if rounded else 0, fill=INK)
    bg = bg.resize((size, size), Image.Resampling.LANCZOS)
    bg.alpha_composite(mark(size, fraction, PAPER, GOLD))
    return bg


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tile(512, 0.62, True).save(OUT / "icon-512.png")
    tile(192, 0.62, True).save(OUT / "icon-192.png")
    tile(512, 0.50, False).save(OUT / "maskable-512.png")  # inside the 80% safe zone even after the circle crop
    tile(180, 0.58, False).save(OUT / "apple-touch-icon.png")
    mark(512, 0.62, (255, 255, 255, 255), (255, 255, 255, 255)).save(OUT / "monochrome-512.png")
    (OUT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" rx="22" fill="#0b0a0f"/>'
        '<g transform="translate(50 50) scale(0.62) translate(-50 -55)">'
        '<path d="M82 24A40 40 0 1 0 90 52" fill="none" stroke="#f1eadb" stroke-width="11" stroke-linecap="round"/>'
        '<path d="M92 14l3.6 9.4L105 27l-9.4 3.6L92 40l-3.6-9.4L79 27l9.4-3.6z" transform="translate(-14 0)" fill="#e8b04a"/>'
        "</g></svg>\n",
        encoding="utf-8",
    )
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
