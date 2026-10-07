"""Draw the Accio app icons (the rounded ring with the gold spark and cursor, same geometry as
frontend/src/components/Wordmark.tsx) into frontend/public.

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
NAVY_HI, NAVY_LO = (24, 24, 62), (9, 10, 28)  # tile gradient, top-left to bottom-right
GOLD = (232, 176, 74, 255)
GOLD_HI = (246, 205, 124, 255)
PAPER = (241, 234, 219, 255)
SS = 4  # supersampling factor

# The mark in the box the artwork was measured in: x 65..795, y 48..808 (same numbers as Wordmark.tsx).
MARK_CENTER = (430.0, 428.0)
MARK_HEIGHT = 760.0
RING_CLIP = [
    [(40, 100), (507, 100), (396, 260), (396, 408), (40, 408)],
    [(40, 465), (396, 465), (396, 613), (507, 773), (40, 773)],
    [(760, 348), (640, 432), (640, 441), (760, 525)],
]
SPARK = [(640, 48), (795, 210), (640, 365), (490, 210)]  # tips; sides are quadratic curves bent toward the centre
SPARK_CENTER, SPARK_BEND = (640.0, 210.0), 16.0
CURSOR = [(515, 480), (783, 640), (675, 702), (590, 792)]
CURSOR_STROKE = 22.0


def _arc(cx, cy, r, a0, a1, n=48):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def _rrect(x0, y0, x1, y1, r):
    """Rounded rectangle outline, one corner radius on all four corners."""
    return (
        [(x0 + r, y0)]
        + _arc(x1 - r, y0 + r, r, -90, 0)
        + _arc(x1 - r, y1 - r, r, 0, 90)
        + _arc(x0 + r, y1 - r, r, 90, 180)
        + _arc(x0 + r, y0 + r, r, 180, 270)
    )


RING_OUTER = _rrect(65, 125, 742, 748, 200)
RING_INNER = _rrect(151, 211, 656, 662, 114)


def _spark_outline(n=24):
    cx, cy = SPARK_CENTER
    pts = []
    for i, (tx, ty) in enumerate(SPARK):
        nx, ny = SPARK[(i + 1) % 4]
        sx, sy = (1 if tx + nx > 2 * cx else -1), (1 if ty + ny > 2 * cy else -1)  # the quadrant between the two tips
        ctrl = (cx + sx * SPARK_BEND, cy + sy * SPARK_BEND)
        for k in range(n):
            t = k / n
            pts.append(((1 - t) ** 2 * tx + 2 * (1 - t) * t * ctrl[0] + t**2 * nx, (1 - t) ** 2 * ty + 2 * (1 - t) * t * ctrl[1] + t**2 * ny))
    return pts


def _gradient(size: int, box: tuple[float, float, float, float]) -> Image.Image:
    """Vertical GOLD_HI -> GOLD over `box` (the shape's bounding box), like the SVG objectBoundingBox gradient."""
    top, bottom = box[1], box[3]
    img = Image.new("RGBA", (size, size))
    px = ImageDraw.Draw(img)
    for y in range(size):
        t = min(1.0, max(0.0, (y - top) / max(1.0, bottom - top)))
        px.line((0, y, size, y), fill=tuple(round(a + (b - a) * t) for a, b in zip(GOLD_HI, GOLD)))
    return img


def mark(size: int, fraction: float, ring_color, spark_color=None) -> Image.Image:
    """The mark on a transparent square canvas; `fraction` is the mark's height as a share of the canvas.
    `spark_color` None paints the spark and cursor with the gold gradient."""
    big = size * SS
    scale = big * fraction / MARK_HEIGHT
    p = lambda pts: [(big / 2 + (x - MARK_CENTER[0]) * scale, big / 2 + (y - MARK_CENTER[1]) * scale) for x, y in pts]

    def mask(draw_fn) -> Image.Image:
        m = Image.new("L", (big, big), 0)
        draw_fn(ImageDraw.Draw(m))
        return m

    ring = mask(lambda d: d.polygon(p(RING_OUTER), fill=255))
    ring.paste(0, mask=mask(lambda d: d.polygon(p(RING_INNER), fill=255)))
    clip = mask(lambda d: [d.polygon(p(poly), fill=255) for poly in RING_CLIP])
    ring = Image.composite(ring, Image.new("L", (big, big), 0), clip)

    spark = mask(lambda d: d.polygon(p(_spark_outline()), fill=255))

    def cursor_draw(d: ImageDraw.ImageDraw) -> None:
        pts = p(CURSOR)
        w = CURSOR_STROKE * scale
        d.polygon(pts, fill=255)
        for a, b in zip(pts, pts[1:] + pts[:1]):
            d.line((a, b), fill=255, width=round(w))
        for x, y in pts:
            d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=255)

    cursor = mask(cursor_draw)

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (big, big), ring_color), mask=ring)
    for shape in (spark, cursor):
        fill = Image.new("RGBA", (big, big), spark_color) if spark_color else _gradient(big, shape.getbbox())
        img.paste(fill, mask=shape)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def tile(size: int, fraction: float, rounded: bool) -> Image.Image:
    big = size * SS
    grad = Image.new("RGBA", (big, big))
    gd = ImageDraw.Draw(grad)
    for i in range(2 * big):  # diagonal bands
        t = i / (2 * big - 1)
        gd.line((i, 0, 0, i), fill=tuple(round(a + (b - a) * t) for a, b in zip(NAVY_HI, NAVY_LO)) + (255,), width=2)
    corner = Image.new("L", (big, big), 0)
    ImageDraw.Draw(corner).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.22) if rounded else 0, fill=255)
    bg = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    bg.paste(grad, mask=corner)
    if rounded:  # thin gold rim
        ImageDraw.Draw(bg).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * 0.22), outline=GOLD[:3] + (120,), width=max(2, big // 128))
    bg = bg.resize((size, size), Image.Resampling.LANCZOS)
    bg.alpha_composite(mark(size, fraction, PAPER))
    return bg


FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#18183e"/><stop offset="1" stop-color="#090a1c"/></linearGradient>'
    '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6cd7c"/><stop offset="1" stop-color="#e8b04a"/></linearGradient>'
    '<clipPath id="c"><polygon points="40,100 507,100 396,260 396,408 40,408"/><polygon points="40,465 396,465 396,613 507,773 40,773"/>'
    '<polygon points="760,348 640,432 640,441 760,525"/></clipPath></defs>'
    '<rect width="100" height="100" rx="22" fill="url(#t)"/>'
    '<g transform="translate(50 50) scale(0.0763) translate(-430 -428)">'
    '<path clip-path="url(#c)" fill="#f1eadb" fill-rule="evenodd" d="'
    "M265 125H542A200 200 0 0 1 742 325V548A200 200 0 0 1 542 748H265A200 200 0 0 1 65 548V325A200 200 0 0 1 265 125Z"
    'M265 211H542A114 114 0 0 1 656 325V548A114 114 0 0 1 542 662H265A114 114 0 0 1 151 548V325A114 114 0 0 1 265 211Z"/>'
    '<path fill="url(#g)" d="M640 48Q656 194 795 210Q656 226 640 365Q624 226 490 210Q624 194 640 48Z"/>'
    '<path fill="url(#g)" stroke="url(#g)" stroke-width="22" stroke-linejoin="round" d="M515 480L783 640L675 702L590 792Z"/>'
    "</g></svg>\n"
)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tile(512, 0.58, True).save(OUT / "icon-512.png")
    tile(192, 0.58, True).save(OUT / "icon-192.png")
    tile(512, 0.48, False).save(OUT / "maskable-512.png")  # inside the 80% safe zone even after the circle crop
    tile(180, 0.54, False).save(OUT / "apple-touch-icon.png")
    mark(512, 0.62, (255, 255, 255, 255), (255, 255, 255, 255)).save(OUT / "monochrome-512.png")
    (OUT / "favicon.svg").write_text(FAVICON, encoding="utf-8")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
