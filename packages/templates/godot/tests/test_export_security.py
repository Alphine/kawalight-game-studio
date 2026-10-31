"""Traversal-guard + secret-scan regression tests (standalone exporter)."""

import json
from pathlib import Path

import pytest

import godot_exporter
from conftest import make_blueprint, make_config
from godot_exporter import GodotExportError, export_zip, package_all, stage_export


def _stage(config, tmp_path, **kwargs):
    kwargs.setdefault("asset_dirs", [])
    return stage_export(
        project_name="Test traversal",
        blueprint=make_blueprint("space-shooter"),
        config=config,
        out_dir=tmp_path / "out",
        **kwargs,
    )


@pytest.mark.parametrize("evil", [
    "../../evil.png",
    "assets/../../evil.png",
    "C:\\Windows\\evil.png",
    "..\\..\\evil.png",
    "",
])
def test_sprite_traversal_rejected(tmp_path, evil):
    config = make_config("space-shooter")
    config["assets"]["sprites"]["evil"] = evil
    with pytest.raises(GodotExportError, match="unsafe sprite path"):
        _stage(config, tmp_path)
    assert not (tmp_path / "evil.png").exists()
    assert not (tmp_path.parent / "evil.png").exists()


def test_absolute_sprite_path_rejected(tmp_path):
    config = make_config("space-shooter")
    config["assets"]["sprites"]["evil"] = str(tmp_path / "evil.png")
    with pytest.raises(GodotExportError, match="unsafe sprite path"):
        _stage(config, tmp_path)
    assert not (tmp_path / "evil.png").exists()


def test_nested_sprite_rel_still_stages(tmp_path):
    config = make_config("space-shooter")
    config["assets"]["sprites"]["deep"] = "assets/sub/deep.png"
    staged = _stage(config, tmp_path)
    assert (Path(staged["dir"]) / "assets" / "sub" / "deep.png").is_file()


def test_export_zip_secret_scan_blocks(tmp_path):
    staged = _stage(make_config("space-shooter"), tmp_path)
    out = Path(staged["dir"])
    (out / "notes.txt").write_text(
        "token: hunter2-secret-value", encoding="utf-8")
    with pytest.raises(GodotExportError, match="secret value detected"):
        export_zip(out, tmp_path / "game.zip", secrets=["hunter2-secret-value"])
    assert not (tmp_path / "game.zip").exists()


def test_export_zip_clean_with_unrelated_secrets(tmp_path):
    staged = _stage(make_config("space-shooter"), tmp_path)
    out = Path(staged["dir"])
    result = export_zip(out, tmp_path / "game.zip", secrets=["no-such-value"])
    assert result.is_file()


def test_export_zip_unscanned_without_secrets(tmp_path):
    staged = _stage(make_config("space-shooter"), tmp_path)
    out = Path(staged["dir"])
    (out / "notes.txt").write_text(
        "token: hunter2-secret-value", encoding="utf-8")
    result = export_zip(out, tmp_path / "game.zip")
    assert result.is_file()


def test_package_all_forwards_secrets(tmp_path):
    project_dir = tmp_path / "proj"
    (project_dir / "assets").mkdir(parents=True)
    (project_dir / "assets" / "notes.txt").write_text(
        "token: hunter2-secret-value", encoding="utf-8")
    with pytest.raises(GodotExportError, match="secret value detected"):
        package_all(
            project_name="Test secrets", blueprint=make_blueprint("space-shooter"),
            config=make_config("space-shooter"), project_dir=project_dir,
            asset_dirs=[], builds_dir=tmp_path / "builds",
            secrets=["hunter2-secret-value"])


def test_cli_secrets_file_blocks(tmp_path):
    blueprint_path = tmp_path / "blueprint.json"
    config_path = tmp_path / "config.json"
    secrets_path = tmp_path / "secrets.json"
    blueprint_path.write_text(
        json.dumps(make_blueprint("space-shooter")), encoding="utf-8")
    config = make_config("space-shooter")
    config_path.write_text(json.dumps(config), encoding="utf-8")
    secrets_path.write_text(
        json.dumps(["space-shooter"]), encoding="utf-8")
    # "space-shooter" appears in the staged config.json/template id, so the
    # scan must fail the CLI run.
    assert godot_exporter.main([
        str(blueprint_path), str(config_path), str(tmp_path / "cli-out"),
        "--secrets-file", str(secrets_path)]) == 1
