"""One-click AUTO pipeline route (NEW): POST /projects/auto."""

from __future__ import annotations

from .. import auto as auto_mod
from .. import projects as projects_mod
from . import (
    ApiError,
    Request,
    bad_request,
)


def create_auto(req: Request) -> tuple[int, dict]:
    body = req.body
    name = body.get("name")
    if not isinstance(name, str):
        raise bad_request("name must be a string")
    if not 1 <= len(name.strip()) <= 80:
        raise ApiError("invalid-name", "project name must be 1..80 characters",
                       400)
    genre = body.get("genre")
    if not isinstance(genre, str):
        raise bad_request("genre must be a string")
    if genre not in projects_mod.GENRES:
        raise ApiError("unknown-genre", f"unknown genre {genre!r}", 404)
    prompt = body.get("prompt")
    if prompt is not None and not isinstance(prompt, str):
        raise bad_request("prompt must be a string")
    theme_id = body.get("themeId")
    if theme_id is not None and not isinstance(theme_id, str):
        raise bad_request("themeId must be a string")
    try:
        result = auto_mod.run_auto(name, genre, prompt, theme_id)
    except auto_mod.AutoError as exc:
        raise ApiError(exc.code, exc.message, exc.status,
                       exc.extra) from None
    return 201, {
        "project": result["project"],
        "blueprint": result["blueprint"],
        "config": result["config"],
        "validation": result["report"],
        "playable": result["playable"],
    }


ROUTES = [
    ("POST", r"/projects/auto", create_auto),
]
