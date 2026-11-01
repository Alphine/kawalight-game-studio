"""One-click AUTO pipeline tests (NEW).

Exercises POST /projects/auto through ``server.dispatch`` (no sockets),
mirroring test_api_genres.py, so this file stays green where socket binds
are blocked.
"""

import json
import zipfile
from pathlib import Path

import pytest

from kgsm import auto as auto_mod
from kgsm import projects as projects_mod
from kgsm.api import Request
from kgsm.api.server import dispatch


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


GENRES = ["space-shooter", "endless-runner", "side-scroller", "battle-2d",
          "farming"]


@pytest.mark.parametrize("genre", GENRES)
def test_auto_happy_path_all_genres(store, genre):
    status, body = call("POST", "/projects/auto",
                        {"name": f"Auto {genre}", "genre": genre})
    assert status == 201, body
    assert set(body) == {"project", "blueprint", "config", "validation",
                         "playable"}
    assert body["project"]["name"] == f"Auto {genre}"
    assert body["project"]["genre"] == genre
    assert body["blueprint"]["genre"] == genre
    assert body["blueprint"]["projectName"] == f"Auto {genre}"
    assert body["config"]["template"]["id"] == f"phaser.{genre}"
    assert body["validation"]["ok"] is True
    assert body["playable"].endswith("-playable.zip")

    project_dir = Path(store["projects_dir"]) / body["project"]["id"]
    assert (project_dir / "blueprint.json").is_file()
    assert (project_dir / "config.json").is_file()
    playable_zip = project_dir / body["playable"]
    assert playable_zip.is_file()
    with zipfile.ZipFile(playable_zip) as zf:
        names = zf.namelist()
        manifest = json.loads(zf.read("kgsm-manifest.json"))
    assert "index.html" in names
    assert "config.json" in names
    assert manifest["template"]["id"] == f"phaser.{genre}"


@pytest.mark.parametrize("payload,code", [
    ({"name": "Ok", "genre": "racing"}, "unknown-genre"),
    ({"name": "Ok"}, "bad-request"),
    ({"name": "Ok", "genre": 7}, "bad-request"),
    ({"name": "  ", "genre": "space-shooter"}, "invalid-name"),
    ({"genre": "space-shooter"}, "bad-request"),
    ({"name": "Ok", "genre": "space-shooter", "prompt": 7}, "bad-request"),
    ({"name": "Ok", "genre": "space-shooter", "themeId": 7}, "bad-request"),
    ({"name": "Ok", "genre": "space-shooter",
      "themeId": "nope"}, "unknown-theme"),
    ({"name": "Ok", "genre": "space-shooter",
      "themeId": "sunny-acres"}, "unknown-theme"),
])
def test_auto_invalid_input_is_4xx(store, payload, code):
    status, body = call("POST", "/projects/auto", payload)
    assert 400 <= status < 500, body
    assert body["error"]["code"] == code, body
    assert projects_mod.list_projects() == []


def test_auto_validation_failure_is_422_with_report(store, monkeypatch):
    real_build = auto_mod.build_blueprint

    def fake_build(name, genre, prompt=None, theme_id=None):
        bad = real_build(name, genre, prompt, theme_id)
        del bad["theme"]  # schema-required -> validate_blueprint fails
        return bad

    monkeypatch.setattr(auto_mod, "build_blueprint", fake_build)
    status, body = call("POST", "/projects/auto",
                        {"name": "Doomed", "genre": "space-shooter"})
    assert status == 422, body
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False


def test_auto_config_failure_is_422_without_half_project(store, monkeypatch):
    def fake_assemble(blueprint):
        return {"template": {"id": "phaser.space-shooter",
                             "version": "1.0.0"}}

    monkeypatch.setattr(auto_mod, "assemble_space_shooter", fake_assemble)
    status, body = call("POST", "/projects/auto",
                        {"name": "Doomed", "genre": "space-shooter"})
    assert status == 422, body
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False
    assert projects_mod.list_projects() == []
    assert list(Path(store["projects_dir"]).iterdir()) == []


def test_auto_prompt_recorded_and_keyword_matched(store):
    status, body = call(
        "POST", "/projects/auto",
        {"name": "Neon Raid", "genre": "space-shooter",
         "prompt": "neon robots over the city"})
    assert status == 201, body
    assert body["blueprint"]["notes"] == "neon robots over the city"
    assert body["blueprint"]["theme"] == "Neon Swarm"


def test_auto_build_is_deterministic():
    first = auto_mod.build_blueprint("Same", "farming",
                                     prompt="moon tides at night")
    second = auto_mod.build_blueprint("Same", "farming",
                                      prompt="moon tides at night")
    assert first == second
    assert first["theme"] == "Moonlit Grove"


def test_auto_explicit_theme_id_beats_prompt(store):
    status, body = call(
        "POST", "/projects/auto",
        {"name": "Pirates", "genre": "space-shooter",
         "prompt": "neon lights everywhere", "themeId": "pirate-belt"})
    assert status == 201, body
    assert body["blueprint"]["theme"] == "Pirate Belt"


def test_auto_default_theme_without_prompt(store):
    status, body = call("POST", "/projects/auto",
                        {"name": "Plain", "genre": "battle-2d"})
    assert status == 201, body
    assert body["blueprint"]["theme"] == "Monster Arena"
    assert body["blueprint"]["notes"] == ""


def test_auto_export_failure_leaves_nothing_behind(store, monkeypatch):
    from kgsm.exporters import ExportError

    def boom(**kwargs):
        raise ExportError("disk on fire")

    monkeypatch.setattr(auto_mod, "package_all", boom)
    status, body = call("POST", "/projects/auto",
                        {"name": "Doomed", "genre": "farming"})
    assert status == 502, body
    assert body["error"]["code"] == "export-error"
    assert projects_mod.list_projects() == []
    assert list(Path(store["projects_dir"]).iterdir()) == []


def test_auto_same_name_twice_makes_two_projects(store):
    first = call("POST", "/projects/auto",
                 {"name": "Clone", "genre": "farming"})
    second = call("POST", "/projects/auto",
                  {"name": "Clone", "genre": "farming"})
    assert first[0] == 201 and second[0] == 201
    assert first[1]["project"]["id"] != second[1]["project"]["id"]
    assert len(projects_mod.list_projects()) == 2


def test_auto_assembly_failure_is_422_without_report(store, monkeypatch):
    from kgsm.blueprint import AssemblyError

    def boom(blueprint):
        raise AssemblyError("assembler says no")

    monkeypatch.setattr(auto_mod, "assemble_space_shooter", boom)
    status, body = call("POST", "/projects/auto",
                        {"name": "Doomed", "genre": "space-shooter"})
    assert status == 422, body
    assert body["error"]["code"] == "assembly-failed"
    assert "report" not in body  # matches assemble_blueprint: bare 422
    assert projects_mod.list_projects() == []
    assert list(Path(store["projects_dir"]).iterdir()) == []


def test_auto_long_prompt_truncated_to_notes_limit(store):
    prompt = "x" * (auto_mod.NOTES_MAX_CHARS + 1000)
    status, body = call(
        "POST", "/projects/auto",
        {"name": "Long Prompt", "genre": "farming", "prompt": prompt})
    assert status == 201, body
    assert body["blueprint"]["notes"] == prompt[:auto_mod.NOTES_MAX_CHARS]
    assert len(body["blueprint"]["notes"]) == auto_mod.NOTES_MAX_CHARS


def test_auto_name_length_boundary(store, monkeypatch):
    # 81 chars is rejected at the route (no project created).
    status, body = call("POST", "/projects/auto",
                        {"name": "n" * 81, "genre": "farming"})
    assert status == 400, body
    assert body["error"]["code"] == "invalid-name"
    assert projects_mod.list_projects() == []
    # 80 chars passes validation: stub the pipeline past the name check
    # (a full 80-char packaging run exceeds Windows MAX_PATH under the
    # deep pytest tmp dir; real projects dirs are shallow).
    seen = {}

    def fake_run(name, genre, prompt=None, theme_id=None):
        seen.update(name=name, genre=genre)
        return {"project": {"id": "p1"}, "blueprint": {}, "config": {},
                "report": {"ok": True}, "playable": "builds/x-playable.zip"}

    monkeypatch.setattr(auto_mod, "run_auto", fake_run)
    status, body = call("POST", "/projects/auto",
                        {"name": "n" * 80, "genre": "farming"})
    assert status == 201, body
    assert seen == {"name": "n" * 80, "genre": "farming"}


def test_auto_packages_source_zip_sibling(store):
    status, body = call("POST", "/projects/auto",
                        {"name": "Sibling Check", "genre": "space-shooter"})
    assert status == 201, body
    project_dir = Path(store["projects_dir"]) / body["project"]["id"]
    playable = project_dir / body["playable"]
    assert playable.is_file()
    source = playable.parent / playable.name.replace("-playable.zip",
                                                     "-source.zip")
    assert source.is_file()
    with zipfile.ZipFile(source) as zf:
        assert "blueprint.json" in zf.namelist()


def test_auto_keyword_priority_beats_default(store):
    # Docs example: "neon alien raid" picks neon-swarm even though the
    # alien-invasion default's keywords also match.
    status, body = call(
        "POST", "/projects/auto",
        {"name": "Priority", "genre": "space-shooter",
         "prompt": "neon alien raid"})
    assert status == 201, body
    assert body["blueprint"]["theme"] == "Neon Swarm"


def test_auto_theme_id_whitespace_trimmed(store):
    status, body = call(
        "POST", "/projects/auto",
        {"name": "Trim", "genre": "space-shooter",
         "themeId": "  pirate-belt  "})
    assert status == 201, body
    assert body["blueprint"]["theme"] == "Pirate Belt"


def test_auto_unexpected_project_error_is_500(store, monkeypatch):
    def boom(name, genre):
        raise projects_mod.ProjectError(
            "could not mint a unique project id; retry")

    monkeypatch.setattr(projects_mod, "create", boom)
    status, body = call("POST", "/projects/auto",
                        {"name": "Doomed", "genre": "space-shooter"})
    assert status == 500, body
    assert body["error"]["code"] == "internal"
