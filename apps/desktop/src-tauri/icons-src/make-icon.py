"""Generate the KGSM app icon source (1024px, deterministic, no font files).

Violet-to-cyan gradient rounded square (dashboard mockup palette) with a bold
geometric white K. Run: .venv/Scripts/python apps/desktop/src-tauri/icons-src/make-icon.py
Then: npx tauri icon apps/desktop/src-tauri/icons-src/kgsm-icon.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT = Path(__file__).parent / "kgsm-icon.png"


def main() -> None:
    grad = Image.new("RGB", (1, SIZE))
    top = (124, 92, 255)
    bottom = (34, 211, 238)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        grad.putpixel((0, y), tuple(round(a + (b - a) * t)
                                       for a, b in zip(top, bottom)))
    img = grad.resize((SIZE, SIZE)).convert("RGBA")

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1],
                                           radius=220, fill=255)
    img.putalpha(mask)

    draw = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    w = 140
    stem_x, y0, y1, mid = 380, 280, 744, 512
    draw.line([(stem_x, y0), (stem_x, y1)], fill=white, width=w, joint="curve")
    draw.line([(stem_x + 30, mid), (660, y0)], fill=white, width=w,
              joint="curve")
    draw.line([(stem_x + 30, mid), (680, y1)], fill=white, width=w,
              joint="curve")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
