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
