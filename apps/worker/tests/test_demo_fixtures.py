"""The repo's own demo fixtures must validate (all genres)."""

import json

from kgsm import paths as paths_mod
from kgsm.blueprint import (
    assemble_battle_2d,
    assemble_endless_runner,
    assemble_farming,
    assemble_side_scroller,
    assemble_space_shooter,
)
from kgsm.validation import (
    validate_battle_2d_config,
    validate_blueprint,
    validate_endless_runner_config,
    validate_farming_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)

GENRES = {
    "space-shooter": (assemble_space_shooter, validate_space_shooter_config,
                      "phaser.space-shooter"),
    "endless-runner": (assemble_endless_runner, validate_endless_runner_config,
                       "phaser.endless-runner"),
    "side-scroller": (assemble_side_scroller, validate_side_scroller_config,
                      "phaser.side-scroller"),
    "battle-2d": (assemble_battle_2d, validate_battle_2d_config,
                  "phaser.battle-2d"),
    "farming": (assemble_farming, validate_farming_config, "phaser.farming"),
}


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_demo_blueprints_assemble_and_validate():
    for genre, (assemble, validate, template_id) in GENRES.items():
        tdir = paths_mod.templates_dir() / "phaser" / genre
        blueprint = _read_json(tdir / "blueprint.demo.json")
        bp_report = validate_blueprint(blueprint)
        assert bp_report.ok, (genre, bp_report.to_dict())
        asm_report = validate(assemble(blueprint))
        assert asm_report.ok, (genre, asm_report.to_dict())


def test_demo_configs_and_template_ids_match():
    for genre, (_, validate, template_id) in GENRES.items():
        tdir = paths_mod.templates_dir() / "phaser" / genre
        config = _read_json(tdir / "config.demo.json")
        report = validate(config)
        assert report.ok, (genre, report.to_dict())
        meta = _read_json(tdir / "template.json")
        assert meta["id"] == template_id == config["template"]["id"]
        assert (paths_mod.schemas_dir() / meta["configSchema"]).exists()
