"""New-genre API tests (contract Revision 1.2).

Exercises the real route handlers through ``server.dispatch`` (no sockets),
mirroring test_api_ops.py, so this file stays green where socket binds are
blocked. Socket-level end-to-end coverage lives in test_api.py.
"""

import pytest

from kgsm import projects as projects_mod
from kgsm.api import Request
from kgsm.api.server import dispatch
from test_config_validator import (
    make_battle_blueprint,
    make_battle_config,
    make_blueprint,
    make_farm_blueprint,
    make_farm_config,
    make_side_blueprint,
    make_side_config,
)


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


CASES = [
    ("side-scroller", "phaser.side-scroller",
     make_side_blueprint, make_side_config),
    ("battle-2d", "phaser.battle-2d",
     make_battle_blueprint, make_battle_config),
    ("farming", "phaser.farming",
     make_farm_blueprint, make_farm_config),
]


@pytest.mark.parametrize("genre,template_id,make_bp,make_cfg", CASES)
def test_genre_assemble_validate_store_export(
        store, genre, template_id, make_bp, make_cfg):
    pid = projects_mod.create(f"Demo {genre}", genre).id

    status, body = call("POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": make_bp()})
    assert status == 200, body
    assert body["report"]["ok"] is True
    assert body["config"]["template"]["id"] == template_id
    assert body["storedConfig"] is True

    status, body = call("POST", "/configs/validate",
                        {"genre": genre, "config": make_cfg()})
    assert status == 200, body
    assert body["report"]["ok"] is True

    status, body = call("PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": make_bp()})
    assert status == 200, body
    status, body = call("GET", f"/projects/{pid}/blueprint")
    assert status == 200
    assert body["blueprint"]["genre"] == genre

    status, body = call("PUT", f"/projects/{pid}/config",
                        {"config": make_cfg()})
    assert status == 200, body
    assert body["stored"] is True
    status, body = call("GET", f"/projects/{pid}/config")
    assert status == 200
    assert body["config"]["template"]["id"] == template_id

    status, body = call("POST", f"/projects/{pid}/exports", {})
    assert status == 201, body
    assert body["manifest"]["template"]["id"] == template_id
    status, body = call("GET", f"/projects/{pid}/exports")
    assert status == 200
    assert len(body["exports"]) == 2


@pytest.mark.parametrize("genre,template_id,make_bp,make_cfg", CASES)
def test_genre_config_put_rejects_invalid(
        store, genre, template_id, make_bp, make_cfg):
    pid = projects_mod.create(f"Demo {genre}", genre).id
    bad = make_cfg()
    bad["template"] = {"id": template_id, "version": "1.0.0"}
    bad.pop("world")
    status, body = call("PUT", f"/projects/{pid}/config", {"config": bad})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


def test_configs_validate_unknown_genre_is_501(store):
    status, body = call("POST", "/configs/validate",
                        {"genre": "racing", "config": {}})
    assert status == 501
    assert body["error"]["code"] == "unknown-genre"


def test_assemble_genre_mismatch_is_422(store):
    pid = projects_mod.create("Farm", "farming").id
    status, body = call("POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": make_blueprint()})
    assert status == 422
    assert body["error"]["code"] == "assembly-failed"


def test_export_unknown_template_id_is_422(store):
    pid = projects_mod.create("Demo", "space-shooter").id
    status, body = call("POST", f"/projects/{pid}/exports",
                        {"config": {"template": {"id": "phaser.racing",
                                                "version": "1.0.0"}}})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


@pytest.mark.parametrize("genre,template_id,make_bp,make_cfg", CASES)
def test_genre_export_godot(store, genre, template_id, make_bp, make_cfg):
    pid = projects_mod.create(f"Demo {genre}", genre).id
    status, body = call("PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": make_bp()})
    assert status == 200, body
    status, body = call("PUT", f"/projects/{pid}/config",
                        {"config": make_cfg()})
    assert status == 200, body

    status, body = call("POST", f"/projects/{pid}/exports/godot", {})
    assert status == 201, body
    assert body["godot"].endswith("-godot4.zip")
    assert isinstance(body["warnings"], list)
    assert body["manifest"]["projectName"] == f"Demo {genre}"
    assert body["manifest"]["template"]["id"] == f"godot.{genre}"


def test_export_godot_synth_blueprint(store):
    pid = projects_mod.create("No Blueprint", "farming").id
    status, body = call("PUT", f"/projects/{pid}/config",
                        {"config": make_farm_config()})
    assert status == 200, body

    status, body = call("POST", f"/projects/{pid}/exports/godot", {})
    assert status == 201, body
    assert body["godot"] == "builds/no-blueprint-godot4.zip"
    assert body["manifest"]["projectName"] == "No Blueprint"


def test_export_godot_genre_mismatch_is_422(store):
    pid = projects_mod.create("Demo", "space-shooter").id
    status, body = call("POST", f"/projects/{pid}/exports/godot",
                        {"config": make_farm_config()})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


def test_export_godot_unknown_template_is_422(store):
    pid = projects_mod.create("Demo", "space-shooter").id
    status, body = call("POST", f"/projects/{pid}/exports/godot",
                        {"config": {"template": {"id": "phaser.racing",
                                                "version": "1.0.0"}}})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"
