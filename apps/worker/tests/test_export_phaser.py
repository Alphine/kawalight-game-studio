"""Phaser export tests (FR-014/FR-017/FR-018/FR-030, NFR-002/003)."""

import json
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from kgsm import secrets as secrets_mod
from kgsm.exporters import ExportError, package_all, stage_export
from test_config_validator import make_config


def make_fake_template(root: Path) -> tuple[Path, Path]:
    template_dir = root / "template"
    runtime_dir = root / "runtime"
    (template_dir / "demo").mkdir(parents=True)
    (template_dir / "src").mkdir(parents=True)
    (template_dir / "assets").mkdir(parents=True)
    runtime_dir.mkdir(parents=True)
    (template_dir / "template.json").write_text(json.dumps({
        "id": "phaser.space-shooter", "version": "1.0.0",
        "runtime": {"name": "phaser", "version": "3.80.1"},
    }), encoding="utf-8")
    (template_dir / "demo" / "index.html").write_text(
        "<html><body>game</body></html>", encoding="utf-8")
    (template_dir / "src" / "game.js").write_text("export {};", encoding="utf-8")
    (runtime_dir / "core.js").write_text("export {};", encoding="utf-8")
    Image.new("RGB", (8, 8), (1, 2, 3)).save(template_dir / "assets" / "player.png")
    return template_dir, runtime_dir


def test_stage_export_produces_manifest_and_files(store, tmp_path):
    template_dir, runtime_dir = make_fake_template(tmp_path)
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    staged = stage_export(
        project_name="Galaxy Strike", genre="space-shooter",
        config=make_config(), project_dir=project_dir,
        template_dir=template_dir, runtime_dir=runtime_dir,
        out_dir=tmp_path / "out")
    assert "index.html" in staged["files"]
    assert "config.json" in staged["files"]
    assert "kgsm-manifest.json" in staged["files"]
    manifest = staged["manifest"]
    assert manifest["projectName"] == "Galaxy Strike"
    assert manifest["configHash"].startswith("sha256:")
    assert manifest["assets"][0]["source"] == "starter"


def test_package_all_writes_both_zips(store, tmp_path):
    template_dir, runtime_dir = make_fake_template(tmp_path)
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    result = package_all(
        project_name="Galaxy Strike", genre="space-shooter",
        config=make_config(), project_dir=project_dir,
        builds_dir=tmp_path / "builds", template_dir=template_dir,
        runtime_dir=runtime_dir)
    for key in ("playable", "source"):
        with zipfile.ZipFile(result[key]) as zf:
            names = zf.namelist()
        assert "index.html" in names
        assert "kgsm-manifest.json" in names


def test_export_rejects_invalid_config(store, tmp_path):
    template_dir, runtime_dir = make_fake_template(tmp_path)
    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    with pytest.raises(ExportError, match="config invalid"):
        stage_export(
            project_name="X", genre="space-shooter", config=bad,
            project_dir=tmp_path, template_dir=template_dir,
            runtime_dir=runtime_dir, out_dir=tmp_path / "out")


def test_export_never_leaks_secrets(store, tmp_path):
    secrets_mod.set_secret("openai", "sk-test-1999")
    template_dir, runtime_dir = make_fake_template(tmp_path)
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    result = package_all(
        project_name="Galaxy Strike", genre="space-shooter",
        config=make_config(), project_dir=project_dir,
        builds_dir=tmp_path / "builds", template_dir=template_dir,
        runtime_dir=runtime_dir)
    for key in ("playable", "source"):
        blob = Path(result[key]).read_bytes()
        assert b"sk-test-1999" not in blob


def test_failed_export_preserves_last_good_build(store, tmp_path):
    template_dir, runtime_dir = make_fake_template(tmp_path)
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    builds = tmp_path / "builds"
    good = package_all(
        project_name="Galaxy Strike", genre="space-shooter",
        config=make_config(), project_dir=project_dir, builds_dir=builds,
        template_dir=template_dir, runtime_dir=runtime_dir)
    before = Path(good["playable"]).read_bytes()
    (template_dir / "demo" / "index.html").unlink()  # break the template
    with pytest.raises(ExportError):
        package_all(
            project_name="Galaxy Strike", genre="space-shooter",
            config=make_config(), project_dir=project_dir, builds_dir=builds,
            template_dir=template_dir, runtime_dir=runtime_dir)
    assert Path(good["playable"]).read_bytes() == before


def test_package_runner_with_real_template(store, tmp_path):
    from kgsm import paths as paths_mod
    from kgsm.blueprint import assemble_endless_runner
    from test_config_validator import make_runner_blueprint

    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    config = assemble_endless_runner(make_runner_blueprint())
    result = package_all(
        project_name="Skyline Sprint", genre="endless-runner",
        config=config, project_dir=project_dir,
        builds_dir=tmp_path / "builds",
        template_dir=paths_mod.templates_dir() / "phaser" / "endless-runner")
    for key in ("playable", "source"):
        with zipfile.ZipFile(result[key]) as zf:
            names = zf.namelist()
            manifest = json.loads(zf.read("kgsm-manifest.json"))
        assert "index.html" in names
        assert "config.json" in names
        assert manifest["template"]["id"] == "phaser.endless-runner"


def test_package_rejects_unknown_template_id(store, tmp_path):
    bad = make_config()
    bad["template"] = {"id": "phaser.racing", "version": "1.0.0"}
    with pytest.raises(ExportError, match="unknown template id"):
        package_all(
            project_name="X", genre="space-shooter", config=bad,
            project_dir=tmp_path, builds_dir=tmp_path / "builds")


def test_package_new_genres_with_real_template(store, tmp_path):
    from kgsm import paths as paths_mod
    from kgsm.blueprint import (
        assemble_battle_2d,
        assemble_farming,
        assemble_side_scroller,
    )
    from test_config_validator import (
        make_battle_blueprint,
        make_farm_blueprint,
        make_side_blueprint,
    )

    cases = [
        ("Cliff Hopper", "side-scroller", "phaser.side-scroller",
         make_side_blueprint, assemble_side_scroller),
        ("Arena Clash", "battle-2d", "phaser.battle-2d",
         make_battle_blueprint, assemble_battle_2d),
        ("Sunny Acres", "farming", "phaser.farming",
         make_farm_blueprint, assemble_farming),
    ]
    for name, genre, template_id, make_bp, assemble in cases:
        project_dir = tmp_path / f"proj-{genre}"
        project_dir.mkdir()
        config = assemble(make_bp())
        result = package_all(
            project_name=name, genre=genre, config=config,
            project_dir=project_dir,
            builds_dir=tmp_path / f"builds-{genre}",
            template_dir=paths_mod.templates_dir() / "phaser" / genre)
        for key in ("playable", "source"):
            with zipfile.ZipFile(result[key]) as zf:
                names = zf.namelist()
                manifest = json.loads(zf.read("kgsm-manifest.json"))
            assert "index.html" in names
            assert "config.json" in names
            assert manifest["template"]["id"] == template_id


def test_export_ships_demo_stylesheet(store, tmp_path):
    # The entry page links style.css; the export must carry it or the game is unstyled.
    from kgsm import projects
    from kgsm.playtest import stage_playtest, staged_dir
    from test_config_validator import make_config

    project = projects.create("Styled", "space-shooter")
    stage_playtest(project_name=project.name, genre=project.genre,
                   config=make_config(), project_dir=project.dir)
    staged = staged_dir(project.dir)
    assert (staged / "index.html").is_file()
    assert (staged / "style.css").is_file()
