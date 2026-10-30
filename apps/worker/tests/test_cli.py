"""Worker CLI tests."""

import json

from kgsm.__main__ import main
from test_config_validator import make_blueprint, make_config


def test_cli_validate_config_ok_and_bad(store, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(json.dumps(make_config()), encoding="utf-8")
    assert main(["validate", "config", str(good)]) == 0
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"nope": True}), encoding="utf-8")
    assert main(["validate", "config", str(bad)]) == 1


def test_cli_assemble_roundtrip(store, tmp_path):
    bp = tmp_path / "bp.json"
    bp.write_text(json.dumps(make_blueprint()), encoding="utf-8")
    out = tmp_path / "config.json"
    assert main(["assemble", str(bp), "-o", str(out)]) == 0
    assert main(["validate", "config", str(out)]) == 0


def test_cli_assembles_and_validates_runner(store, tmp_path):
    from test_config_validator import make_runner_blueprint

    bp = tmp_path / "rbp.json"
    bp.write_text(json.dumps(make_runner_blueprint()), encoding="utf-8")
    out = tmp_path / "rconfig.json"
    assert main(["assemble", str(bp), "-o", str(out)]) == 0
    assert main(["validate", "config", str(out)]) == 0


def test_cli_validates_runner_demo_config(store):
    from kgsm import paths as paths_mod

    demo = (paths_mod.templates_dir() / "phaser" / "endless-runner"
            / "config.demo.json")
    assert main(["validate", "config", str(demo)]) == 0


def test_cli_assembles_and_validates_new_genres(store, tmp_path):
    from test_config_validator import (
        make_battle_blueprint,
        make_farm_blueprint,
        make_side_blueprint,
    )

    for i, make in enumerate((make_side_blueprint, make_battle_blueprint,
                              make_farm_blueprint)):
        bp = tmp_path / f"bp{i}.json"
        bp.write_text(json.dumps(make()), encoding="utf-8")
        out = tmp_path / f"config{i}.json"
        assert main(["assemble", str(bp), "-o", str(out)]) == 0
        assert main(["validate", "config", str(out)]) == 0


def test_cli_validates_new_genre_demo_configs(store):
    from kgsm import paths as paths_mod

    for genre in ("side-scroller", "battle-2d", "farming"):
        demo = (paths_mod.templates_dir() / "phaser" / genre
                / "config.demo.json")
        assert main(["validate", "config", str(demo)]) == 0


def test_cli_assemble_rejects_unknown_genre(store, tmp_path, capsys):
    bp = tmp_path / "bp.json"
    data = {"genre": "racing"}
    bp.write_text(json.dumps(data), encoding="utf-8")
    out = tmp_path / "config.json"
    assert main(["assemble", str(bp), "-o", str(out)]) == 1
