"""Playtest routes (serve contract: docs/playtest.md).

POST stages the project's stored config via the shared exporter;
GET serves staged files back as RAW BYTES with the staged file's MIME
type (the one non-JSON reply in the API — an iframe points at it).
"""

from __future__ import annotations

from .. import playtest as playtest_mod
from ..exporters import ExportError
from ..exporters.manifest import ManifestError
from . import (
    ApiError,
    RawBody,
    Request,
    read_project_json,
    require_project,
)


def create_playtest(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    config = read_project_json(project.dir, "config.json", "config-not-found")
    if not isinstance(config, dict):
        raise ApiError("internal",
                       "config.json is corrupt: must be an object", 500)
    try:
        staged = playtest_mod.stage_playtest(
            project_name=project.name, genre=project.genre, config=config,
            project_dir=project.dir)
    except (ExportError, ManifestError) as exc:
        raise ApiError("export-error", str(exc), 502) from None
    return 201, {
        "url": f"/api/v1/projects/{project.id}/playtest/",
        "stagedAt": staged["stagedAt"],
    }


def _serve(req: Request, rel: str) -> tuple[int, RawBody]:
    project = require_project(req.group("id"))
    try:
        data, content_type = playtest_mod.read_staged_file(
            playtest_mod.staged_dir(project.dir), rel)
    except playtest_mod.PlaytestError as exc:
        raise ApiError(exc.code, str(exc), exc.status) from None
    return 200, RawBody(data=data, content_type=content_type)


def serve_playtest_root(req: Request) -> tuple[int, RawBody]:
    return _serve(req, "index.html")


def serve_playtest_file(req: Request) -> tuple[int, RawBody]:
    return _serve(req, req.group("path"))


ROUTES = [
    ("POST", r"/projects/(?P<id>[^/]+)/playtest", create_playtest),
    ("GET", r"/projects/(?P<id>[^/]+)/playtest/?", serve_playtest_root),
    ("GET", r"/projects/(?P<id>[^/]+)/playtest/(?P<path>.+)",
     serve_playtest_file),
]
