"""Image inspection and diagnostics (FR-013, FR-025 partial)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

MAX_DIMENSION = 2048


def inspect_image(path: str | Path) -> dict:
    """Return dimensions, alpha, and color facts plus blocking issues."""
    path = Path(path)
    report: dict = {"path": str(path), "errors": [], "warnings": []}
    try:
        with Image.open(path) as img:
            img.load()
            report.update({
                "format": img.format,
                "mode": img.mode,
                "width": img.width,
                "height": img.height,
            })
            has_alpha = "A" in img.getbands()
            report["hasAlpha"] = has_alpha
            if has_alpha:
                alpha = img.getchannel("A")
                extrema = alpha.getextrema()
                report["alphaMin"] = extrema[0]
                report["alphaMax"] = extrema[1]
            small = img.convert("RGB").resize((64, 64))
            pixels = (small.get_flattened_data()
                      if hasattr(small, "get_flattened_data")
                      else small.getdata())
            report["colorCount64"] = len(set(pixels))
            # Exact distinct count up to 256, else sentinel 257 meaning "256+"
            # (Pillow adaptive palettes max out at 256 colors).
            full_colors = img.convert("RGB").getcolors(maxcolors=256)
            report["distinctColorsCapped257"] = (
                257 if full_colors is None else len(full_colors)
            )
    except FileNotFoundError:
        report["errors"].append("file not found")
        return report
    except Exception as exc:  # noqa: BLE001 - surfaced as data, not crash
        report["errors"].append(f"unreadable image: {exc}")
        return report
    if report["width"] <= 0 or report["height"] <= 0:
        report["errors"].append("image has zero width or height")
    if report["width"] > MAX_DIMENSION or report["height"] > MAX_DIMENSION:
        report["warnings"].append(
            f"image exceeds {MAX_DIMENSION}px on a side; downscale for 2D templates"
        )
    return report


def palette_report(path: str | Path, max_colors: int = 16) -> dict:
    """Small palette diagnostic for pixel-art review (FR-025)."""
    with Image.open(path) as img:
        small = img.convert("RGB").resize((64, 64))
        colors = sorted(small.getcolors(64 * 64), reverse=True)
    total = sum(count for count, _ in colors)
    top = [
        {"rgb": list(rgb), "share": round(count / total, 4)}
        for count, rgb in colors[:max_colors]
    ]
    return {
        "path": str(path),
        "sampledColors": len(colors),
        "topColors": top,
        "pixelArtHint": "ok" if len(colors) <= 64 else "many colors for pixel art",
    }
