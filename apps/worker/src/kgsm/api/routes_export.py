"""Export routes (contract §7; FR-014/017/018/030)."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from ..exporters import ExportError, package_all
from ..exporters.manifest import ManifestError
from ..validation import (
    validate_endless_runner_config,
    validate_space_shooter_config,
)
from . import (
    ApiError,
    Request,
    bad_request,
    read_project_json,
    require_project,
)

_VALIDATORS_BY_TEMPLATE = {
    "phaser.space-shooter": validate_space_shooter_config,
    "phaser.endless-runner": validate_endless_runner_config,
}


def create_export(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    if "config" not in req.body:
        config = read_project_json(project.dir, "config.json",
                                   "config-not-found")
    else:
        config = req.body["config"]
        if not isinstance(config, dict):
            raise bad_request("config must be an object")
    template_id = (config.get("template") or {}).get("id", "")
    validate = _VALIDATORS_BY_TEMPLATE.get(template_id)
    if validate is None:
        raise ApiError("validation-failed",
                       f"unknown template id {template_id!r}", 422)
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
    except (OSError, KeyError, json.JSONDecodeError) as exc:
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
    require_project(req.group("id"))
    raise ApiError("godot-not-implemented",
                   "Godot export is planned for M3 (FR-021).", 501)


ROUTES = [
    ("POST", r"/projects/(?P<id>[^/]+)/exports", create_export),
    ("GET", r"/projects/(?P<id>[^/]+)/exports", list_exports),
    ("POST", r"/projects/(?P<id>[^/]+)/exports/godot", export_godot),
]
