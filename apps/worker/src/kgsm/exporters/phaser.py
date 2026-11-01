"""Phaser/HTML5 export adapter (FR-014/FR-017/FR-030, NFR-002/003/006).

Builds into a temp staging dir and only publishes finished ZIPs, so a failed
export can never corrupt the last successful build (NFR-003).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from .. import paths
from ..validation import (
    validate_battle_2d_config,
    validate_endless_runner_config,
    validate_farming_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)
from .manifest import (
    assert_no_secrets_in_dir,
    build_manifest,
    sha256_hex,
)


class ExportError(Exception):
    pass


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "game"


def _read_json(path: Path, what: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ExportError(f"{what} not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise ExportError(f"{what} is not valid JSON: {exc}") from None


def _copy_tree(src: Path, dest: Path) -> list[Path]:
    if not src.is_dir():
        raise ExportError(f"template dir missing: {src}")
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    for item in sorted(src.rglob("*")):
        if item.is_file():
            rel = item.relative_to(src)
            target = dest / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            copied.append(target)
    return copied


def _collect_assets(staged_assets: Path, project_dir: Path) -> list[dict]:
    """Merge starter assets with project provenance sidecars."""
    entries = []
    if not staged_assets.is_dir():
        return entries
    for f in sorted(staged_assets.rglob("*")):
        if not f.is_file() or f.suffix == ".json" and f.name.endswith(".meta.json"):
            continue
        if f.name.endswith(".meta.json"):
            continue
        rel = f.relative_to(staged_assets).as_posix()
        entry: dict = {
            "path": f"assets/{rel}",
            "sha256": sha256_hex(f.read_bytes()),
            "role": f.stem,
            "source": "starter",
            "provider": None, "model": None, "prompt": None, "seed": None,
        }
        # Project copy overrides starter: resolve the project-side
        # sidecar by relative path (exact file, no bare-filename rglob,
        # so glob metachars in names cannot match the wrong sidecar).
        sidecar = project_dir / "assets" / rel
        meta_file = sidecar.with_suffix(sidecar.suffix + ".meta.json")
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8")) \
                if meta_file.is_file() else None
        except (OSError, json.JSONDecodeError):
            meta = None
        if isinstance(meta, dict) and \
                meta.get("source") in ("imported", "generated"):
            entry.update({
                "role": str(meta.get("role", entry["role"])),
                "source": meta["source"],
                "provider": meta.get("provider"),
                "model": meta.get("model"),
                "prompt": meta.get("prompt"),
                "seed": meta.get("seed"),
            })
        entries.append(entry)
    return entries


def stage_export(
    *, project_name: str, genre: str, config: dict, project_dir: str | Path,
    template_dir: str | Path | None = None,
    runtime_dir: str | Path | None = None,
    out_dir: str | Path, variant: str = "playable",
) -> dict:
    if variant not in ("playable", "source"):
        raise ExportError(f"unknown variant {variant!r}")
    project_dir = Path(project_dir)
    out_dir = Path(out_dir)
    _template = config.get("template")
    template_id = _template.get("id", "") \
        if isinstance(_template, dict) else ""
    if template_id == "phaser.space-shooter":
        validate = validate_space_shooter_config
        default_template = "space-shooter"
    elif template_id == "phaser.endless-runner":
        validate = validate_endless_runner_config
        default_template = "endless-runner"
    elif template_id == "phaser.side-scroller":
        validate = validate_side_scroller_config
        default_template = "side-scroller"
    elif template_id == "phaser.battle-2d":
        validate = validate_battle_2d_config
        default_template = "battle-2d"
    elif template_id == "phaser.farming":
        validate = validate_farming_config
        default_template = "farming"
    else:
        raise ExportError(f"unknown template id {template_id!r}")
    template_dir = Path(template_dir or
                        paths.templates_dir() / "phaser" / default_template)
    runtime_dir = Path(runtime_dir or paths.templates_dir() / "phaser" / "runtime")

    report = validate(config)
    if not report.ok:
        raise ExportError(f"config invalid: {report.summary()}; "
                          + "; ".join(i.message for i in report.errors()[:5]))
    template_meta = _read_json(template_dir / "template.json", "template.json")
    if template_meta.get("id") != template_id:
        raise ExportError(
            f"template.json id {template_meta.get('id')!r} does not match"
            f" config template {template_id!r}")

    warnings = [f"config: {i.message}" for i in report.warnings()]
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    index_src = template_dir / "demo" / "index.html"
    if not index_src.is_file():
        raise ExportError(f"template entry missing: {index_src}")
    shutil.copy2(index_src, out_dir / "index.html")
    _copy_tree(runtime_dir, out_dir / "js" / "runtime")
    _copy_tree(template_dir / "src", out_dir / "js" / "game")

    vendor = paths.templates_dir() / "phaser" / "vendor" / "phaser.min.js"
    if vendor.is_file():
        dest = out_dir / "js" / "vendor" / "phaser.min.js"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(vendor, dest)
    else:
        warnings.append("phaser.min.js not vendored; export uses CDN fallback")

    staged_assets = out_dir / "assets"
    template_assets = template_dir / "assets"
    if template_assets.is_dir():
        _copy_tree(template_assets, staged_assets)
    project_assets = project_dir / "assets"
    if project_assets.is_dir():
        for item in sorted(project_assets.rglob("*")):
            # Never follow a planted symlink: its target bytes would leak
            # into the export.
            if item.is_symlink() or not item.is_file():
                continue
            if not item.name.endswith(".meta.json"):
                rel = item.relative_to(project_assets)
                target = staged_assets / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)

    (out_dir / "config.json").write_text(
        json.dumps(config, indent=2), encoding="utf-8")
    if variant == "source":
        shutil.copy2(template_dir / "template.json", out_dir / "template.json")
        readme_src = template_dir / "README.md"
        if readme_src.is_file():
            shutil.copy2(readme_src, out_dir / "README.md")
        blueprint = project_dir / "blueprint.json"
        if blueprint.is_file():
            shutil.copy2(blueprint, out_dir / "blueprint.json")

    runtime = template_meta.get("runtime", {})
    manifest = build_manifest(
        project_name=project_name, genre=genre,
        template_id=template_meta["id"],
        template_version=str(template_meta.get("version", "0.0.0")),
        runtime_name=str(runtime.get("name", "phaser")),
        runtime_version=str(runtime.get("version", "unknown")),
        config=config,
        assets=_collect_assets(staged_assets, project_dir),
        warnings=warnings,
    )
    (out_dir / "kgsm-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    files = sorted(p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*")
                   if p.is_file())
    return {"dir": str(out_dir), "files": files, "manifest": manifest,
            "warnings": warnings}


def export_zip(staged_dir: str | Path, zip_path: str | Path) -> Path:
    """Zip a staged dir atomically (write temp, then replace).

    Every staged file's full plaintext is secret-scanned BEFORE the zip
    is written, so a leaking export fails without publishing anything.
    """
    staged_dir, zip_path = Path(staged_dir), Path(zip_path)
    assert_no_secrets_in_dir(staged_dir)
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.with_suffix(zip_path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in sorted(staged_dir.rglob("*")):
            if item.is_symlink() or not item.is_file():
                continue
            zf.write(item, item.relative_to(staged_dir).as_posix())
    os.replace(tmp, zip_path)
    return zip_path


def package_all(
    *, project_name: str, genre: str, config: dict, project_dir: str | Path,
    builds_dir: str | Path,
    template_dir: str | Path | None = None,
    runtime_dir: str | Path | None = None,
) -> dict:
    """One-click packaging (FR-030): playable ZIP + source ZIP + reports."""
    builds_dir = Path(builds_dir)
    slug = _slug(project_name)
    with tempfile.TemporaryDirectory(prefix="kgsm-export-") as tmp:
        tmp_path = Path(tmp)
        staged_play = stage_export(
            project_name=project_name, genre=genre, config=config,
            project_dir=project_dir, template_dir=template_dir,
            runtime_dir=runtime_dir, out_dir=tmp_path / "playable",
            variant="playable")
        staged_src = stage_export(
            project_name=project_name, genre=genre, config=config,
            project_dir=project_dir, template_dir=template_dir,
            runtime_dir=runtime_dir, out_dir=tmp_path / "source",
            variant="source")
        playable_zip = export_zip(staged_play["dir"],
                                  builds_dir / f"{slug}-playable.zip")
        source_zip = export_zip(staged_src["dir"],
                                builds_dir / f"{slug}-source.zip")
    return {
        "playable": str(playable_zip),
        "source": str(source_zip),
        "warnings": sorted(set(staged_play["warnings"] + staged_src["warnings"])),
    }
