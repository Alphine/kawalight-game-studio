"""Asset import, organization, sprite slicing, generation capture.

Layout under a project dir (FR-011):
  assets/<entity>/[<animation>/]<role>-<stem>.<ext> + sidecar .meta.json
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image

from .. import paths as paths_mod
from ..providers.base import GeneratedImage

IMPORT_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


class AssetError(Exception):
    pass


def _check_import_src(src: Path) -> Path:
    """Reject symlink escapes and worker-store reads for asset imports."""
    if src.is_symlink():
        raise AssetError(f"import source must not be a symlink: {src}")
    real = src.resolve()
    # The worker data dir holds secrets.json, the DB, and backups: never
    # let an import pull those bytes into a project (and then an export).
    # (Cross-project imports stay allowed; same-user local data.)
    try:
        data_root = paths_mod.data_dir().resolve()
    except OSError:
        data_root = None
    if data_root is not None and (
            real == data_root or data_root in real.parents):
        raise AssetError("import source must not live under the worker "
                         "data dir")
    return real


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_meta(dest: Path, meta: dict) -> dict:
    with Image.open(dest) as img:
        img.load()
        meta.update({
            "width": img.width,
            "height": img.height,
            "mode": img.mode,
            "sha256": _sha256_file(dest),
        })
    meta_path = dest.with_suffix(dest.suffix + ".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def import_asset(
    project_dir: str | Path, src: str | Path, *, entity: str, role: str,
    animation: str | None = None,
) -> dict:
    """Copy a local image into the project's asset library (FR-010/FR-011)."""
    project_dir, src = Path(project_dir), Path(src)
    _check_import_src(src)
    if src.suffix.lower() not in IMPORT_EXTS:
        raise AssetError(
            f"unsupported import {src.suffix!r}; expected one of"
            f" {sorted(IMPORT_EXTS)}"
        )
    if not src.is_file():
        raise AssetError(f"import source not found: {src}")
    folder = project_dir / "assets" / entity
    if animation:
        folder /= animation
    folder.mkdir(parents=True, exist_ok=True)
    # Never silently overwrite: first import keeps the canonical name,
    # re-imports get a unique suffix.
    dest = folder / f"{role}-{src.stem}{src.suffix.lower()}"
    if dest.exists():
        stem = f"{role}-{src.stem}"
        suffix = src.suffix.lower()
        n = 1
        while (folder / f"{stem}-{n:02d}{suffix}").exists():
            n += 1
        dest = folder / f"{stem}-{n:02d}{suffix}"
    shutil.copy2(src, dest)
    return {
        "path": str(dest.relative_to(project_dir)),
        "meta": _write_meta(dest, {
            "source": "imported",
            "entity": entity,
            "role": role,
            "animation": animation,
        }),
    }


def save_generated(
    project_dir: str | Path, generated: GeneratedImage, *, entity: str,
    role: str, prompt: str, provider_id: str, seed: int | None = None,
) -> dict:
    """Store a provider image with full provenance (FR-006, FR-018)."""
    project_dir = Path(project_dir)
    folder = project_dir / "assets" / entity
    folder.mkdir(parents=True, exist_ok=True)
    # Unique-suffix numbering (no len(existing) overwrite/race).
    n = len(sorted(folder.glob(f"{role}-gen-*.png")))
    dest = folder / f"{role}-gen-{n:03d}.png"
    while dest.exists():
        n += 1
        dest = folder / f"{role}-gen-{n:03d}.png"
    dest.write_bytes(generated.png_bytes)
    return {
        "path": str(dest.relative_to(project_dir)),
        "meta": _write_meta(dest, {
            "source": "generated",
            "entity": entity,
            "role": role,
            "prompt": prompt,
            "provider": provider_id,
            "model": generated.model,
            "seed": seed,
        }),
    }


def slice_sheet(
    sheet: str | Path, *, frame_width: int, frame_height: int,
    columns: int | None = None, rows: int | None = None,
    margin: int = 0, spacing: int = 0,
) -> list[dict]:
    """Slice a sprite sheet into frames (FR-012). Returns frame geometries."""
    if frame_width < 1 or frame_height < 1:
        raise AssetError("frame dimensions must be >= 1")
    with Image.open(sheet) as img:
        sheet_w, sheet_h = img.size
    usable_w = sheet_w - 2 * margin
    usable_h = sheet_h - 2 * margin
    auto_cols = (usable_w + spacing) // (frame_width + spacing)
    auto_rows = (usable_h + spacing) // (frame_height + spacing)
    columns = auto_cols if columns is None else columns
    rows = auto_rows if rows is None else rows
    if columns < 1 or rows < 1:
        raise AssetError("sheet is smaller than one frame")
    need_w = columns * frame_width + (columns - 1) * spacing + 2 * margin
    need_h = rows * frame_height + (rows - 1) * spacing + 2 * margin
    if need_w > sheet_w or need_h > sheet_h:
        raise AssetError(
            f"frame grid {columns}x{rows} of {frame_width}x{frame_height}"
            f" does not fit sheet {sheet_w}x{sheet_h}"
        )
    frames = []
    for r in range(rows):
        for c in range(columns):
            frames.append({
                "index": r * columns + c,
                "x": margin + c * (frame_width + spacing),
                "y": margin + r * (frame_height + spacing),
                "width": frame_width,
                "height": frame_height,
            })
    return frames


def save_frames(
    project_dir: str | Path, sheet: str | Path, *, entity: str,
    animation: str, frame_rate: int, **grid,
) -> dict:
    """Slice a sheet and persist frames + animation.json (FR-012)."""
    if frame_rate < 1 or frame_rate > 60:
        raise AssetError("frame_rate must be 1..60")
    project_dir, sheet = Path(project_dir), Path(sheet)
    frames = slice_sheet(sheet, **grid)
    folder = project_dir / "assets" / entity / animation
    folder.mkdir(parents=True, exist_ok=True)
    # Clear prior slices first so re-slicing with fewer frames leaves no
    # stale frame-*.png files beside the new animation.json.
    for stale in sorted(folder.glob("frame-*.png")):
        try:
            stale.unlink()
        except OSError:
            pass
    with Image.open(sheet) as img:
        img.load()
        names = []
        for f in frames:
            crop = img.crop((f["x"], f["y"], f["x"] + f["width"], f["y"] + f["height"]))
            name = f"frame-{f['index']:03d}.png"
            crop.save(folder / name)
            names.append(name)
    anim = {
        "animation": animation,
        "entity": entity,
        "frameRate": frame_rate,
        "frames": names,
        "grid": grid,
    }
    (folder / "animation.json").write_text(json.dumps(anim, indent=2), encoding="utf-8")
    return anim
