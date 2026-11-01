"""Godot 4 export adapter (FR-021).

Thin worker wrapper over the standalone, stdlib-only exporter in
``packages/templates/godot`` (no kgsm imports there, so it stays usable
without the worker). The worker adds: genre config validation, template-id
re-stamping (``phaser.<genre>`` → ``godot.<genre>``), atomic secret-scanned
ZIP publish (NFR-002/003) via the shared ``export_zip``.
"""

from __future__ import annotations

import copy
import re
import sys
import tempfile
from pathlib import Path

from .. import paths
from ..validation import (
    validate_battle_2d_config,
    validate_endless_runner_config,
    validate_farming_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)
from .manifest import ManifestError, assert_no_secrets
from .phaser import export_zip


class GodotExportError(Exception):
    pass


_VALIDATORS_BY_TEMPLATE = {
    "phaser.space-shooter": ("space-shooter", validate_space_shooter_config),
    "phaser.endless-runner": ("endless-runner",
                              validate_endless_runner_config),
    "phaser.side-scroller": ("side-scroller", validate_side_scroller_config),
    "phaser.battle-2d": ("battle-2d", validate_battle_2d_config),
    "phaser.farming": ("farming", validate_farming_config),
}

_standalone = None


def _load_standalone():
    """Import the standalone exporter from the templates tree (dev + frozen)."""
    global _standalone
    if _standalone is None:
        gdir = paths.templates_dir() / "godot"
        if not (gdir / "godot_exporter.py").is_file():
            raise GodotExportError(f"godot exporter missing: {gdir}")
        if str(gdir) not in sys.path:
            sys.path.insert(0, str(gdir))
        try:
            import godot_exporter as mod
        except ImportError as exc:
            raise GodotExportError(
                f"cannot load godot exporter: {exc}") from None
        _standalone = mod
    return _standalone


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "game"


def stage_export(
    *, project_name: str, genre: str, config: dict, blueprint: dict,
    project_dir: str | Path, out_dir: str | Path,
) -> dict:
    project_dir = Path(project_dir)
    out_dir = Path(out_dir)
    _template = config.get("template")
    template_id = _template.get("id", "") \
        if isinstance(_template, dict) else ""
    entry = _VALIDATORS_BY_TEMPLATE.get(template_id)
    if entry is None:
        raise GodotExportError(f"unknown template id {template_id!r}")
    cfg_genre, validate = entry
    if cfg_genre != genre:
        raise GodotExportError(
            f"config genre {cfg_genre!r} does not match project genre"
            f" {genre!r}")
    report = validate(config)
    if not report.ok:
        raise GodotExportError(
            f"config invalid: {report.summary()}; "
            + "; ".join(i.message for i in report.errors()[:5]))
    stamped = copy.deepcopy(config)
    stamped["template"]["id"] = f"godot.{cfg_genre}"
    # The standalone stage_export/build_manifest never scans for secrets,
    # so the worker scans the stamped config here (plus the full staged
    # dir in package_all via the shared secret-scanned export_zip).
    try:
        assert_no_secrets(stamped)
    except ManifestError as exc:
        raise GodotExportError(str(exc)) from None
    mod = _load_standalone()
    assets = project_dir / "assets"
    try:
        return mod.stage_export(
            project_name=project_name, blueprint=blueprint, config=stamped,
            project_dir=project_dir,
            asset_dirs=[assets] if assets.is_dir() else None,
            out_dir=out_dir)
    except mod.GodotExportError as exc:
        raise GodotExportError(str(exc)) from None


def package_all(
    *, project_name: str, genre: str, config: dict, blueprint: dict,
    project_dir: str | Path, builds_dir: str | Path,
) -> dict:
    """Stage into temp and publish one secret-scanned Godot project ZIP."""
    builds_dir = Path(builds_dir)
    slug = _slug(project_name)
    with tempfile.TemporaryDirectory(prefix="kgsm-godot-") as tmp:
        staged = stage_export(
            project_name=project_name, genre=genre, config=config,
            blueprint=blueprint, project_dir=project_dir,
            out_dir=Path(tmp) / "godot")
        godot_zip = export_zip(staged["dir"],
                               builds_dir / f"{slug}-godot4.zip")
    return {"godot": str(godot_zip), "warnings": list(staged["warnings"])}
