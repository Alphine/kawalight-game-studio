"""Blueprint and config routes (contract §2-§3; FR-004/005/014/016)."""

from __future__ import annotations

from ..blueprint import (
    AssemblyError,
    assemble_battle_2d,
    assemble_endless_runner,
    assemble_farming,
    assemble_puzzle_match,
    assemble_side_scroller,
    assemble_space_shooter,
)
from ..validation import (
    validate_battle_2d_config,
    validate_blueprint,
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
    need_dict,
    need_str,
    read_project_json,
    require_project,
    write_project_json,
)

SUPPORTED_GENRES = ("space-shooter", "endless-runner", "side-scroller",
                    "battle-2d", "farming", "puzzle-match")


def _for_genre(genre: str):
    """Return (assemble, validate_config) for a genre or raise 501.

    The 501 here is intentional and distinct from the 404 that
    ``POST /projects`` returns for an unknown genre: creation validates
    a value against the genre list (client error), while these routes
    dispatch to per-genre handlers, so a genre with no handler is
    "not served" (``unknown-genre`` kept as the code for continuity).
    """
    if genre == "space-shooter":
        return assemble_space_shooter, validate_space_shooter_config
    if genre == "endless-runner":
        return assemble_endless_runner, validate_endless_runner_config
    if genre == "side-scroller":
        return assemble_side_scroller, validate_side_scroller_config
    if genre == "battle-2d":
        return assemble_battle_2d, validate_battle_2d_config
    if genre == "farming":
        return assemble_farming, validate_farming_config
    if genre == "puzzle-match":
        return assemble_puzzle_match, validate_puzzle_match_config
    raise ApiError(
        "unknown-genre",
        f"genre {genre!r} is not served"
        f" (supported: {', '.join(SUPPORTED_GENRES)})", 501)


def _first_error_message(report) -> str:
    errors = report.errors()
    return errors[0].message if errors else "invalid data"


def validate_blueprint_route(req: Request) -> tuple[int, dict]:
    blueprint = need_dict(req.body, "blueprint")
    report = validate_blueprint(blueprint)
    return 200, {"report": report.to_dict()}


def get_blueprint(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    blueprint = read_project_json(project.dir, "blueprint.json",
                                  "blueprint-not-found")
    return 200, {"blueprint": blueprint}


def put_blueprint(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    blueprint = need_dict(req.body, "blueprint")
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise ApiError("validation-failed", _first_error_message(report), 422,
                       {"report": report.to_dict()})
    bp_genre = blueprint.get("genre")
    if bp_genre is not None and bp_genre != project.genre:
        raise ApiError("validation-failed",
                       f"blueprint genre {bp_genre!r} does not match"
                       f" project genre {project.genre!r}", 422)
    write_project_json(project.dir, "blueprint.json", blueprint)
    return 200, {"stored": True, "report": report.to_dict()}


def assemble_blueprint(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    if "blueprint" not in req.body:
        blueprint = read_project_json(project.dir, "blueprint.json",
                                      "blueprint-not-found")
        if not isinstance(blueprint, dict):
            raise ApiError("internal",
                           "blueprint.json is corrupt: must be an object",
                           500)
    else:
        blueprint = req.body["blueprint"]
        if not isinstance(blueprint, dict):
            raise bad_request("blueprint must be an object")
    assemble, validate = _for_genre(project.genre)
    try:
        config = assemble(blueprint)
    except AssemblyError as exc:
        report = validate_blueprint(blueprint)
        message = _first_error_message(report) if not report.ok else str(exc)
        raise ApiError("assembly-failed", message, 422) from None
    # Validate BEFORE persisting so an invalid assembled config is never
    # stored (it would only fail later at export instead).
    config_report = validate(config)
    if not config_report.ok:
        return 200, {"config": config, "report": config_report.to_dict(),
                     "storedConfig": False}
    write_project_json(project.dir, "config.json", config)
    return 200, {"config": config, "report": config_report.to_dict(),
                 "storedConfig": True}


def validate_config_route(req: Request) -> tuple[int, dict]:
    genre = need_str(req.body, "genre")
    config = need_dict(req.body, "config")
    _, validate = _for_genre(genre)
    report = validate(config)
    return 200, {"report": report.to_dict()}


def get_config(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    config = read_project_json(project.dir, "config.json", "config-not-found")
    return 200, {"config": config}


def put_config(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    config = need_dict(req.body, "config")
    _, validate = _for_genre(project.genre)
    report = validate(config)
    if not report.ok:
        raise ApiError("validation-failed", _first_error_message(report), 422,
                       {"report": report.to_dict()})
    write_project_json(project.dir, "config.json", config)
    return 200, {"stored": True, "report": report.to_dict()}


ROUTES = [
    ("POST", r"/blueprints/validate", validate_blueprint_route),
    ("GET", r"/projects/(?P<id>[^/]+)/blueprint", get_blueprint),
    ("PUT", r"/projects/(?P<id>[^/]+)/blueprint", put_blueprint),
    ("POST", r"/projects/(?P<id>[^/]+)/blueprint/assemble",
     assemble_blueprint),
    ("POST", r"/configs/validate", validate_config_route),
    ("GET", r"/projects/(?P<id>[^/]+)/config", get_config),
    ("PUT", r"/projects/(?P<id>[^/]+)/config", put_config),
]
