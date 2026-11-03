"""Backup/restore + audio routes (contract §8/§9; FR-027/FR-029)."""

from __future__ import annotations

from pathlib import Path

from .. import audio as audio_mod
from .. import backup as backup_mod
from .. import sfx as sfx_mod
from . import (
    ApiError,
    Request,
    bad_request,
    check_segment,
    need_str,
    project_to_dict,
    require_project,
)


def create_backup(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    try:
        record = backup_mod.create_backup(project.id)
    except backup_mod.BackupError as exc:
        raise ApiError("backup-error", str(exc), 422) from None
    return 201, record


def list_backups(req: Request) -> tuple[int, dict]:  # noqa: ARG001
    return 200, {"backups": backup_mod.list_backups()}


def restore_backup(req: Request) -> tuple[int, dict]:
    backup_id = need_str(req.body, "backupId")
    try:
        result = backup_mod.restore_backup(backup_id)
    except backup_mod.BackupError as exc:
        if exc.code == "backup-not-found":
            raise ApiError(exc.code, str(exc), 404) from None
        raise ApiError("backup-error", str(exc), 422) from None
    return 201, {"project": project_to_dict(result["project"]),
                 "reassignedId": result["reassignedId"]}


def import_audio(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    src = need_str(body, "src")
    role = check_segment(body.get("role"), "role")
    entity = body.get("entity")
    if entity is not None:
        entity = check_segment(entity, "entity")
    if not Path(src).is_absolute():
        raise bad_request("src must be an absolute local-filesystem path")
    try:
        return 201, audio_mod.import_audio(
            project.dir, src, role=role, entity=entity)
    except audio_mod.AudioError as exc:
        raise ApiError("audio-error", str(exc), 400) from None


def list_audio(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    return 200, {"audio": audio_mod.list_audio(project.dir)}


def list_sfx_presets(req: Request) -> tuple[int, dict]:
    return 200, {"presets": list(sfx_mod.PRESETS),
                 "provider": sfx_mod.PROVIDER_ID}


def generate_sfx(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    preset = need_str(body, "preset")
    role = body.get("role") or preset
    role = check_segment(role, "role")
    entity = body.get("entity")
    if entity is not None:
        entity = check_segment(entity, "entity")
    try:
        return 201, sfx_mod.generate(
            project.dir, preset, role=role, entity=entity,
            seed=body.get("seed", 0))
    except audio_mod.AudioError as exc:
        raise ApiError("audio-error", str(exc), 400) from None


ROUTES = [
    ("POST", r"/projects/(?P<id>[^/]+)/backup", create_backup),
    ("GET", r"/backups", list_backups),
    ("POST", r"/projects/restore", restore_backup),
    ("POST", r"/projects/(?P<id>[^/]+)/audio/import", import_audio),
    ("GET", r"/projects/(?P<id>[^/]+)/audio", list_audio),
    ("POST", r"/projects/(?P<id>[^/]+)/audio/generate", generate_sfx),
    ("GET", r"/audio/sfx-presets", list_sfx_presets),
]
