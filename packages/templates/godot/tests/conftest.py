"""Pytest fixtures for the standalone Godot exporter suite."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

GENRES = (
    "space-shooter",
    "endless-runner",
    "side-scroller",
    "battle-2d",
    "farming",
)


def make_blueprint(genre: str, **overrides) -> dict:
    blueprint = {
        "schemaVersion": "1.0.0",
        "projectName": f"Test {genre}",
        "genre": genre,
        "theme": "Test theme",
        "visualStyle": "pixel-art",
        "targetRuntime": "godot4",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard"},
        "difficulty": {"preset": "normal"},
        "gameLoop": "Test loop.",
        "player": {"abilities": ["move"]},
        "progression": "Test.",
        "scoring": "Test.",
        "winCondition": "Win.",
        "loseCondition": "Lose.",
    }
    blueprint.update(overrides)
    return blueprint


def _base_config(genre: str) -> dict:
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": f"godot.{genre}", "version": "1.0.0"},
        "seed": 7,
        "world": {"width": 960, "height": 540},
        "scoring": {},
        "difficulty": {"preset": "normal"},
        "controls": {},
    }


def make_config(genre: str) -> dict:
    cfg = _base_config(genre)
    if genre == "space-shooter":
        cfg.update({
            "player": {
                "x": 192.0, "y": 270.0, "speed": 320, "health": 3,
                "lives": 3, "invulnerableMs": 1200, "radius": 12,
                "bounds": {"minX": 8, "maxX": 576.0, "minY": 8,
                           "maxY": 532},
            },
            "weapon": {"cooldownMs": 180, "projectileSpeed": 520,
                       "damage": 1, "poolSize": 16, "powerupLevels": 3},
            "enemies": [{
                "id": "drone", "sprite": "enemy-drone", "health": 1,
                "speed": 90, "damage": 1, "score": 100, "radius": 14,
                "behavior": {"type": "drift"},
            }],
            "waves": [{
                "id": "wave-1", "delayAfterPrevMs": 500,
                "spawns": [{"enemyId": "drone", "count": 2,
                            "intervalMs": 900}],
            }],
            "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
            "controls": {"up": "W", "down": "S", "left": "A",
                         "right": "D", "fire": "SPACE", "pause": "P"},
            "victory": {"afterWave": 1},
            "assets": {"sprites": {
                "player": "assets/player.png",
                "shot": "assets/shot.png",
                "pickup": "assets/pickup.png",
            }},
        })
    elif genre == "endless-runner":
        cfg["world"].update({
            "groundY": 470, "gravity": 3000, "baseSpeed": 280,
            "maxSpeed": 560, "speedRampPerSec": 6, "pxPerMeter": 50,
        })
        cfg.update({
            "player": {"x": 180, "width": 36, "height": 48,
                       "slideHeight": 24, "jumpVelocity": 880},
            "spawning": {"gracePx": 200, "startGapPx": 600,
                         "minGapPx": 480, "spawnAheadPx": 80},
            "obstacles": [{"id": "spike", "sprite": "obstacle-spike",
                           "w": 30, "h": 40, "kind": "ground"}],
            "scoring": {"coinScore": 10, "milestoneEveryM": 100},
            "controls": {"jump": "SPACE", "slide": "S", "pause": "P"},
            "assets": {"sprites": {
                "player": "assets/player.png",
                "coin": "assets/coin.png",
            }},
        })
    elif genre == "side-scroller":
        cfg["world"].update({
            "levelWidth": 1920, "levelHeight": 540, "gravity": 2600,
            "maxFallSpeed": 1400, "killPlaneY": 600,
        })
        cfg.update({
            "player": {
                "spawn": {"x": 80, "y": 426}, "width": 32, "height": 44,
                "moveSpeed": 300, "acceleration": 2600,
                "airControl": 0.65, "jumpVelocity": 850, "coyoteMs": 100,
                "jumpBufferMs": 120, "maxJumps": 1, "health": 3,
                "invulnMs": 1200, "knockback": 280, "stompBounce": 560,
            },
            "level": {
                "platforms": [{"x": 0, "y": 470, "w": 1920, "h": 70}],
                "exit": {"x": 1800, "y": 390, "w": 48, "h": 80,
                         "sprite": "exit-door"},
            },
            "scoring": {"coinScore": 10, "stompScore": 25,
                        "timeBonusPerSec": 5, "parTimeSec": 60},
            "controls": {"left": "LEFT", "right": "RIGHT", "jump": "SPACE",
                         "pause": "P"},
            "assets": {"sprites": {"player": "assets/player.png"}},
        })
    elif genre == "battle-2d":
        cfg.update({
            "player": {
                "x": 480.0, "y": 300.0, "speed": 280, "health": 3,
                "lives": 3, "invulnerableMs": 1200, "radius": 12,
                "bounds": {"minX": 40, "maxX": 920, "minY": 70,
                           "maxY": 500},
            },
            "melee": {"cooldownMs": 350, "damage": 2, "range": 72},
            "ranged": {"cooldownMs": 200, "projectileSpeed": 560,
                       "damage": 1, "poolSize": 16, "aimRange": 520},
            "enemies": [{
                "id": "grunt", "sprite": "enemy-grunt", "health": 2,
                "speed": 95, "damage": 1, "score": 100, "radius": 13,
                "behavior": {"type": "chaser"},
            }],
            "waves": [{
                "id": "wave-1", "delayAfterPrevMs": 500,
                "spawns": [{"enemyId": "grunt", "count": 2,
                            "intervalMs": 900}],
            }],
            "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
            "controls": {"up": "W", "down": "S", "left": "A",
                         "right": "D", "fire": "SPACE", "melee": "J",
                         "pause": "P"},
            "victory": {"afterWave": 1},
            "assets": {"sprites": {"player": "assets/player.png"}},
        })
    elif genre == "farming":
        cfg.update({
            "farm": {"cols": 3, "rows": 2, "plotSize": 96,
                     "originX": 192, "originY": 92, "dayLengthSec": 60},
            "crops": [{
                "id": "turnip", "name": "Turnip", "sprite": "crop-turnip",
                "seedCost": 5, "sellPrice": 12, "stages": 3,
                "stageTimeSec": 10,
            }],
            "scoring": {"startCoins": 50, "targetCoins": 500},
            "controls": {"toolPlant": "ONE", "toolWater": "TWO",
                         "toolHarvest": "THREE", "nextDay": "N",
                         "pause": "P"},
            "assets": {"sprites": {"soil": "assets/soil.png"}},
        })
    else:
        raise AssertionError(f"unknown genre {genre}")
    return cfg


@pytest.fixture(params=GENRES)
def genre(request) -> str:
    return request.param


@pytest.fixture()
def blueprint(genre) -> dict:
    return make_blueprint(genre)


@pytest.fixture()
def config(genre) -> dict:
    return make_config(genre)
