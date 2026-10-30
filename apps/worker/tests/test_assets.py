"""Asset pipeline tests (FR-010..FR-013)."""

import json

import pytest
from PIL import Image

from kgsm.assets import (
    AssetError,
    import_asset,
    inspect_image,
    palette_report,
    save_frames,
    save_generated,
    slice_sheet,
)
from kgsm.providers import MockProvider


def make_image(path, size=(64, 32), mode="RGB", fmt="PNG"):
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new(mode, size, (10, 120, 200))
    if mode == "RGBA":
        px = img.load()
        for x in range(size[0] // 2):
            for y in range(size[1]):
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    img.save(path, format=fmt)
    return path


def test_import_supported_formats(store):
    project_dir = store["projects_dir"] / "p1"
    for ext, fmt in ((".png", "PNG"), (".jpg", "JPEG"), (".webp", "WEBP")):
        src = make_image(store["projects_dir"] / f"s{ext}", fmt=fmt)
        rec = import_asset(project_dir, src, entity="ship", role="body")
        dest = project_dir / rec["path"]
        assert dest.exists()
        assert rec["meta"]["source"] == "imported"
        assert rec["meta"]["sha256"]
        assert (dest.parent / (dest.name + ".meta.json")).exists()


def test_import_rejects_formats_and_missing(store):
    project_dir = store["projects_dir"] / "p1"
    src = make_image(store["projects_dir"] / "s.gif", fmt="GIF")
    with pytest.raises(AssetError):
        import_asset(project_dir, src, entity="ship", role="body")
    with pytest.raises(AssetError):
        import_asset(project_dir, store["projects_dir"] / "missing.png",
                     entity="ship", role="body")


def test_save_generated_keeps_provenance(store):
    project_dir = store["projects_dir"] / "p1"
    gen = MockProvider().generate("ship", style="pixel-art", width=32,
                                  height=32, seed=3)[0]
    rec = save_generated(project_dir, gen, entity="ship", role="body",
                         prompt="ship", provider_id="mock", seed=3)
    meta = json.loads(((project_dir / rec["path"]).parent
                       / ((project_dir / rec["path"]).name + ".meta.json"))
                      .read_text(encoding="utf-8"))
    assert meta["source"] == "generated"
    assert meta["provider"] == "mock"
    assert meta["model"] == "mock-1"
    assert meta["prompt"] == "ship"
    assert meta["seed"] == 3


def test_slice_sheet_exact_and_bad_grid(store):
    sheet = make_image(store["projects_dir"] / "sheet.png", size=(64, 32))
    frames = slice_sheet(sheet, frame_width=16, frame_height=16)
    assert len(frames) == 8
    assert frames[0] == {"index": 0, "x": 0, "y": 0, "width": 16, "height": 16}
    with pytest.raises(AssetError):
        slice_sheet(sheet, frame_width=16, frame_height=16, columns=9)


def test_save_frames_writes_animation(store):
    project_dir = store["projects_dir"] / "p1"
    sheet = make_image(store["projects_dir"] / "sheet.png", size=(64, 32))
    anim = save_frames(project_dir, sheet, entity="ship", animation="fly",
                       frame_rate=10, frame_width=16, frame_height=16)
    assert anim["frameRate"] == 10
    assert len(anim["frames"]) == 8
    folder = project_dir / "assets" / "ship" / "fly"
    assert (folder / "animation.json").exists()
    assert all((folder / n).exists() for n in anim["frames"])
    with pytest.raises(AssetError):
        save_frames(project_dir, sheet, entity="ship", animation="bad",
                    frame_rate=0, frame_width=16, frame_height=16)


def test_inspect_reports_alpha_and_dimensions(store):
    rgb = make_image(store["projects_dir"] / "rgb.png")
    rgba = make_image(store["projects_dir"] / "rgba.png", mode="RGBA")
    assert inspect_image(rgb)["errors"] == []
    assert inspect_image(rgb)["hasAlpha"] is False
    rep = inspect_image(rgba)
    assert rep["errors"] == []
    assert rep["hasAlpha"] is True
    assert rep["alphaMin"] == 0
    assert rep["width"] == 64
    missing = inspect_image(store["projects_dir"] / "nope.png")
    assert missing["errors"]


def test_inspect_counts_distinct_colors_capped(store):
    solid = make_image(store["projects_dir"] / "solid.png")
    rep = inspect_image(solid)
    assert rep["errors"] == []
    assert rep["distinctColorsCapped257"] == 1
    # Gradient/noise exceeds the cap -> sentinel 257, still no errors.
    busy = Image.new("RGB", (64, 64))
    busy.putdata([(x * 4 % 256, y * 4 % 256, (x + y) % 256)
                  for y in range(64) for x in range(64)])
    busy_path = store["projects_dir"] / "busy.png"
    busy.save(busy_path)
    rep2 = inspect_image(busy_path)
    assert rep2["errors"] == []
    assert rep2["distinctColorsCapped257"] == 257


def test_palette_report_bounds_output(store):
    img = make_image(store["projects_dir"] / "pal.png")
    rep = palette_report(img, max_colors=4)
    assert len(rep["topColors"]) <= 4
    assert rep["pixelArtHint"] in ("ok", "many colors for pixel art")
