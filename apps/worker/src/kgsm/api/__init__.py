"""KGSM worker localhost JSON HTTP API (contract: docs/api-contract.md v1).

Shared request/response plumbing for the route plugins
(``routes_projects``, ``routes_config``, ``routes_assets``, ``routes_export``,
``routes_secrets``, ``routes_providers``, ``routes_ops``, ``routes_story``,
``routes_auto``, ``routes_playtest``).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from .. import auth as auth_mod
from .. import projects as projects_mod

CONTRACT_VERSION = "1.0.0"
MAX_BODY_BYTES = 20 * 1024 * 1024


class ApiError(Exception):
    """An API failure rendered as the contract's error envelope."""

    def __init__(self, code: str, message: str, status: int = 400,
                 extra: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = dict(extra or {})

    def to_body(self) -> dict:
        body: dict = {"error": {"code": self.code, "message": self.message}}
        body.update(self.extra)
        return body


@dataclass(frozen=True)
class RawBody:
    """Raw-bytes response (playtest static serve). The only non-JSON reply."""

    data: bytes
    content_type: str


@dataclass
class Request:
    """A parsed API request handed to route handlers."""

    method: str
    path: str  # path after the /api/v1 prefix; always starts with "/"
    query: dict[str, str] = field(default_factory=dict)
    query_list: dict[str, list[str]] = field(default_factory=dict)
    body: dict = field(default_factory=dict)
    match: re.Match | None = None
    # Set by the HTTP layer only. ``enforce_auth`` is False for in-process
    # callers (tests, desktop), which keep single-user behaviour.
    enforce_auth: bool = False
    user: "auth_mod.AuthContext | None" = None
    client_ip: str = ""
    set_cookie: str | None = None
    session_token: str | None = None

    def group(self, name: str) -> str:
        assert self.match is not None, "no route match attached"
        return unquote(self.match.group(name))


def bad_request(message: str) -> ApiError:
    return ApiError("bad-request", message, 400)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def need_str(body: dict, field_name: str) -> str:
    value = body.get(field_name)
    if not isinstance(value, str):
        raise bad_request(f"{field_name} must be a string")
    return value


def need_dict(body: dict, field_name: str) -> dict:
    value = body.get(field_name)
    if not isinstance(value, dict):
        raise bad_request(f"{field_name} must be an object")
    return value


def need_int(body: dict, field_name: str, minimum: int | None = None,
             maximum: int | None = None) -> int:
    value = body.get(field_name)
    if not _is_int(value):
        raise bad_request(f"{field_name} must be an integer")
    assert isinstance(value, int)
    if minimum is not None and value < minimum:
        raise bad_request(f"{field_name} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise bad_request(f"{field_name} must be <= {maximum}")
    return value


def opt_int(body: dict, field_name: str, default: int | None = None,
            minimum: int | None = None, maximum: int | None = None) -> int | None:
    if field_name not in body or body[field_name] is None:
        return default
    return need_int(body, field_name, minimum, maximum)


def need_bool(body: dict, field_name: str) -> bool:
    value = body.get(field_name)
    if not isinstance(value, bool):
        raise bad_request(f"{field_name} must be a boolean")
    return value


def opt_bool(body: dict, field_name: str, default: bool = False) -> bool:
    if field_name not in body:
        return default
    return need_bool(body, field_name)


def query_bool(query: dict[str, str], name: str, default: bool = False) -> bool:
    if name not in query:
        return default
    return query[name].strip().lower() in ("1", "true", "yes", "on")


def project_to_dict(project: projects_mod.Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "genre": project.genre,
        "state": project.state,
        "stateReason": project.state_reason,
        "archived": project.archived,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
    }


def quote_to_dict(quote) -> dict:
    return {
        "providerId": quote.provider_id,
        "projectId": quote.project_id,
        "nImages": quote.n_images,
        "cents": quote.cents,
        "needsConfirmation": quote.needs_confirmation,
        "reason": quote.reason,
    }


def spend_ai_quota(kind: str, amount: int = 1) -> None:
    """Charge today's paid-generation quota (no-op for admins/desktop)."""
    try:
        auth_mod.consume_quota(kind, amount)
    except auth_mod.AuthError as exc:
        raise ApiError(exc.code, exc.message, exc.status) from None


def require_project(project_id: str) -> projects_mod.Project:
    try:
        return projects_mod.get_visible(project_id)
    except projects_mod.ProjectError:
        raise ApiError("project-not-found",
                       f"project {project_id!r} not found", 404) from None


def resolve_inside(base: Path, rel: str) -> Path:
    """Resolve a project-relative path, rejecting escapes (400 path-escape)."""
    if not isinstance(rel, str) or not rel or "\x00" in rel:
        raise ApiError("path-escape", f"invalid project-relative path {rel!r}",
                       400)
    candidate = Path(rel)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ApiError("path-escape", f"path escapes project dir: {rel!r}", 400)
    base_resolved = base.resolve()
    full = (base_resolved / candidate).resolve()
    if full != base_resolved and base_resolved not in full.parents:
        raise ApiError("path-escape", f"path escapes project dir: {rel!r}", 400)
    return full


_SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def check_segment(value: Any, field_name: str) -> str:
    """Validate a single path-segment field (entity/role/animation names).

    Segments flow into filenames and an rglob pattern, so shell/glob
    metachars, dots, and separators are rejected, not just ".." and "/".
    """
    if not isinstance(value, str) or not value:
        raise bad_request(f"{field_name} must be a non-empty string")
    if value in (".", "..") or "/" in value or "\\" in value or "\x00" in value:
        raise ApiError("path-escape", f"{field_name} must be a plain name",
                       400)
    if not _SEGMENT_RE.match(value):
        raise ApiError(
            "path-escape",
            f"{field_name} must match ^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$",
            400)
    return value


def read_project_json(project_dir: Path, filename: str,
                      not_found_code: str) -> dict:
    path = project_dir / filename
    if not path.is_file():
        raise ApiError(not_found_code, f"{filename} not found", 404)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError("internal", f"{filename} is corrupt: {exc}",
                       500) from None


def write_project_json(project_dir: Path, filename: str, data: dict) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / filename).write_text(json.dumps(data, indent=2),
                                        encoding="utf-8")
