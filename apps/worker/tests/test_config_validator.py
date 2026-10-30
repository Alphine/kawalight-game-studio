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


from kgsm.validation import (  # noqa: E402 - new-genre block appended in M3
    validate_battle_2d_config,
    validate_farming_config,
    validate_side_scroller_config,
)


def make_side_blueprint():
    return {
        "schemaVersion": "1.0.0",
        "projectName": "Cliff Hopper",
        "genre": "side-scroller",
        "theme": "Mossy Cliffs",
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard",
                     "actions": ["left", "right", "jump"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "run, jump, stomp, reach the exit",
        "player": {"abilities": ["run", "jump"], "health": 3, "lives": 1},
        "obstacles": [
            {"id": "walker-1", "role": "patrolling crawler"},
            {"id": "spikes-1", "role": "static spikes"},
        ],
        "collectibles": "coins",
        "progression": "single hand-tuned level",
        "scoring": "coins and stomps",
        "winCondition": "touch the exit",
        "loseCondition": "lose all health",
    }


def make_side_config():
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.side-scroller", "version": "1.0.0"},
        "seed": 7,
        "world": {"width": 960, "height": 540, "levelWidth": 2400,
                  "levelHeight": 540, "gravity": 2600, "maxFallSpeed": 1400,
                  "killPlaneY": 600},
        "player": {
            "spawn": {"x": 80, "y": 426}, "width": 32, "height": 44,
            "moveSpeed": 300, "acceleration": 2600, "airControl": 0.65,
            "jumpVelocity": 850, "coyoteMs": 100, "jumpBufferMs": 120,
            "maxJumps": 1, "health": 3, "invulnMs": 1200,
            "knockback": 280, "stompBounce": 560,
        },
        "level": {
            "platforms": [{"x": 0, "y": 470, "w": 2400, "h": 70}],
            "hazards": [{"id": "spikes-1", "sprite": "spikes", "x": 500,
                         "y": 446, "w": 32, "h": 24}],
            "enemies": [{
                "id": "walker-1", "kind": "walker", "sprite": "walker",
                "x": 800, "y": 442, "w": 36, "h": 28, "speed": 90,
                "patrolMinX": 700, "patrolMaxX": 900,
            }],
            "collectibles": [{"id": "coin-1", "x": 300, "y": 400}],
            "checkpoints": [{"id": "cp-1", "x": 1200, "y": 370, "w": 32,
                             "h": 100}],
            "exit": {"x": 2300, "y": 390, "w": 48, "h": 80,
                     "sprite": "exit-door"},
        },
        "scoring": {"coinScore": 10, "stompScore": 25, "timeBonusPerSec": 5,
                    "parTimeSec": 60},
        "difficulty": {"preset": "normal"},
        "controls": {"left": "LEFT", "right": "RIGHT", "jump": "SPACE",
                     "pause": "P"},
        "camera": {"followLerp": 0.12, "deadzoneX": 80, "deadzoneY": 60},
        "assets": {"sprites": {"player": "assets/player.png",
                               "walker": "assets/walker.png",
                               "spikes": "assets/spikes.png",
                               "coin": "assets/coin.png",
                               "exit-door": "assets/exit-door.png",
                               "checkpoint": "assets/checkpoint.png"}},
    }


def make_battle_blueprint():
    return {
        "schemaVersion": "1.0.0",
        "projectName": "Arena Clash",
        "genre": "battle-2d",
        "theme": "Monster Arena",
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "keyboard",
                     "actions": ["move", "fire", "melee"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "kite packs, snipe foes, slash close attackers",
        "player": {"abilities": ["move", "shoot", "melee"], "health": 3,
                   "lives": 3},
        "enemies": [
            {"id": "grunt", "role": "tanky chaser"},
            {"id": "stinger", "role": "ranged shooter"},
        ],
        "progression": "waves scale up",
        "scoring": "kills and wave bonus",
        "winCondition": "clear all waves",
        "loseCondition": "lose all lives",
    }


def make_battle_config():
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.battle-2d", "version": "1.0.0"},
        "seed": 42,
        "world": {"width": 960, "height": 540},
        "player": {
            "x": 480, "y": 300, "speed": 280, "health": 3, "lives": 3,
            "invulnerableMs": 1200, "radius": 12,
            "bounds": {"minX": 40, "maxX": 920, "minY": 70, "maxY": 500},
        },
        "melee": {"cooldownMs": 350, "damage": 2, "range": 72},
        "ranged": {"cooldownMs": 200, "projectileSpeed": 560, "damage": 1,
                   "poolSize": 48, "aimRange": 520},
        "foeShots": {"poolSize": 64},
        "enemies": [
            {"id": "grunt", "sprite": "enemy-grunt", "health": 2,
             "speed": 95, "damage": 1, "score": 100, "radius": 13,
             "behavior": {"type": "chaser"}},
            {"id": "stinger", "sprite": "enemy-stinger", "health": 2,
             "speed": 80, "damage": 1, "score": 250, "radius": 13,
             "behavior": {"type": "shooter", "preferredRange": 260,
                          "fireRange": 430, "fireIntervalMs": 1700,
                          "projectileSpeed": 250}},
        ],
        "waves": [
            {"id": "wave-1", "delayAfterPrevMs": 1200, "boss": None,
             "spawns": [{"enemyId": "grunt", "count": 4,
                         "intervalMs": 900}]},
            {"id": "wave-2", "delayAfterPrevMs": 2000, "boss": None,
             "spawns": [{"enemyId": "stinger", "count": 2,
                         "intervalMs": 1200}]},
        ],
        "boss": None,
        "spawning": {"minDistFromPlayer": 240},
        "pickups": {"dropChance": 0.12, "healAmount": 1, "bonusScore": 50,
                    "ttlMs": 12000},
        "scoring": {"killMultiplier": 1.0, "waveClearBonus": 250},
        "difficulty": {"preset": "normal", "enemyHealthScalePerWave": 0.05,
                       "enemySpeedScalePerWave": 0.05},
        "controls": {"up": "W", "down": "S", "left": "A", "right": "D",
                     "fire": "SPACE", "melee": "J", "pause": "P"},
        "victory": {"afterWave": 2},
        "assets": {"sprites": {"player": "assets/player.png",
                               "shot": "assets/shot.png",
                               "foe-shot": "assets/foe-shot.png",
                               "pickup": "assets/pickup.png",
                               "enemy-grunt": "assets/enemy-grunt.png",
                               "enemy-stinger": "assets/enemy-stinger.png"}},
    }


def make_farm_blueprint():
    return {
        "schemaVersion": "1.0.0",
        "projectName": "Sunny Acres",
        "genre": "farming",
        "theme": "Sunny Acres",
        "visualStyle": "pixel-art",
        "targetRuntime": "phaser3-html5",
        "resolution": {"width": 960, "height": 540},
        "controls": {"scheme": "mouse-keyboard",
                     "actions": ["plant", "water", "harvest", "sleep"]},
        "difficulty": {"preset": "normal", "ramp": "gradual"},
        "gameLoop": "plant, water, harvest, bank coins",
        "player": {"abilities": ["plant", "water", "harvest"], "health": 1,
                   "lives": 1},
        "obstacles": [
            {"id": "thirst", "role": "each stage needs watering"},
            {"id": "funds", "role": "seeds cost coins"},
        ],
        "collectibles": "harvest payouts",
        "progression": "day cycle with morning rain",
        "scoring": "coins from harvests",
        "winCondition": "bank 500 coins",
        "loseCondition": "none; cozy until the goal is banked",
        "seed": 7,
    }


def make_farm_config():
    return {
        "schemaVersion": "1.0.0",
        "template": {"id": "phaser.farming", "version": "1.0.0"},
        "seed": 7,
        "world": {"width": 960, "height": 540},
        "farm": {"cols": 6, "rows": 4, "plotSize": 96, "originX": 192,
                 "originY": 92, "dayLengthSec": 60},
        "crops": [
            {"id": "turnip", "name": "Turnip", "sprite": "crop-turnip",
             "seedCost": 5, "sellPrice": 12, "stages": 3,
             "stageTimeSec": 10},
            {"id": "pumpkin", "name": "Pumpkin", "sprite": "crop-pumpkin",
             "seedCost": 20, "sellPrice": 55, "stages": 4,
             "stageTimeSec": 14},
        ],
        "scoring": {"startCoins": 50, "targetCoins": 500},
        "difficulty": {"preset": "normal"},
        "controls": {"toolPlant": "ONE", "toolWater": "TWO",
                     "toolHarvest": "THREE", "nextDay": "N", "pause": "P"},
        "assets": {"sprites": {"soil": "assets/soil.png",
                               "crop-turnip": "assets/crop-turnip.png",
                               "crop-pumpkin": "assets/crop-pumpkin.png",
                               "coin": "assets/coin.png",
                               "farmer": "assets/farmer.png"}},
    }


def test_valid_side_battle_farm_blueprints_and_configs():
    assert validate_blueprint(make_side_blueprint()).ok
    report = validate_side_scroller_config(make_side_config())
    assert report.ok, report.to_dict()
    assert validate_blueprint(make_battle_blueprint()).ok
    report = validate_battle_2d_config(make_battle_config())
    assert report.ok, report.to_dict()
    assert validate_blueprint(make_farm_blueprint()).ok
    report = validate_farming_config(make_farm_config())
    assert report.ok, report.to_dict()


def test_new_genre_blueprint_conditionals():
    side = make_side_blueprint()
    del side["obstacles"]
    assert not validate_blueprint(side).ok
    dup = make_side_blueprint()
    dup["obstacles"] = [{"id": "walker-1", "role": "x"},
                        {"id": "walker-1", "role": "dup"}]
    report = validate_blueprint(dup)
    assert not report.ok
    assert report.errors()[0].code == "duplicate-id"

    battle = make_battle_blueprint()
    del battle["enemies"]
    assert not validate_blueprint(battle).ok
    dup = make_battle_blueprint()
    dup["enemies"] = [{"id": "grunt", "role": "x"},
                      {"id": "grunt", "role": "dup"}]
    report = validate_blueprint(dup)
    assert not report.ok
    assert report.errors()[0].code == "duplicate-id"

    farm = make_farm_blueprint()
    del farm["obstacles"]
    assert not validate_blueprint(farm).ok
    dup = make_farm_blueprint()
    dup["obstacles"] = [{"id": "thirst", "role": "x"},
                        {"id": "thirst", "role": "dup"}]
    report = validate_blueprint(dup)
    assert not report.ok
    assert report.errors()[0].code == "duplicate-id"


@pytest.mark.parametrize("make,validate,mutate,code", [
    ("side", validate_side_scroller_config,
     lambda c: c["level"]["enemies"][0].update(
         patrolMinX=900, patrolMaxX=700), "bad-patrol"),
    ("side", validate_side_scroller_config,
     lambda c: c["level"]["exit"].update(x=9999), "bad-exit"),
    ("side", validate_side_scroller_config,
     lambda c: c["player"]["spawn"].update(x=-50), "bad-spawn"),
    ("side", validate_side_scroller_config,
     lambda c: c["level"]["enemies"].append(
         copy.deepcopy(c["level"]["enemies"][0])), "duplicate-id"),
    ("battle", validate_battle_2d_config,
     lambda c: c["waves"][0]["spawns"].append(
         {"enemyId": "ghost", "count": 1, "intervalMs": 500}),
     "unknown-enemy"),
    ("battle", validate_battle_2d_config,
     lambda c: c.update(victory={"afterWave": 9}), "bad-victory"),
    ("battle", validate_battle_2d_config,
     lambda c: c["player"]["bounds"].update(minX=900), "bad-bounds"),
    ("battle", validate_battle_2d_config,
     lambda c: c["enemies"].append(copy.deepcopy(c["enemies"][0])),
     "duplicate-id"),
    ("farm", validate_farming_config,
     lambda c: c["farm"].update(originX=9000), "bad-farm"),
    ("farm", validate_farming_config,
     lambda c: c["crops"].append(copy.deepcopy(c["crops"][0])),
     "duplicate-id"),
])
def test_new_genre_config_semantic_errors(make, validate, mutate, code):
    makers = {"side": make_side_config, "battle": make_battle_config,
              "farm": make_farm_config}
    config = makers[make]()
    mutate(config)
    report = validate(config)
    assert not report.ok
    assert code in {i.code for i in report.errors()}


def test_new_genre_missing_sprite_key_rejected():
    config = make_side_config()
    del config["assets"]["sprites"]["walker"]
    report = validate_side_scroller_config(config)
    assert not report.ok
    assert "unknown-sprite" in {i.code for i in report.errors()}

    config = make_battle_config()
    del config["assets"]["sprites"]["enemy-grunt"]
    report = validate_battle_2d_config(config)
    assert not report.ok
    assert "unknown-sprite" in {i.code for i in report.errors()}

    config = make_farm_config()
    del config["assets"]["sprites"]["crop-turnip"]
    report = validate_farming_config(config)
    assert not report.ok
    assert "unknown-sprite" in {i.code for i in report.errors()}


def test_battle_shooter_without_fire_tuning_warns():
    config = make_battle_config()
    config["enemies"][1]["behavior"] = {"type": "shooter"}
    report = validate_battle_2d_config(config)
    assert report.ok, report.to_dict()
    assert "incomplete-shooter" in {i.code for i in report.warnings()}
