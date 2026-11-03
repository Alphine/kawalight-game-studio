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


_SIDE_GAP = {"easy": 90, "normal": 110, "hard": 130}
_SIDE_SPEED = {"easy": 280, "normal": 300, "hard": 320}
_SIDE_JUMP = {"easy": 820, "normal": 850, "hard": 880}
_SIDE_WALKER = {"easy": 70, "normal": 90, "hard": 110}
_HAZARD_TOKENS = ("spike", "spikes", "hazard", "saw", "lava")


def _is_hazard(obstacle_id: str) -> bool:
    lowered = obstacle_id.lower()
    return any(token in lowered for token in _HAZARD_TOKENS)


def assemble_side_scroller(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "side-scroller":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'side-scroller'"
        )
    preset = blueprint["difficulty"]["preset"]
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]
    foes = blueprint["obstacles"]

    ground_y = height - 70
    ground_h = height - ground_y
    level_width = min(12000, 2400 + 200 * len(foes))
    gap = _SIDE_GAP[preset]
    run_w = (level_width - 3 * gap) / 4

    enemies = [f for f in foes if not _is_hazard(f["id"])]
    hazards = [f for f in foes if _is_hazard(f["id"])]

    platforms = []
    cursor = 0.0
    pits = []
    for r in range(4):
        platforms.append({"x": cursor, "y": ground_y, "w": run_w, "h": ground_h})
        cursor += run_w
        if r < 3:
            pits.append(cursor)
            cursor += gap
    for r in range(1, 4):
        run_x = platforms[r]["x"]
        platforms.append({"x": run_x + run_w / 2 - 70, "y": ground_y - 90,
                          "w": 140, "h": 20, "oneWay": True})

    placed_enemies = []
    for j, foe in enumerate(enemies):
        run = platforms[(j % 3) + 1]
        span = max(10.0, run["w"] - 200)
        x = run["x"] + 60 + ((j * 37) % span)
        placed_enemies.append({
            "id": foe["id"],
            "kind": "walker",
            "sprite": "walker",
            "x": x,
            "y": ground_y - 28,
            "w": 36,
            "h": 28,
            "speed": _SIDE_WALKER[preset],
            "patrolMinX": run["x"] + 10,
            "patrolMaxX": run["x"] + run["w"] - 46,
        })

    placed_hazards = []
    for j, foe in enumerate(hazards):
        run = platforms[(j % 3) + 1]
        placed_hazards.append({
            "id": foe["id"],
            "sprite": "spikes",
            "x": run["x"] + run["w"] / 2 - 16,
            "y": ground_y - 24,
            "w": 32,
            "h": 24,
            "damage": 1,
        })

    collectibles = []
    for p, pit_x in enumerate(pits):
        for k, frac in enumerate((0.2, 0.35, 0.5, 0.65, 0.8)):
            lift = 40 if k in (1, 3) else (70 if k == 2 else 0)
            collectibles.append({
                "id": f"coin-p{p + 1}-{k + 1}",
                "x": pit_x + gap * frac,
                "y": ground_y - 70 - lift,
            })

    checkpoints = [
        {"id": "cp-1", "x": level_width * 0.375, "y": ground_y - 100,
         "w": 32, "h": 100},
        {"id": "cp-2", "x": level_width * 0.72, "y": ground_y - 100,
         "w": 32, "h": 100},
    ]

    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.side-scroller", "version": "1.0.0"},
        "seed": blueprint.get("seed"),
        "world": {
            "width": width,
            "height": height,
            "levelWidth": level_width,
            "levelHeight": height,
            "gravity": 2600,
            "maxFallSpeed": 1400,
            "killPlaneY": height + 60,
        },
        "player": {
            "spawn": {"x": 80, "y": ground_y - 44},
            "width": 32,
            "height": 44,
            "moveSpeed": _SIDE_SPEED[preset],
            "acceleration": 2600,
            "airControl": 0.65,
            "jumpVelocity": _SIDE_JUMP[preset],
            "coyoteMs": 100,
            "jumpBufferMs": 120,
            "maxJumps": 1,
            "health": blueprint["player"].get("health", 3),
            "invulnMs": 1200,
            "knockback": 280,
            "stompBounce": 560,
        },
        "level": {
            "platforms": platforms,
            "hazards": placed_hazards,
            "enemies": placed_enemies,
            "collectibles": collectibles,
            "checkpoints": checkpoints,
            "exit": {"x": level_width - 100, "y": ground_y - 80,
                     "w": 48, "h": 80, "sprite": "exit-door"},
        },
        "scoring": {"coinScore": 10, "stompScore": 25,
                    "timeBonusPerSec": 5,
                    "parTimeSec": 45 + level_width // 100},
        "difficulty": {"preset": preset},
        "controls": {"left": "LEFT", "right": "RIGHT", "jump": "SPACE",
                     "pause": "P"},
        "camera": {"followLerp": 0.12, "deadzoneX": 80, "deadzoneY": 60},
        "assets": {"sprites": {
            "player": "assets/player.png",
            "walker": "assets/walker.png",
            "spikes": "assets/spikes.png",
            "coin": "assets/coin.png",
            "exit-door": "assets/exit-door.png",
            "checkpoint": "assets/checkpoint.png",
        }},
    }


_BATTLE_SPEED = {"easy": 240, "normal": 280, "hard": 330}
_BATTLE_RANGED_CD = {"easy": 240, "normal": 200, "hard": 160}
_BATTLE_MELEE_CD = {"easy": 400, "normal": 350, "hard": 300}
_BATTLE_WAVES = {"easy": 3, "normal": 5, "hard": 7}
_BATTLE_BEHAVIORS = [
    {"type": "chaser", "amplitude": 0, "frequencyHz": 0},
    {"type": "weaver", "amplitude": 0.9, "frequencyHz": 2.2},
    {"type": "shooter", "amplitude": 0, "frequencyHz": 0,
     "preferredRange": 260, "fireRange": 430, "fireIntervalMs": 1700,
     "projectileSpeed": 250},
]


def assemble_battle_2d(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "battle-2d":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'battle-2d'"
        )
    preset = blueprint["difficulty"]["preset"]
    ramp = blueprint["difficulty"].get("ramp", "gradual")
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]

    enemies = []
    sprites = {"player": "assets/player.png", "shot": "assets/shot.png",
               "foe-shot": "assets/foe-shot.png",
               "pickup": "assets/pickup.png"}
    for i, foe in enumerate(blueprint["enemies"]):
        key = f"enemy-{foe['id']}"
        sprites[key] = f"assets/{key}.png"
        enemies.append({
            "id": foe["id"],
            "sprite": key,
            "health": 1 + i,
            "speed": min(90 + 25 * i, 600),
            "damage": 1,
            "score": 100 * (i + 1),
            "radius": 13,
            "behavior": dict(_BATTLE_BEHAVIORS[i % len(_BATTLE_BEHAVIORS)]),
        })

    wave_count = _BATTLE_WAVES[preset]
    waves = []
    for w in range(wave_count):
        waves.append({
            "id": f"wave-{w + 1}",
            "delayAfterPrevMs": 1500 if w == 0 else 2000,
            "spawns": [{
                "enemyId": enemies[(w + k) % len(enemies)]["id"],
                "count": 3 + w,
                "intervalMs": max(200, 900 - 80 * w),
            } for k in range(min(2, len(enemies)))],
            "boss": None,
        })

    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.battle-2d", "version": "1.0.0"},
        "seed": blueprint.get("seed"),
        "world": {"width": width, "height": height},
        "player": {
            "x": width / 2,
            "y": height / 2,
            "speed": _BATTLE_SPEED[preset],
            "health": blueprint["player"].get("health", 3),
            "lives": blueprint["player"].get("lives", 3),
            "invulnerableMs": 1200,
            "radius": 12,
            "bounds": {"minX": 40, "maxX": width - 40,
                       "minY": 70, "maxY": height - 40},
        },
        "melee": {"cooldownMs": _BATTLE_MELEE_CD[preset], "damage": 2,
                  "range": 72},
        "ranged": {
            "cooldownMs": _BATTLE_RANGED_CD[preset],
            "projectileSpeed": 560,
            "damage": 1,
            "poolSize": 48,
            "aimRange": 520,
        },
        "foeShots": {"poolSize": 64},
        "enemies": enemies,
        "waves": waves,
        "boss": None,
        "spawning": {"minDistFromPlayer": 240},
        "pickups": {"dropChance": 0.12, "healAmount": 1, "bonusScore": 50,
                    "ttlMs": 12000},
        "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
        "difficulty": {
            "preset": preset,
            "enemyHealthScalePerWave": _RAMP_SCALE[ramp],
            "enemySpeedScalePerWave": _RAMP_SCALE[ramp],
        },
        "controls": {"up": "W", "down": "S", "left": "A", "right": "D",
                     "fire": "SPACE", "melee": "J", "pause": "P"},
        "victory": {"afterWave": wave_count},
        "assets": {"sprites": sprites},
    }


_FARM_COINS = {"easy": (80, 300), "normal": (50, 500), "hard": (30, 800)}
_FARM_DAY = {"easy": 75, "normal": 60, "hard": 45}
_FARM_COST_SCALE = {"easy": 0.8, "normal": 1.0, "hard": 1.2}
_FARM_TIME_SCALE = {"easy": 0.8, "normal": 1.0, "hard": 1.25}
_FARM_CATALOG = [
    {"id": "turnip", "name": "Turnip", "seedCost": 5, "sellPrice": 12,
     "stages": 3, "stageTimeSec": 10},
    {"id": "pumpkin", "name": "Pumpkin", "seedCost": 20, "sellPrice": 55,
     "stages": 4, "stageTimeSec": 14},
]


def assemble_farming(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "farming":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'farming'"
        )
    preset = blueprint["difficulty"]["preset"]
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]
    start_coins, target_coins = _FARM_COINS[preset]

    crops = []
    sprites = {"soil": "assets/soil.png", "coin": "assets/coin.png",
               "farmer": "assets/farmer.png"}
    for entry in _FARM_CATALOG:
        key = f"crop-{entry['id']}"
        sprites[key] = f"assets/{key}.png"
        crops.append({
            "id": entry["id"],
            "name": entry["name"],
            "sprite": key,
            "seedCost": round(entry["seedCost"] * _FARM_COST_SCALE[preset]),
            "sellPrice": entry["sellPrice"],
            "stages": entry["stages"],
            "stageTimeSec": round(entry["stageTimeSec"]
                                  * _FARM_TIME_SCALE[preset], 1),
        })

    cols, rows = 6, 4
    plot = min(96, (width - 64) / cols, (height - 64) / rows)
    plot = max(24, plot)

    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.farming", "version": "1.0.0"},
        "seed": blueprint.get("seed"),
        "world": {"width": width, "height": height},
        "farm": {
            "cols": cols,
            "rows": rows,
            "plotSize": plot,
            "originX": (width - cols * plot) / 2,
            "originY": (height - rows * plot) / 2,
            "dayLengthSec": _FARM_DAY[preset],
        },
        "crops": crops,
        "scoring": {"startCoins": start_coins, "targetCoins": target_coins},
        "difficulty": {"preset": preset},
        "controls": {"toolPlant": "ONE", "toolWater": "TWO",
                     "toolHarvest": "THREE", "nextDay": "N", "pause": "P"},
        "assets": {"sprites": sprites},
    }


_PUZZLE_PRESETS = {
    "easy": (6, 6, 4, 30, 800),
    "normal": (7, 7, 5, 25, 1300),
    "hard": (8, 8, 6, 24, 1400),
}
_PUZZLE_GEMS = [
    {"id": "ruby", "name": "Ruby"},
    {"id": "sapphire", "name": "Sapphire"},
    {"id": "emerald", "name": "Emerald"},
    {"id": "topaz", "name": "Topaz"},
    {"id": "amethyst", "name": "Amethyst"},
]


def assemble_puzzle_match(blueprint: dict) -> dict:
    report = validate_blueprint(blueprint)
    if not report.ok:
        raise AssemblyError(f"invalid blueprint: {report.summary()}")
    if blueprint["genre"] != "puzzle-match":
        raise AssemblyError(
            f"blueprint genre is {blueprint['genre']!r}, not 'puzzle-match'"
        )
    preset = blueprint["difficulty"]["preset"]
    width = blueprint["resolution"]["width"]
    height = blueprint["resolution"]["height"]
    cols, rows, gem_count, moves, target = _PUZZLE_PRESETS[preset]

    gems = []
    sprites = {}
    for entry in _PUZZLE_GEMS[:gem_count]:
        key = f"gem-{entry['id']}"
        sprites[key] = f"assets/{key}.png"
        gems.append({"id": entry["id"], "name": entry["name"], "sprite": key})

    # Fit the board inside the world, keeping a strip at the top for the HUD.
    tile = int(min(64, (width - 64) / cols, (height - 96) / rows))
    tile = max(24, tile)
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.puzzle-match", "version": "1.0.0"},
        "seed": blueprint.get("seed"),
        "world": {"width": width, "height": height},
        "board": {
            "cols": cols,
            "rows": rows,
            "tileSize": tile,
            "originX": (width - cols * tile) / 2,
            "originY": (height - rows * tile) / 2 + 16,
        },
        "gems": gems,
        "scoring": {"targetScore": target, "pointsPerGem": 10,
                    "cascadeBonusPercent": 50},
        "moves": {"limit": moves},
        "difficulty": {"preset": preset},
        "controls": {"hint": "H", "reshuffle": "R", "pause": "P"},
        "assets": {"sprites": sprites},
    }
