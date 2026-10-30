"""Schema + semantic validation for blueprints, configs, manifests.

Model/wizard output is parsed and validated here before anything reaches the
runtime (NFR-009). Invalid data is rejected with codes the UI can explain.
"""

from __future__ import annotations

import json
from functools import lru_cache

from jsonschema import Draft202012Validator

from .. import paths
from .reports import Report


@lru_cache(maxsize=8)
def load_schema(name: str) -> dict:
    path = paths.schemas_dir() / name
    return json.loads(path.read_text(encoding="utf-8"))


def _schema_errors(report: Report, data: dict, schema_name: str) -> bool:
    validator = Draft202012Validator(load_schema(schema_name))
    found = False
    for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        found = True
        at = "/".join(str(p) for p in err.absolute_path)
        report.error("schema", f"{at or '$'}: {err.message}", at)
    return found


def _unique(report: Report, items: list[dict], key: str, where: str) -> None:
    seen: set[str] = set()
    for i, item in enumerate(items):
        value = item.get(key)
        if value in seen:
            report.error("duplicate-id", f"duplicate {key} {value!r} in {where}",
                         f"{where}/{i}")
        seen.add(value)


def validate_blueprint(data: dict) -> Report:
    report = Report()
    if _schema_errors(report, data, "blueprint.schema.json"):
        return report
    for key in ("enemies", "obstacles"):
        if key in data:
            _unique(report, data[key], "id", key)
    return report


def validate_space_shooter_config(data: dict) -> Report:
    report = Report()
    if _schema_errors(report, data, "space-shooter.config.schema.json"):
        return report
    enemies = data["enemies"]
    waves = data["waves"]
    _unique(report, enemies, "id", "enemies")
    _unique(report, waves, "id", "waves")
    enemy_ids = {e["id"] for e in enemies}
    wave_ids = {w["id"] for w in waves}
    sprites = (data.get("assets") or {}).get("sprites", {})

    for e in enemies:
        if e["sprite"] not in sprites:
            report.error("unknown-sprite",
                         f"enemy {e['id']!r} sprite {e['sprite']!r} missing"
                         " from assets.sprites", f"enemies/{e['id']}")
    for w in waves:
        for s, spawn in enumerate(w["spawns"]):
            if spawn["enemyId"] not in enemy_ids:
                report.error("unknown-enemy",
                             f"wave {w['id']!r} spawn {s} references unknown"
                             f" enemy {spawn['enemyId']!r}", f"waves/{w['id']}")
    boss = data.get("boss")
    if boss:
        if boss["enemyId"] not in enemy_ids:
            report.error("unknown-enemy",
                         f"boss references unknown enemy {boss['enemyId']!r}",
                         "boss")
        if boss["waveId"] not in wave_ids:
            report.error("unknown-wave",
                         f"boss references unknown wave {boss['waveId']!r}",
                         "boss")
    if data["victory"]["afterWave"] > len(waves):
        report.error("bad-victory",
                     f"victory.afterWave {data['victory']['afterWave']} exceeds"
                     f" wave count {len(waves)}", "victory")
    b = data["player"]["bounds"]
    if not (b["minX"] < b["maxX"] and b["minY"] < b["maxY"]):
        report.error("bad-bounds", "player bounds must satisfy min < max",
                     "player/bounds")
    world = data["world"]
    if not (0 <= b["minX"] and b["maxX"] <= world["width"]
            and 0 <= b["minY"] and b["maxY"] <= world["height"]):
        report.error("bad-bounds", "player bounds must sit inside the world",
                     "player/bounds")
    if not (b["minX"] <= data["player"]["x"] <= b["maxX"]
            and b["minY"] <= data["player"]["y"] <= b["maxY"]):
        report.error("bad-bounds", "player start must sit inside player bounds",
                     "player")
    return report


def validate_endless_runner_config(data: dict) -> Report:
    report = Report()
    if _schema_errors(report, data, "endless-runner.config.schema.json"):
        return report
    obstacles = data["obstacles"]
    _unique(report, obstacles, "id", "obstacles")
    sprites = (data.get("assets") or {}).get("sprites", {})
    for o in obstacles:
        if o["sprite"] not in sprites:
            report.error("unknown-sprite",
                         f"obstacle {o['id']!r} sprite {o['sprite']!r}"
                         " missing from assets.sprites",
                         f"obstacles/{o['id']}")
    world = data["world"]
    if world["maxSpeed"] < world["baseSpeed"]:
        report.error("bad-speed",
                     "world.maxSpeed must be >= world.baseSpeed", "world")
    spawning = data["spawning"]
    if spawning["minGapPx"] > spawning["startGapPx"]:
        report.error("bad-gap",
                     "spawning.minGapPx must be <= startGapPx", "spawning")
    player = data["player"]
    if not (player["slideHeight"] < player["height"]):
        report.error("bad-player",
                     "player.slideHeight must be < player.height", "player")
    return report


def validate_manifest(data: dict) -> Report:
    report = Report()
    _schema_errors(report, data, "export-manifest.schema.json")
    return report
