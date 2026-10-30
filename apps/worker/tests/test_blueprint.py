"""Blueprint assembly tests (FR-004/FR-005, FR-014)."""

import pytest

from kgsm.blueprint import AssemblyError, assemble_space_shooter
from kgsm.validation import validate_space_shooter_config
from test_config_validator import make_blueprint


def test_assembled_config_validates():
    config = assemble_space_shooter(make_blueprint())
    report = validate_space_shooter_config(config)
    assert report.ok, report.to_dict()
    assert config["template"]["id"] == "phaser.space-shooter"
    assert config["victory"]["afterWave"] == len(config["waves"])


def test_assembly_is_deterministic():
    assert assemble_space_shooter(make_blueprint()) == \
        assemble_space_shooter(make_blueprint())


def test_assembly_rejects_wrong_genre_and_bad_blueprint():
    other = make_blueprint()
    other["genre"] = "farming"
    with pytest.raises(AssemblyError):
        assemble_space_shooter(other)
    bad = make_blueprint()
    del bad["enemies"]
    with pytest.raises(AssemblyError):
        assemble_space_shooter(bad)


from kgsm.blueprint import (  # noqa: E402 - runner block appended in M2
    assemble_endless_runner,
)
from kgsm.validation import validate_endless_runner_config
from test_config_validator import make_runner_blueprint


def test_assembled_runner_config_validates():
    config = assemble_endless_runner(make_runner_blueprint())
    report = validate_endless_runner_config(config)
    assert report.ok, report.to_dict()
    assert config["template"]["id"] == "phaser.endless-runner"


def test_runner_assembly_is_deterministic():
    assert assemble_endless_runner(make_runner_blueprint()) == \
        assemble_endless_runner(make_runner_blueprint())


def test_runner_assembly_rejects_wrong_genre():
    other = make_runner_blueprint()
    other["genre"] = "space-shooter"
    other["enemies"] = [{"id": "drone", "role": "x"}]
    with pytest.raises(AssemblyError):
        assemble_endless_runner(other)


from kgsm.blueprint import (  # noqa: E402 - new-genre block appended in M3
    assemble_battle_2d,
    assemble_farming,
    assemble_side_scroller,
)
from kgsm.validation import (
    validate_battle_2d_config,
    validate_farming_config,
    validate_side_scroller_config,
)
from test_config_validator import (
    make_battle_blueprint,
    make_farm_blueprint,
    make_side_blueprint,
)


def test_assembled_side_config_validates():
    config = assemble_side_scroller(make_side_blueprint())
    report = validate_side_scroller_config(config)
    assert report.ok, report.to_dict()
    assert config["template"]["id"] == "phaser.side-scroller"
    assert {e["id"] for e in config["level"]["enemies"]} == {"walker-1"}
    assert {h["id"] for h in config["level"]["hazards"]} == {"spikes-1"}


def test_side_assembly_is_deterministic():
    assert assemble_side_scroller(make_side_blueprint()) == \
        assemble_side_scroller(make_side_blueprint())


def test_side_assembly_rejects_wrong_genre_and_bad_blueprint():
    other = make_side_blueprint()
    other["genre"] = "farming"
    with pytest.raises(AssemblyError):
        assemble_side_scroller(other)
    bad = make_side_blueprint()
    del bad["obstacles"]
    with pytest.raises(AssemblyError):
        assemble_side_scroller(bad)


def test_assembled_battle_config_validates():
    config = assemble_battle_2d(make_battle_blueprint())
    report = validate_battle_2d_config(config)
    assert report.ok, report.to_dict()
    assert config["template"]["id"] == "phaser.battle-2d"
    assert config["victory"]["afterWave"] == len(config["waves"])


def test_battle_assembly_is_deterministic():
    assert assemble_battle_2d(make_battle_blueprint()) == \
        assemble_battle_2d(make_battle_blueprint())


def test_battle_assembly_rejects_wrong_genre_and_bad_blueprint():
    other = make_battle_blueprint()
    other["genre"] = "space-shooter"
    with pytest.raises(AssemblyError):
        assemble_battle_2d(other)
    bad = make_battle_blueprint()
    del bad["enemies"]
    with pytest.raises(AssemblyError):
        assemble_battle_2d(bad)


def test_assembled_farm_config_validates():
    config = assemble_farming(make_farm_blueprint())
    report = validate_farming_config(config)
    assert report.ok, report.to_dict()
    assert config["template"]["id"] == "phaser.farming"
    assert config["scoring"]["targetCoins"] == 500


def test_farm_assembly_is_deterministic():
    assert assemble_farming(make_farm_blueprint()) == \
        assemble_farming(make_farm_blueprint())


def test_farm_assembly_rejects_wrong_genre_and_bad_blueprint():
    other = make_farm_blueprint()
    other["genre"] = "side-scroller"
    with pytest.raises(AssemblyError):
        assemble_farming(other)
    bad = make_farm_blueprint()
    del bad["obstacles"]
    with pytest.raises(AssemblyError):
        assemble_farming(bad)
