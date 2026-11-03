"""Export routes (contract §7; FR-014/017/018/030)."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from ..exporters import ExportError, package_all
from ..exporters.godot import GodotExportError, package_all as package_godot
from ..exporters.manifest import ManifestError
from ..validation import (
    validate_battle_2d_config,
    validate_endless_runner_config,
    validate_farming_config,
    validate_puzzle_match_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)
from . import (
    ApiError,
    Request,
    bad_request,
    read_project_json,
    require_project,
)

# Genres with a Godot 4 exporter (puzzle-match ships Phaser only for now).
_GODOT_TEMPLATES = {
    "phaser.space-shooter", "phaser.endless-runner", "phaser.side-scroller",
    "phaser.battle-2d", "phaser.farming",
}

_VALIDATORS_BY_TEMPLATE = {
    "phaser.space-shooter": validate_space_shooter_config,
    "phaser.endless-runner": validate_endless_runner_config,
    "phaser.side-scroller": validate_side_scroller_config,
    "phaser.battle-2d": validate_battle_2d_config,
    "phaser.farming": validate_farming_config,
    "phaser.puzzle-match": validate_puzzle_match_config,
}


def _template_id(config: dict) -> str:
    """Template id, or "" when ``template`` is missing/non-object.

    A non-object ``template`` (e.g. a string) is an unknown template id
    (→ 422 validation-failed), never an AttributeError (→ 500).
    """
    template = config.get("template")
    if not isinstance(template, dict):
        return ""
    ident = template.get("id", "")
    return ident if isinstance(ident, str) else ""


def create_export(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    if "config" not in req.body:
        config = read_project_json(project.dir, "config.json",
                                   "config-not-found")
        if not isinstance(config, dict):
            raise ApiError("internal",
                           "config.json is corrupt: must be an object",
                           500)
    else:
        config = req.body["config"]
        if not isinstance(config, dict):
            raise bad_request("config must be an object")
    template_id = _template_id(config)
    validate = _VALIDATORS_BY_TEMPLATE.get(template_id)
    if validate is None:
        raise ApiError("validation-failed",
                       f"unknown template id {template_id!r}", 422)
    if template_id != f"phaser.{project.genre}":
        raise ApiError("validation-failed",
                       f"config template {template_id!r} does not match"
                       f" project genre {project.genre!r}", 422)
    report = validate(config)
    if not report.ok:
        errors = report.errors()
        message = errors[0].message if errors else "config invalid"
        raise ApiError("validation-failed", message, 422,
                       {"report": report.to_dict()})
    try:
        result = package_all(
            project_name=project.name, genre=project.genre, config=config,
            project_dir=project.dir, builds_dir=project.dir / "builds")
    except (ExportError, ManifestError) as exc:
        raise ApiError("export-error", str(exc), 502) from None
    playable = Path(result["playable"])
    source = Path(result["source"])
    try:
        with zipfile.ZipFile(playable) as zf:
            manifest = json.loads(
                zf.read("kgsm-manifest.json").decode("utf-8"))
    except (OSError, KeyError, json.JSONDecodeError,
            zipfile.BadZipFile) as exc:
        raise ApiError("internal",
                       f"export succeeded but manifest is unreadable: {exc}",
                       500) from None
    return 201, {
        "playable": playable.relative_to(project.dir).as_posix(),
        "source": source.relative_to(project.dir).as_posix(),
        "warnings": result["warnings"],
        "manifest": manifest,
    }


def list_exports(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    builds = project.dir / "builds"
    items = []
    if builds.is_dir():
        for path in sorted(builds.glob("*.zip")):
            stat = path.stat()
            items.append({
                "file": path.relative_to(project.dir).as_posix(),
                "bytes": stat.st_size,
                "createdAt": datetime.fromtimestamp(
                    stat.st_mtime, timezone.utc).isoformat(),
            })
    return 200, {"exports": items}


def export_godot(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    if "config" not in req.body:
        config = read_project_json(project.dir, "config.json",
                                   "config-not-found")
        if not isinstance(config, dict):
            raise ApiError("internal",
                           "config.json is corrupt: must be an object",
                           500)
    else:
        config = req.body["config"]
        if not isinstance(config, dict):
            raise bad_request("config must be an object")
    template_id = _template_id(config)
    validate = _VALIDATORS_BY_TEMPLATE.get(template_id)
    if validate is None:
        raise ApiError("validation-failed",
                       f"unknown template id {template_id!r}", 422)
    if template_id != f"phaser.{project.genre}":
        raise ApiError("validation-failed",
                       f"config template {template_id!r} does not match"
                       f" project genre {project.genre!r}", 422)
    if template_id not in _GODOT_TEMPLATES:
        raise ApiError("godot-not-supported",
                       "Godot export is not available for this genre yet;"
                       " export the Phaser ZIP instead", 422)
    report = validate(config)
    if not report.ok:
        errors = report.errors()
        message = errors[0].message if errors else "config invalid"
        raise ApiError("validation-failed", message, 422,
                       {"report": report.to_dict()})
    bp_path = project.dir / "blueprint.json"
    if bp_path.is_file():
        blueprint = read_project_json(project.dir, "blueprint.json",
                                      "blueprint-not-found")
        if not isinstance(blueprint, dict):
            raise bad_request("blueprint.json must be an object")
        bp_genre = blueprint.get("genre") or project.genre
        if bp_genre != project.genre:
            raise ApiError("validation-failed",
                           f"blueprint genre {bp_genre!r} does not match"
                           f" project genre {project.genre!r}", 422)
        blueprint = dict(blueprint)
        blueprint["genre"] = project.genre
        blueprint.setdefault("schemaVersion", "1.0.0")
        blueprint.setdefault("projectName", project.name)
    else:
        blueprint = {"schemaVersion": "1.0.0", "genre": project.genre,
                     "projectName": project.name}
    try:
        result = package_godot(
            project_name=project.name, genre=project.genre, config=config,
            blueprint=blueprint, project_dir=project.dir,
            builds_dir=project.dir / "builds")
    except (GodotExportError, ExportError, ManifestError) as exc:
        raise ApiError("export-error", str(exc), 502) from None
    gz = Path(result["godot"])
    try:
        with zipfile.ZipFile(gz) as zf:
            manifest = json.loads(
                zf.read("kgsm-manifest.json").decode("utf-8"))
    except (OSError, KeyError, json.JSONDecodeError,
            zipfile.BadZipFile) as exc:
        raise ApiError("internal",
                       f"export succeeded but manifest is unreadable: {exc}",
                       500) from None
    return 201, {
        "godot": gz.relative_to(project.dir).as_posix(),
        "warnings": result["warnings"],
        "manifest": manifest,
    }


ROUTES = [
    ("POST", r"/projects/(?P<id>[^/]+)/exports", create_export),
    ("GET", r"/projects/(?P<id>[^/]+)/exports", list_exports),
    ("POST", r"/projects/(?P<id>[^/]+)/exports/godot", export_godot),
]
