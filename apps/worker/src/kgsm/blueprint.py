"""Blueprint -> template config assembly (FR-004/FR-005, FR-014).

Deterministic mapping: the same blueprint always produces the same config.
AI may propose blueprint text; only this validated data reaches the template.
"""

from __future__ import annotations

from .validation import validate_blueprint

TEMPLATE_ID = "phaser.space-shooter"
TEMPLATE_VERSION = "1.0.0"

_PLAYER_SPEED = {"easy": 260, "normal": 320, "hard": 380}
_WEAPON_COOLDOWN = {"easy": 220, "normal": 180, "hard": 150}
_WAVE_COUNT = {"easy": 3, "normal": 5, "hard": 7}
_RAMP_SCALE = {"flat": 0.0, "gradual": 0.05, "steep": 0.15}
_BEHAVIORS = [
    {"type": "drift", "amplitude": 0, "frequencyHz": 0},
    {"type": "sine", "amplitude": 60, "frequencyHz": 1.2},
    {"type": "dive", "amplitude": 0, "frequencyHz": 0},
]


class AssemblyError(Exception):
    pass


def assemble_space_shooter(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "space-shooter":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'space-shooter'"
        )
    preset = blueprint["difficulty"]["preset"]
    ramp = blueprint["difficulty"].get("ramp", "gradual")
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]

    enemies = []
    sprites = {"player": "assets/player.png", "shot": "assets/shot.png",
               "pickup": "assets/pickup.png"}
    for i, foe in enumerate(blueprint["enemies"]):
        key = f"enemy-{foe['id']}"
        sprites[key] = f"assets/{key}.png"
        enemies.append({
            "id": foe["id"],
            "sprite": key,
            "health": 1 + i,
            "speed": 90 + 25 * i,
            "damage": 1,
            "score": 100 * (i + 1),
            "radius": 14,
            "behavior": dict(_BEHAVIORS[i % len(_BEHAVIORS)]),
        })

    wave_count = _WAVE_COUNT[preset]
    waves = []
    for w in range(wave_count):
        waves.append({
            "id": f"wave-{w + 1}",
            "delayAfterPrevMs": 1500,
            "spawns": [{
                "enemyId": enemies[(w + k) % len(enemies)]["id"],
                "count": 3 + w,
                "intervalMs": max(200, 900 - 80 * w),
            } for k in range(min(2, len(enemies)))],
            "boss": None,
        })

    return {
        "schemaVersion": "1.0.0",
        "template": {"id": TEMPLATE_ID, "version": TEMPLATE_VERSION},
        "seed": blueprint.get("seed"),
        "world": {"width": width, "height": height},
        "player": {
            "x": width * 0.2,
            "y": height * 0.5,
            "speed": _PLAYER_SPEED[preset],
            "health": blueprint["player"].get("health", 3),
            "lives": blueprint["player"].get("lives", 3),
            "invulnerableMs": 1200,
            "radius": 12,
            "bounds": {"minX": 8, "maxX": width * 0.6,
                       "minY": 8, "maxY": height - 8},
        },
        "weapon": {
            "cooldownMs": _WEAPON_COOLDOWN[preset],
            "projectileSpeed": 520,
            "damage": 1,
            "poolSize": 64,
            "powerupLevels": 3,
        },
        "enemies": enemies,
        "waves": waves,
        "boss": None,
        "pickups": {"dropChance": 0.15, "powerupBonus": 50},
        "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
        "difficulty": {
            "preset": preset,
            "enemyHealthScalePerWave": _RAMP_SCALE[ramp],
            "enemySpeedScalePerWave": _RAMP_SCALE[ramp],
        },
        "controls": {"up": "W", "down": "S", "left": "A", "right": "D",
                     "fire": "SPACE", "pause": "P"},
        "victory": {"afterWave": wave_count},
        "assets": {"sprites": sprites},
    }


_RUNNER_SPEEDS = {"easy": (240, 440), "normal": (280, 560), "hard": (330, 680)}
_RUNNER_RAMP = {"flat": 0.0, "gradual": 6.0, "steep": 14.0}
_RUNNER_START_GAP = {"easy": 700, "normal": 600, "hard": 520}
_RUNNER_MIN_GAP = {"easy": 560, "normal": 480, "hard": 400}
_RUNNER_JUMP = {"easy": 820, "normal": 880, "hard": 940}
_RUNNER_KINDS = ["ground", "ground", "high"]


def assemble_endless_runner(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "endless-runner":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'endless-runner'"
        )
    preset = blueprint["difficulty"]["preset"]
    ramp = blueprint["difficulty"].get("ramp", "gradual")
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]
    base_speed, max_speed = _RUNNER_SPEEDS[preset]

    obstacles = []
    sprites = {"player": "assets/player.png", "coin": "assets/coin.png"}
    for i, foe in enumerate(blueprint["obstacles"]):
        key = f"obstacle-{foe['id']}"
        sprites[key] = f"assets/{key}.png"
        kind = _RUNNER_KINDS[i % len(_RUNNER_KINDS)]
        entry: dict = {
            "id": foe["id"],
            "sprite": key,
            "w": 30 + 3 * i,
            "h": 26 if kind == "high" else 40 + 8 * i,
            "kind": kind,
        }
        if kind == "high":
            entry["hoverH"] = 30
        obstacles.append(entry)

    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.endless-runner", "version": "1.0.0"},
        "seed": blueprint.get("seed"),
        "world": {
            "width": width,
            "height": height,
            "groundY": height - 70,
            "gravity": 3000,
            "baseSpeed": base_speed,
            "maxSpeed": max_speed,
            "speedRampPerSec": _RUNNER_RAMP[ramp],
            "pxPerMeter": 50,
        },
        "player": {
            "x": round(width * 0.1875, 1),
            "width": 36,
            "height": 48,
            "slideHeight": 24,
            "jumpVelocity": _RUNNER_JUMP[preset],
        },
        "spawning": {
            "gracePx": 1400,
            "startGapPx": _RUNNER_START_GAP[preset],
            "minGapPx": _RUNNER_MIN_GAP[preset],
            "spawnAheadPx": 80,
        },
        "obstacles": obstacles,
        "scoring": {"coinScore": 10, "milestoneEveryM": 100},
        "difficulty": {"preset": preset},
        "controls": {"jump": "SPACE", "slide": "S", "pause": "P"},
        "assets": {"sprites": sprites},
    }
