"""Generate the extension icon set.

Draws a rounded-square badge with a white "#" glyph (matching the GitHub
accent blue) and exports PNGs at the sizes required by the Edge/Chrome stores.

Run:
    python tools/generate_icons.py
"""

import os
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 32, 48, 128]
BG = (9, 105, 218, 255)  # GitHub accent blue (#0969da)
FG = (255, 255, 255, 255)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "icons")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\seguisb.ttf",  # Segoe UI Semibold
    r"C:\Windows\Fonts\segoeuib.ttf",  # Segoe UI Bold
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]


def find_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def make_icon(size):
    # Render at 4x, then downsample for crisp anti-aliased edges.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = int(s * 0.22)
    draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    font = find_font(int(s * 0.72))
    text = "#"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (s - tw) / 2 - bbox[0]
    y = (s - th) / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=FG)

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        make_icon(size).save(path)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
