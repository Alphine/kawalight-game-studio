"""Godot 4 exporter tests (SDD FR-021): all five genres, green."""

import ast
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

import godot_exporter
from conftest import GENRES, make_blueprint, make_config
from godot_exporter import GodotExportError, package_all, stage_export

GODOT_DIR = Path(godot_exporter.__file__).resolve().parent

MECHANICS = {
    "space-shooter": ["wave", "sine", "dive", "invuln", "pool",
                      "afterWave", "power_up"],
    "endless-runner": ["jump", "slide", "current_speed", "_current_gap",
                       "meters", "milestone"],
    "side-scroller": ["coyote", "jump_buffer", "stomp", "checkpoint",
                      "kill_plane", "one_way", "par_time", "deadzone"],
    "battle-2d": ["melee", "aim_range", "chaser", "weaver", "shooter",
                  "ttl", "preferred_range"],
    "farming": ["stages", "water", "harvest", "day_length",
                "target_coins", "plot"],
}

CORE_FILES = (
    "project.godot",
    "icon.svg",
    "config.json",
    "kgsm-manifest.json",
    "README.md",
    "scenes/main.tscn",
    "scenes/hud.tscn",
    "scripts/game_config.gd",
    "scripts/hud.gd",
    "scripts/main.gd",
    "scripts/player.gd",
)

# Farming has no player avatar; its core scripts differ.
CORE_FILES_FARMING = tuple(
    f for f in CORE_FILES if f != "scripts/player.gd"
) + ("scripts/farm_grid.gd", "scripts/plot.gd", "scenes/farm_grid.tscn")


def _stage(genre, tmp_path, **kwargs):
    kwargs.setdefault("asset_dirs", [])
    return stage_export(
        project_name=f"Test {genre}",
        blueprint=kwargs.pop("blueprint", make_blueprint(genre)),
        config=kwargs.pop("config", make_config(genre)),
        out_dir=tmp_path / "out",
        **kwargs,
    )


def test_stage_produces_core_files(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    expected = CORE_FILES_FARMING if genre == "farming" else CORE_FILES
    for rel in expected:
        assert rel in staged["files"], f"missing {rel} for {genre}"
    out = Path(staged["dir"])
    project_godot = (out / "project.godot").read_text(encoding="utf-8")
    assert 'run/main_scene="res://scenes/main.tscn"' in project_godot
    assert f'config/name="Test {genre}"' in project_godot
    assert "window/size/viewport_width=960" in project_godot
    assert "window/size/viewport_height=540" in project_godot
    assert 'GameConfig="*res://scripts/game_config.gd"' in project_godot
    assert "renderer/rendering_method" in project_godot


def test_manifest_shape_and_config_hash(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    manifest = staged["manifest"]
    assert manifest["manifestVersion"] == "1.0.0"
    assert manifest["projectName"] == f"Test {genre}"
    assert manifest["genre"] == genre
    assert manifest["template"]["id"] == f"godot.{genre}"
    assert manifest["runtime"]["name"] == "godot"
    assert manifest["runtime"]["version"] == godot_exporter.GODOT_VERSION
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["configHash"])
    out = Path(staged["dir"])
    config = json.loads((out / "config.json").read_text(encoding="utf-8"))
    blob = json.dumps(config, sort_keys=True, separators=(",", ":"))
    assert manifest["configHash"] == "sha256:" + hashlib.sha256(
        blob.encode()).hexdigest()
    for entry in manifest["assets"]:
        assert re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
        assert entry["source"] in ("starter", "generated", "imported")
        assert (out / entry["path"]).is_file()


def test_scripts_map_genre_mechanics(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    out = Path(staged["dir"])
    joined = "\n".join(
        (out / rel).read_text(encoding="utf-8")
        for rel in staged["files"] if rel.endswith(".gd")
    )
    for keyword in MECHANICS[genre]:
        assert keyword in joined, f"{genre} scripts lack {keyword!r}"


def test_no_python_isms_in_gdscript(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    out = Path(staged["dir"])
    # Note: `self` is valid GDScript, so it is deliberately not listed.
    forbidden = [r"\bdef ", r"\bimport ", r"\bNone\b", r"\bTrue\b",
                  r"\bFalse\b", r"print\("]
    for rel in staged["files"]:
        if not rel.endswith(".gd"):
            continue
        text = (out / rel).read_text(encoding="utf-8")
        assert text.endswith("\n"), rel
        for pattern in forbidden:
            assert not re.search(pattern, text), f"{rel}: {pattern}"
        for lineno, line in enumerate(text.splitlines(), 1):
            stripped = line.lstrip(" \t")
            indent = line[:len(line) - len(stripped)]
            assert " " not in indent or "\t" not in indent, \
                f"{rel}:{lineno} mixes tabs and spaces"


def test_tscn_load_steps_and_refs_resolve(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    out = Path(staged["dir"])
    staged_set = set(staged["files"])
    tscns = [rel for rel in staged["files"] if rel.endswith(".tscn")]
    assert len(tscns) >= 2
    for rel in tscns:
        text = (out / rel).read_text(encoding="utf-8")
        ext = re.findall(r"\[ext_resource[^\]]*\]", text)
        sub = re.findall(r"\[sub_resource[^\]]*\]", text)
        match = re.search(r"load_steps=(\d+)", text)
        assert match, rel
        assert int(match.group(1)) == len(ext) + len(sub) + 1, rel
        for path in re.findall(r'path="res://([^"]+)"', text):
            assert path in staged_set, f"{rel} references missing {path}"


def test_preloads_resolve(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    staged_set = set(staged["files"])
    out = Path(staged["dir"])
    seen = 0
    for rel in staged["files"]:
        if not rel.endswith(".gd"):
            continue
        for path in re.findall(r'preload\("res://([^"]+)"\)',
                               (out / rel).read_text(encoding="utf-8")):
            assert path in staged_set, f"{rel} preloads missing {path}"
            seen += 1
    assert seen > 0 or genre == "farming"


def test_input_actions_mapped(genre, tmp_path):
    staged = _stage(genre, tmp_path)
    text = (Path(staged["dir"]) / "project.godot").read_text(encoding="utf-8")
    assert "physical_keycode" in text
    if genre == "farming":
        assert "tool_plant={" in text
        assert '"physical_keycode":49' in text  # ONE -> KEY_1
    else:
        assert '"physical_keycode":32' in text  # SPACE
    if genre == "side-scroller":
        assert '"physical_keycode":4194319' in text  # LEFT


def test_unknown_key_warns_and_skips(tmp_path):
    config = make_config("space-shooter")
    config["controls"]["fire"] = "NOT-A-KEY!!!"
    staged = _stage("space-shooter", tmp_path, config=config)
    assert any("unknown key" in w for w in staged["warnings"])
    text = (Path(staged["dir"]) / "project.godot").read_text(encoding="utf-8")
    assert "fire={" not in text
    assert "pause={" in text


def test_unmapped_control_warns(tmp_path):
    config = make_config("space-shooter")
    config["controls"]["warp"] = "W"
    staged = _stage("space-shooter", tmp_path, config=config)
    assert any("warp" in w for w in staged["warnings"])


def test_demo_configs_stage_all_genres(tmp_path):
    """Ground against the real Phaser demo configs (id re-stamped)."""
    phaser = GODOT_DIR.parent / "phaser"
    for genre in GENRES:
        demo_config = json.loads(
            (phaser / genre / "config.demo.json").read_text(encoding="utf-8"))
        demo_blueprint = json.loads(
            (phaser / genre / "blueprint.demo.json").read_text(
                encoding="utf-8"))
        demo_config["template"]["id"] = f"godot.{genre}"
        demo_blueprint["targetRuntime"] = "godot4"
        staged = stage_export(
            project_name=demo_blueprint["projectName"],
            blueprint=demo_blueprint, config=demo_config,
            out_dir=tmp_path / genre)
        assert "project.godot" in staged["files"]
        assert staged["manifest"]["genre"] == genre
        assert not any("placeholder" in w for w in staged["warnings"]), \
            f"{genre}: {staged['warnings']}"


def test_placeholders_when_no_assets(tmp_path):
    staged = _stage("space-shooter", tmp_path, asset_dirs=[])
    assert any("placeholder" in w for w in staged["warnings"])
    out = Path(staged["dir"])
    png = (out / "assets" / "player.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_project_assets_override_with_provenance(tmp_path):
    project_dir = tmp_path / "proj"
    (project_dir / "assets").mkdir(parents=True)
    custom = project_dir / "assets" / "player.png"
    custom.write_bytes(b"fake-png-bytes")
    (project_dir / "assets" / "player.png.meta.json").write_text(
        json.dumps({"role": "player-hero", "source": "generated",
                    "provider": "openai", "model": "m",
                    "prompt": "p", "seed": 1}),
        encoding="utf-8")
    staged = _stage("space-shooter", tmp_path, project_dir=project_dir)
    out = Path(staged["dir"])
    assert (out / "assets" / "player.png").read_bytes() == b"fake-png-bytes"
    assert "assets/player.png.meta.json" not in staged["files"]
    entry = next(e for e in staged["manifest"]["assets"]
                 if e["path"] == "assets/player.png")
    assert entry["source"] == "generated"
    assert entry["provider"] == "openai"
    assert entry["role"] == "player-hero"


def test_stage_is_deterministic(genre, tmp_path):
    first = _stage(genre, tmp_path / "a")
    second = _stage(genre, tmp_path / "b")
    assert first["files"] == second["files"]
    assert (first["manifest"]["configHash"]
            == second["manifest"]["configHash"])
    for rel in first["files"]:
        if rel == "kgsm-manifest.json":
            continue  # exportedAt timestamp differs by design
        a = (Path(first["dir"]) / rel).read_bytes()
        b = (Path(second["dir"]) / rel).read_bytes()
        assert a == b, rel


def test_package_all_writes_project_zip(genre, tmp_path):
    result = package_all(
        project_name=f"Test {genre}", blueprint=make_blueprint(genre),
        config=make_config(genre), asset_dirs=[],
        builds_dir=tmp_path / "builds")
    assert result["project"].endswith("-godot.zip")
    with zipfile.ZipFile(result["project"]) as zf:
        names = zf.namelist()
    for rel in ("project.godot", "config.json", "kgsm-manifest.json",
                "scenes/main.tscn", "scripts/main.gd"):
        assert rel in names


def test_rejects_unknown_genre(tmp_path):
    with pytest.raises(GodotExportError, match="unsupported genre"):
        _stage("space-shooter", tmp_path,
               blueprint=make_blueprint("rts"))


def test_rejects_template_mismatch(tmp_path):
    config = make_config("space-shooter")
    config["template"]["id"] = "phaser.space-shooter"
    with pytest.raises(GodotExportError, match="does not match"):
        _stage("space-shooter", tmp_path, config=config)


def test_rejects_missing_section(tmp_path):
    config = make_config("space-shooter")
    del config["weapon"]
    with pytest.raises(GodotExportError, match="weapon"):
        _stage("space-shooter", tmp_path, config=config)


def test_rejects_empty_enemies(tmp_path):
    config = make_config("space-shooter")
    config["enemies"] = []
    with pytest.raises(GodotExportError, match="config invalid"):
        _stage("space-shooter", tmp_path, config=config)


def test_rejects_wave_overflow(tmp_path):
    config = make_config("space-shooter")
    config["victory"] = {"afterWave": 99}
    with pytest.raises(GodotExportError, match="afterWave"):
        _stage("space-shooter", tmp_path, config=config)


def test_rejects_bad_schema_version(tmp_path):
    blueprint = make_blueprint("farming")
    blueprint["schemaVersion"] = "9.9.9"
    with pytest.raises(GodotExportError, match="schemaVersion"):
        _stage("farming", tmp_path, blueprint=blueprint)


def test_rejects_farming_without_plotspec(tmp_path):
    config = make_config("farming")
    del config["farm"]["cols"]
    with pytest.raises(GodotExportError, match="cols"):
        _stage("farming", tmp_path, config=config)


def test_module_is_stdlib_only():
    allowed = set(sys.stdlib_module_names) | {"godot_genres"}
    roots = [GODOT_DIR / "godot_exporter.py",
             *sorted((GODOT_DIR / "godot_genres").glob("*.py"))]
    assert len(roots) >= 7
    for path in roots:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    top = alias.name.split(".")[0]
                    assert top in allowed, f"{path.name}: {alias.name}"
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0 and node.module:
                    top = node.module.split(".")[0]
                    assert top in allowed, f"{path.name}: {node.module}"


def test_imports_without_worker_deps():
    # Subprocess: sys.modules here may already hold worker deps when suites
    # run combined, so prove standalone importability in a clean interpreter.
    script = (
        "import sys\n"
        f"sys.path.insert(0, r'''{GODOT_DIR}''')\n"
        "import godot_exporter\n"
        "for m in ('kgsm', 'PIL', 'pydantic', 'jsonschema'):\n"
        "    assert m not in sys.modules, m\n"
        "assert godot_exporter.SUPPORTED_GENRES\n"
        "print('IMPORT-OK')\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert "IMPORT-OK" in proc.stdout


def test_cli_stages_project(tmp_path):
    blueprint_path = tmp_path / "blueprint.json"
    config_path = tmp_path / "config.json"
    blueprint_path.write_text(
        json.dumps(make_blueprint("farming")), encoding="utf-8")
    config_path.write_text(
        json.dumps(make_config("farming")), encoding="utf-8")
    out_dir = tmp_path / "cli-out"
    assert godot_exporter.main(
        [str(blueprint_path), str(config_path), str(out_dir)]) == 0
    assert (out_dir / "project.godot").is_file()
    assert (out_dir / "kgsm-manifest.json").is_file()
