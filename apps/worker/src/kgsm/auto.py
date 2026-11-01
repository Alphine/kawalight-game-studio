"""One-click AUTO game pipeline (NEW).

``POST /projects/auto`` equivalent as a function: create a project, build a
deterministic offline blueprint from a starter theme, assemble it, validate
it, store the config, and package a phaser playable ZIP.

No providers, no network, no spend: theme selection is a starter lookup
(explicit ``themeId``) or a deterministic keyword match over the prompt, and
the prompt itself is recorded verbatim into the blueprint ``notes`` field.
Stdlib only.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from . import projects as projects_mod
from .blueprint import (
    AssemblyError,
    assemble_battle_2d,
    assemble_endless_runner,
    assemble_farming,
    assemble_side_scroller,
    assemble_space_shooter,
)
from .exporters import ExportError, package_all
from .exporters.manifest import ManifestError
from .validation import (
    validate_battle_2d_config,
    validate_blueprint,
    validate_endless_runner_config,
    validate_farming_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)

NOTES_MAX_CHARS = 4000


class AutoError(Exception):
    """An AUTO pipeline failure mapped to an API error envelope."""

    def __init__(self, code: str, message: str, status: int = 400,
                 extra: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = dict(extra or {})


# --------------------------------------------------------------------------
# Starter themes: themeId -> {theme label, foes}.
# "foes" become blueprint "enemies" (space-shooter, battle-2d) or
# "obstacles" (endless-runner, side-scroller, farming). The first entry per
# genre is the default when neither themeId nor a keyword matches.
# --------------------------------------------------------------------------

STARTERS: dict[str, dict[str, dict]] = {
    "space-shooter": {
        "alien-invasion": {
            "theme": "Alien Invasion",
            "foes": [
                {"id": "drone", "role": "basic chaser"},
                {"id": "weaver", "role": "strafing shooter"},
            ],
        },
        "neon-swarm": {
            "theme": "Neon Swarm",
            "foes": [
                {"id": "neon-drone", "role": "fast neon chaser"},
                {"id": "neon-wasp", "role": "darting striker"},
            ],
        },
        "pirate-belt": {
            "theme": "Pirate Belt",
            "foes": [
                {"id": "raider", "role": "ambushing raider"},
                {"id": "marauder", "role": "heavy gunship"},
            ],
        },
    },
    "endless-runner": {
        "neon-rooftops": {
            "theme": "Neon Rooftops",
            "foes": [
                {"id": "spike", "role": "low spikes"},
                {"id": "drone", "role": "hovering drone"},
            ],
        },
        "desert-dash": {
            "theme": "Desert Dash",
            "foes": [
                {"id": "cactus", "role": "tall cactus"},
                {"id": "vulture", "role": "diving bird"},
            ],
        },
        "ember-caverns": {
            "theme": "Ember Caverns",
            "foes": [
                {"id": "stalagmite", "role": "sharp stalagmite"},
                {"id": "ember-bat", "role": "swooping bat"},
            ],
        },
    },
    "side-scroller": {
        "mossy-cliffs": {
            "theme": "Mossy Cliffs",
            "foes": [
                {"id": "walker-1", "role": "patrolling crawler"},
                {"id": "spikes-1", "role": "static spikes"},
            ],
        },
        "lava-caves": {
            "theme": "Lava Caves",
            "foes": [
                {"id": "magma-walker", "role": "patrolling crawler"},
                {"id": "lava-spikes", "role": "hot spikes"},
            ],
        },
        "sky-ruins": {
            "theme": "Sky Ruins",
            "foes": [
                {"id": "ruin-walker", "role": "patrolling sentinel"},
                {"id": "saw-blade", "role": "spinning blade"},
            ],
        },
    },
    "battle-2d": {
        "monster-arena": {
            "theme": "Monster Arena",
            "foes": [
                {"id": "grunt", "role": "tanky chaser"},
                {"id": "stinger", "role": "ranged shooter"},
            ],
        },
        "robot-foundry": {
            "theme": "Robot Foundry",
            "foes": [
                {"id": "scrapper", "role": "tanky chaser"},
                {"id": "turret-bot", "role": "ranged shooter"},
            ],
        },
        "shadow-crypt": {
            "theme": "Shadow Crypt",
            "foes": [
                {"id": "ghoul", "role": "tanky chaser"},
                {"id": "hexer", "role": "ranged shooter"},
            ],
        },
    },
    "farming": {
        "sunny-acres": {
            "theme": "Sunny Acres",
            "foes": [
                {"id": "thirst", "role": "each stage needs watering"},
                {"id": "funds", "role": "seeds cost coins"},
            ],
        },
        "moonlit-grove": {
            "theme": "Moonlit Grove",
            "foes": [
                {"id": "frost", "role": "cold nights slow growth"},
                {"id": "moths", "role": "moths nibble leaves"},
            ],
        },
        "tidepool-farm": {
            "theme": "Tidepool Farm",
            "foes": [
                {"id": "tides", "role": "tides flood low plots"},
                {"id": "gulls", "role": "gulls steal ripe crops"},
            ],
        },
    },
}

# Keyword -> themeId per genre, in match priority order. A keyword matches
# when it appears (case-insensitive) anywhere in the prompt; the first
# matching entry wins, so matching is deterministic.
KEYWORDS: dict[str, tuple[tuple[str, str], ...]] = {
    "space-shooter": (
        ("neon", "neon-swarm"),
        ("pirate", "pirate-belt"),
        ("raider", "pirate-belt"),
        ("marauder", "pirate-belt"),
        ("alien", "alien-invasion"),
        ("invasion", "alien-invasion"),
        ("xeno", "alien-invasion"),
    ),
    "endless-runner": (
        ("desert", "desert-dash"),
        ("sand", "desert-dash"),
        ("cactus", "desert-dash"),
        ("cave", "ember-caverns"),
        ("cavern", "ember-caverns"),
        ("ember", "ember-caverns"),
        ("lava", "ember-caverns"),
        ("neon", "neon-rooftops"),
        ("roof", "neon-rooftops"),
        ("city", "neon-rooftops"),
    ),
    "side-scroller": (
        ("lava", "lava-caves"),
        ("cave", "lava-caves"),
        ("magma", "lava-caves"),
        ("sky", "sky-ruins"),
        ("ruin", "sky-ruins"),
        ("cloud", "sky-ruins"),
        ("moss", "mossy-cliffs"),
        ("cliff", "mossy-cliffs"),
        ("forest", "mossy-cliffs"),
    ),
    "battle-2d": (
        ("robot", "robot-foundry"),
        ("foundry", "robot-foundry"),
        ("steel", "robot-foundry"),
        ("shadow", "shadow-crypt"),
        ("crypt", "shadow-crypt"),
        ("undead", "shadow-crypt"),
        ("ghost", "shadow-crypt"),
        ("monster", "monster-arena"),
        ("arena", "monster-arena"),
    ),
    "farming": (
        ("moon", "moonlit-grove"),
        ("night", "moonlit-grove"),
        ("grove", "moonlit-grove"),
        ("tide", "tidepool-farm"),
        ("sea", "tidepool-farm"),
        ("coast", "tidepool-farm"),
        ("sun", "sunny-acres"),
        ("acre", "sunny-acres"),
        ("field", "sunny-acres"),
    ),
}

DEFAULT_THEME = {genre: next(iter(themes)) for genre, themes in STARTERS.items()}

_ENEMY_GENRES = ("space-shooter", "battle-2d")

_BASE: dict[str, dict] = {
    "space-shooter": {
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard"},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "fly, shoot, survive waves",
        "player": {"abilities": ["move", "shoot"], "health": 3, "lives": 3},
        "progression": "waves scale up",
        "scoring": "kills and wave bonus",
        "winCondition": "clear all waves",
        "loseCondition": "lose all lives",
    },
    "endless-runner": {
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard", "actions": ["jump", "slide"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "run, jump, slide, survive",
        "player": {"abilities": ["jump", "slide"], "health": 1, "lives": 1},
        "collectibles": "coins",
        "progression": "endless ramp",
        "scoring": "meters + coins",
        "winCondition": "beat best distance",
        "loseCondition": "hit anything",
    },
    "side-scroller": {
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard",
                     "actions": ["left", "right", "jump"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "run, jump, stomp, reach the exit",
        "player": {"abilities": ["run", "jump"], "health": 3, "lives": 1},
        "collectibles": "coins",
        "progression": "single hand-tuned level",
        "scoring": "coins and stomps",
        "winCondition": "touch the exit",
        "loseCondition": "lose all health",
    },
    "battle-2d": {
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard",
                     "actions": ["move", "fire", "melee"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "kite packs, snipe foes, slash close attackers",
        "player": {"abilities": ["move", "shoot", "melee"], "health": 3,
                   "lives": 3},
        "progression": "waves scale up",
        "scoring": "kills and wave bonus",
        "winCondition": "clear all waves",
        "loseCondition": "lose all lives",
    },
    "farming": {
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "mouse-keyboard",
                     "actions": ["plant", "water", "harvest", "sleep"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "plant, water, harvest, bank coins",
        "player": {"abilities": ["plant", "water", "harvest"], "health": 1,
                   "lives": 1},
        "collectibles": "harvest payouts",
        "progression": "day cycle with morning rain",
        "scoring": "coins from harvests",
        "winCondition": "bank 500 coins",
        "loseCondition": "none; cozy until the goal is banked",
    },
}


def _dispatch(genre: str):
    """Return (assemble, validate_config) for a genre (mirrors routes_config)."""
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
    raise AutoError("unknown-genre", f"unknown genre {genre!r}", 404)


def themes_for(genre: str) -> list[dict]:
    """Starter themes available for a genre: [{id, theme}]."""
    if genre not in STARTERS:
        raise AutoError("unknown-genre", f"unknown genre {genre!r}", 404)
    return [{"id": tid, "theme": s["theme"]}
            for tid, s in STARTERS[genre].items()]


def match_theme(genre: str, prompt: str | None) -> str:
    """Pick a themeId for a genre: keyword match over the prompt, else default.

    Deterministic: the first keyword (in KEYWORDS order) found anywhere in
    the lowercased prompt wins; no match yields the genre default.
    """
    if genre not in STARTERS:
        raise AutoError("unknown-genre", f"unknown genre {genre!r}", 404)
    lowered = (prompt or "").lower()
    if lowered:
        for keyword, theme_id in KEYWORDS[genre]:
            if keyword in lowered:
                return theme_id
    return DEFAULT_THEME[genre]


def _seed_for(name: str, genre: str, theme_id: str) -> int:
    digest = hashlib.sha256(
        f"{genre}\0{name}\0{theme_id}".encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % (2 ** 31)


def build_blueprint(name: str, genre: str, prompt: str | None = None,
                    theme_id: str | None = None) -> dict:
    """Build a deterministic offline blueprint from a starter theme.

    ``theme_id`` selects the starter explicitly (surrounding whitespace
    is stripped); otherwise the prompt is keyword-matched (see
    :func:`match_theme`). The prompt is recorded verbatim (truncated to
    4000 chars) into blueprint ``notes``; prompt length itself is
    unbounded at the API (subject to the 20 MB body cap).
    """
    if genre not in STARTERS:
        raise AutoError("unknown-genre", f"unknown genre {genre!r}", 404)
    if theme_id is not None:
        theme_id = theme_id.strip()
        if theme_id not in STARTERS[genre]:
            known = ", ".join(STARTERS[genre])
            raise AutoError(
                "unknown-theme",
                f"unknown themeId {theme_id!r} for genre {genre!r}"
                f" (expected one of: {known})", 400)
        chosen = theme_id
    else:
        chosen = match_theme(genre, prompt)
    starter = STARTERS[genre][chosen]
    base = _BASE[genre]
    blueprint = {
        "schemaVersion": "1.0.0",
        "projectName": name,
        "genre": genre,
        "theme": starter["theme"],
        "visualStyle": base["visualStyle"],
        "targetRuntime": base["targetRuntime"],
        "resolution": dict(base["resolution"]),
        "controls": {k: (list(v) if isinstance(v, list) else v)
                     for k, v in base["controls"].items()},
        "difficulty": dict(base["difficulty"]),
        "gameLoop": base["gameLoop"],
        "player": {"abilities": list(base["player"]["abilities"]),
                   "health": base["player"].get("health", 3),
                   "lives": base["player"].get("lives", 3)},
        "progression": base["progression"],
        "scoring": base["scoring"],
        "winCondition": base["winCondition"],
        "loseCondition": base["loseCondition"],
        "seed": _seed_for(name, genre, chosen),
        "notes": (prompt or "")[:NOTES_MAX_CHARS],
    }
    if "collectibles" in base:
        blueprint["collectibles"] = base["collectibles"]
    foe_key = "enemies" if genre in _ENEMY_GENRES else "obstacles"
    blueprint[foe_key] = [dict(f) for f in starter["foes"]]
    return blueprint


def run_auto(name: str, genre: str, prompt: str | None = None,
             theme_id: str | None = None) -> dict:
    """Run the full AUTO pipeline; return the pieces for the 201 response.

    Creates the project, builds/validates/assembles the blueprint, stores
    ``blueprint.json`` + ``config.json``, and packages the phaser playable
    ZIP. Any failure after project creation deletes the project again, so a
    failed call never leaves a half-written project behind.
    """
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise AutoError("invalid-name",
                        "project name must be 1..80 characters", 400)
    if prompt is not None and not isinstance(prompt, str):
        raise AutoError("bad-request", "prompt must be a string", 400)
    if theme_id is not None and not isinstance(theme_id, str):
        raise AutoError("bad-request", "themeId must be a string", 400)
    blueprint = build_blueprint(name.strip(), genre, prompt, theme_id)
    try:
        project = projects_mod.create(name, genre)
    except projects_mod.ProjectError as exc:
        # Name/genre were already validated above, so a validation-shaped
        # failure is a caller bug (400); anything else (id-mint exhaustion,
        # DB failure) is a server failure (500).
        text = str(exc)
        if text.startswith("project name must be") or \
                text.startswith("unknown genre"):
            raise AutoError("bad-request", text, 400) from None
        raise AutoError("internal", text, 500) from None
    try:
        return _run_inside(project, blueprint)
    except Exception:
        projects_mod.delete(project.id)
        raise


def _run_inside(project, blueprint: dict) -> dict:
    assemble, validate_config = _dispatch(project.genre)
    bp_report = validate_blueprint(blueprint)
    if not bp_report.ok:
        errors = bp_report.errors()
        message = errors[0].message if errors else "blueprint invalid"
        raise AutoError("validation-failed", message, 422,
                        {"report": bp_report.to_dict()})
    try:
        config = assemble(blueprint)
    except AssemblyError as exc:
        # No report attached: matches assemble_blueprint, which reports
        # assembly-failed bare (a passing blueprint report adds nothing).
        raise AutoError("assembly-failed", str(exc), 422) from None
    config_report = validate_config(config)
    if not config_report.ok:
        errors = config_report.errors()
        message = errors[0].message if errors else "config invalid"
        raise AutoError("validation-failed", message, 422,
                        {"report": config_report.to_dict()})
    project.dir.mkdir(parents=True, exist_ok=True)
    (project.dir / "blueprint.json").write_text(
        json.dumps(blueprint, indent=2), encoding="utf-8")
    (project.dir / "config.json").write_text(
        json.dumps(config, indent=2), encoding="utf-8")
    try:
        result = package_all(
            project_name=project.name, genre=project.genre, config=config,
            project_dir=project.dir, builds_dir=project.dir / "builds")
    except (ExportError, ManifestError) as exc:
        raise AutoError("export-error", str(exc), 502) from None
    playable = Path(result["playable"])
    try:
        with zipfile.ZipFile(playable) as zf:
            manifest = json.loads(
                zf.read("kgsm-manifest.json").decode("utf-8"))
    except (OSError, KeyError, json.JSONDecodeError,
            zipfile.BadZipFile) as exc:
        raise AutoError(
            "internal",
            f"export succeeded but manifest is unreadable: {exc}",
            500) from None
    fresh = projects_mod.get(project.id)
    return {
        "project": {
            "id": fresh.id,
            "name": fresh.name,
            "genre": fresh.genre,
            "state": fresh.state,
            "stateReason": fresh.state_reason,
            "archived": fresh.archived,
            "createdAt": fresh.created_at,
            "updatedAt": fresh.updated_at,
        },
        "blueprint": blueprint,
        "config": config,
        "report": config_report.to_dict(),
        "playable": playable.relative_to(project.dir).as_posix(),
        "warnings": result["warnings"],
        "manifest": manifest,
    }
