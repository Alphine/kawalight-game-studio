"""Config validator tests (NFR-009, FR-016)."""

import copy

import pytest

from kgsm.validation import (
    validate_blueprint,
    validate_space_shooter_config,
)


def make_blueprint():
    return {
        "schemaVersion": "1.0.0",
        "projectName": "Galaxy Strike",
        "genre": "space-shooter",
        "theme": "Alien Invasion",
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard"},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "fly, shoot, survive waves",
        "player": {"abilities": ["move", "shoot"], "health": 3, "lives": 3},
        "enemies": [{"id": "drone", "role": "basic chaser"}],
        "progression": "waves scale up",
        "scoring": "kills and wave bonus",
        "winCondition": "clear all waves",
        "loseCondition": "lose all lives",
    }


def make_config():
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.space-shooter", "version": "1.0.0"},
        "seed": 42,
        "world": {"width": 960, "height": 540},
        "player": {
            "x": 120, "y": 270, "speed": 320, "health": 3, "lives": 3,
            "invulnerableMs": 1200, "radius": 12,
            "bounds": {"minX": 8, "maxX": 576, "minY": 8, "maxY": 532},
        },
        "weapon": {"cooldownMs": 180, "projectileSpeed": 520, "damage": 1,
                   "poolSize": 64, "powerupLevels": 3},
        "enemies": [{
            "id": "drone", "sprite": "enemy-drone", "health": 1, "speed": 90,
            "damage": 1, "score": 100, "radius": 14,
            "behavior": {"type": "sine", "amplitude": 60, "frequencyHz": 1.2},
        }],
        "waves": [{
            "id": "wave-1", "delayAfterPrevMs": 1500, "boss": None,
            "spawns": [{"enemyId": "drone", "count": 3, "intervalMs": 900}],
        }],
        "boss": None,
        "pickups": {"dropChance": 0.15, "powerupBonus": 50},
        "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
        "difficulty": {"preset": "normal", "enemyHealthScalePerWave": 0.05,
                       "enemySpeedScalePerWave": 0.05},
        "controls": {"up": "W", "down": "S", "left": "A", "right": "D",
                     "fire": "SPACE", "pause": "P"},
        "victory": {"afterWave": 1},
        "assets": {"sprites": {"player": "assets/player.png",
                               "shot": "assets/shot.png",
                               "pickup": "assets/pickup.png",
                               "enemy-drone": "assets/enemy-drone.png"}},
    }


def test_valid_blueprint_and_config():
    assert validate_blueprint(make_blueprint()).ok
    report = validate_space_shooter_config(make_config())
    assert report.ok, report.to_dict()


def test_blueprint_rejects_schema_and_duplicate_enemies():
    bad = make_blueprint()
    del bad["theme"]
    assert not validate_blueprint(bad).ok
    dup = make_blueprint()
    dup["enemies"].append({"id": "drone", "role": "copy"})
    report = validate_blueprint(dup)
    assert not report.ok
    assert report.errors()[0].code == "duplicate-id"


@pytest.mark.parametrize("mutate,code", [
    (lambda c: c["waves"][0]["spawns"].append(
        {"enemyId": "ghost", "count": 1, "intervalMs": 500}), "unknown-enemy"),
    (lambda c: c.update(boss={"enemyId": "ghost", "waveId": "wave-1",
                              "healthMultiplier": 8}), "unknown-enemy"),
    (lambda c: c.update(victory={"afterWave": 9}), "bad-victory"),
    (lambda c: c["player"]["bounds"].update(minX=900), "bad-bounds"),
    (lambda c: c["enemies"].append(copy.deepcopy(c["enemies"][0])),
     "duplicate-id"),
])
def test_config_semantic_errors(mutate, code):
    config = make_config()
    mutate(config)
    report = validate_space_shooter_config(config)
    assert not report.ok
    assert code in {i.code for i in report.errors()}


def test_missing_sprite_key_rejected():
    config = make_config()
    del config["assets"]["sprites"]["enemy-drone"]
    report = validate_space_shooter_config(config)
    assert not report.ok
    assert "unknown-sprite" in {i.code for i in report.errors()}


from kgsm.validation import (  # noqa: E402 - runner block appended in M2
    validate_endless_runner_config,
)


def make_runner_blueprint():
    return {
        "schemaVersion": "1.0.0",
        "projectName": "Skyline Sprint",
        "genre": "endless-runner",
        "theme": "Neon Rooftops",
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard", "actions": ["jump", "slide"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "run, jump, slide, survive",
        "player": {"abilities": ["jump", "slide"], "health": 1, "lives": 1},
        "obstacles": [
            {"id": "spike", "role": "low spikes"},
            {"id": "drone", "role": "hovering drone"},
        ],
        "collectibles": "coins",
        "progression": "endless ramp",
        "scoring": "meters + coins",
        "winCondition": "beat best distance",
        "loseCondition": "hit anything",
    }


def make_runner_config():
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.endless-runner", "version": "1.0.0"},
        "seed": 7,
        "world": {"width": 960, "height": 540, "groundY": 470, "gravity": 3000,
                  "baseSpeed": 280, "maxSpeed": 560, "speedRampPerSec": 6,
                  "pxPerMeter": 50},
        "player": {"x": 180, "width": 36, "height": 48, "slideHeight": 24,
                   "jumpVelocity": 880},
        "spawning": {"gracePx": 1400, "startGapPx": 600, "minGapPx": 480,
                     "spawnAheadPx": 80},
        "obstacles": [
            {"id": "spike", "sprite": "obstacle-spike", "w": 30, "h": 40,
             "kind": "ground"},
            {"id": "drone", "sprite": "obstacle-drone", "w": 40, "h": 26,
             "kind": "high", "hoverH": 30},
        ],
        "scoring": {"coinScore": 10, "milestoneEveryM": 100},
        "difficulty": {"preset": "normal"},
        "controls": {"jump": "SPACE", "slide": "S", "pause": "P"},
        "assets": {"sprites": {"player": "assets/player.png",
                               "coin": "assets/coin.png",
                               "obstacle-spike": "assets/obstacle-spike.png",
                               "obstacle-drone": "assets/obstacle-drone.png"}},
    }


def test_valid_runner_blueprint_and_config():
    assert validate_blueprint(make_runner_blueprint()).ok
    report = validate_endless_runner_config(make_runner_config())
    assert report.ok, report.to_dict()


def test_blueprint_genre_conditionals():
    runner = make_runner_blueprint()
    del runner["obstacles"]
    assert not validate_blueprint(runner).ok
    dup = make_runner_blueprint()
    dup["obstacles"] = [{"id": "spike", "role": "x"},
                        {"id": "spike", "role": "dup"}]
    report = validate_blueprint(dup)
    assert not report.ok
    assert report.errors()[0].code == "duplicate-id"


@pytest.mark.parametrize("mutate,code", [
    (lambda c: c["world"].update(maxSpeed=100), "bad-speed"),
    (lambda c: c["spawning"].update(minGapPx=900), "bad-gap"),
    (lambda c: c["player"].update(slideHeight=48), "bad-player"),
    (lambda c: c["obstacles"].append(copy.deepcopy(c["obstacles"][0])),
     "duplicate-id"),
])
def test_runner_config_semantic_errors(mutate, code):
    config = make_runner_config()
    mutate(config)
    report = validate_endless_runner_config(config)
    assert not report.ok
    assert code in {i.code for i in report.errors()}


def test_runner_missing_sprite_key_rejected():
    config = make_runner_config()
    del config["assets"]["sprites"]["obstacle-drone"]
    report = validate_endless_runner_config(config)
    assert not report.ok
    assert "unknown-sprite" in {i.code for i in report.errors()}
