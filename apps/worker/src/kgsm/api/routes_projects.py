"""Project lifecycle routes (contract §1; FR-001)."""

from __future__ import annotations

from .. import projects as projects_mod
from . import (
    ApiError,
    Request,
    bad_request,
    project_to_dict,
    query_bool,
    require_project,
)


def _check_name(body: dict) -> str:
    name = body.get("name")
    if not isinstance(name, str):
        raise bad_request("name must be a string")
    if not 1 <= len(name.strip()) <= 80:
        raise ApiError("invalid-name", "project name must be 1..80 characters",
                       400)
    return name


def list_projects(req: Request) -> tuple[int, dict]:
    include = query_bool(req.query, "includeArchived", False)
    items = projects_mod.list_projects(include_archived=include)
    return 200, {"projects": [project_to_dict(p) for p in items]}


def create_project(req: Request) -> tuple[int, dict]:
    name = _check_name(req.body)
    genre = req.body.get("genre")
    if not isinstance(genre, str):
        raise bad_request("genre must be a string")
    if genre not in projects_mod.GENRES:
        raise ApiError("unknown-genre", f"unknown genre {genre!r}", 404)
    project = projects_mod.create(name, genre)
    return 201, project_to_dict(project)


def get_project(req: Request) -> tuple[int, dict]:
    return 200, project_to_dict(require_project(req.group("id")))


def patch_project(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    if "name" in body:
        project = projects_mod.rename(project.id, _check_name(body))
    if "archived" in body:
        archived = body["archived"]
        if not isinstance(archived, bool):
            raise bad_request("archived must be a boolean")
        project = projects_mod.set_archived(project.id, archived)
    return 200, project_to_dict(project)


def duplicate_project(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    copy = projects_mod.duplicate(project.id, _check_name(req.body))
    return 201, project_to_dict(copy)


def delete_project(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    projects_mod.delete(project.id)
    return 200, {"deleted": True, "id": project.id}


def transition_project(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    to_state = body.get("toState")
    if not isinstance(to_state, str) or not to_state:
        raise bad_request("toState must be a non-empty string")
    reason = body.get("reason", "")
    if reason is None:
        reason = ""
    if not isinstance(reason, str):
        raise bad_request("reason must be a string")
    if to_state not in projects_mod.STATES:
        raise bad_request(f"unknown state {to_state!r}")
    try:
        updated = projects_mod.transition(project.id, to_state, reason)
    except projects_mod.ProjectError as exc:
        raise ApiError("bad-transition", str(exc), 400) from None
    return 200, project_to_dict(updated)


def mark_stale(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    reason = body.get("reason")
    if not isinstance(reason, str) or not reason:
        raise ApiError("stale-reason-required",
                       "mark-stale requires a non-empty reason", 400)
    to_state = body.get("toState", "assets_pending")
    if not isinstance(to_state, str) or to_state not in projects_mod.STATES:
        raise bad_request(f"unknown toState {to_state!r}")
    updated = projects_mod.mark_stale(project.id, reason, to_state)
    return 200, project_to_dict(updated)


ROUTES = [
    ("GET", r"/projects", list_projects),
    ("POST", r"/projects", create_project),
    ("GET", r"/projects/(?P<id>[^/]+)", get_project),
    ("PATCH", r"/projects/(?P<id>[^/]+)", patch_project),
    ("DELETE", r"/projects/(?P<id>[^/]+)", delete_project),
    ("POST", r"/projects/(?P<id>[^/]+)/duplicate", duplicate_project),
    ("POST", r"/projects/(?P<id>[^/]+)/transition", transition_project),
    ("POST", r"/projects/(?P<id>[^/]+)/mark-stale", mark_stale),
]
