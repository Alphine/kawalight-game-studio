"""Project service tests: CRUD + lifecycle (SDD §2.4, FR-001, FR-019)."""

import json

import pytest

from kgsm import db as dbmod
from kgsm import projects


def test_create_and_reopen(store):
    created = projects.create("Sky Guardians", "space-shooter")
    assert created.state == "draft"
    record = json.loads((created.dir / "project.json").read_text(encoding="utf-8"))
    assert record["name"] == "Sky Guardians"

    # Reopen from a fresh connection (FR-019).
    reopened = projects.get(created.id)
    assert reopened.name == "Sky Guardians"
    assert reopened.genre == "space-shooter"
    assert reopened.dir == created.dir


def test_create_rejects_bad_input(store):
    with pytest.raises(projects.ProjectError):
        projects.create("  ", "space-shooter")
    with pytest.raises(projects.ProjectError):
        projects.create("x" * 81, "space-shooter")
    with pytest.raises(projects.ProjectError):
        projects.create("Ok", "racing")


def test_rename_list_archive(store):
    a = projects.create("A", "space-shooter")
    b = projects.create("B", "farming")
    projects.rename(a.id, "A2")
    assert projects.get(a.id).name == "A2"
    assert {p.name for p in projects.list_projects()} == {"A2", "B"}
    projects.set_archived(b.id, True)
    assert [p.name for p in projects.list_projects()] == ["A2"]
    assert len(projects.list_projects(include_archived=True)) == 2


def test_forward_lifecycle(store):
    p = projects.create("Life", "space-shooter")
    for nxt in projects.STATES[1:]:
        p = projects.transition(p.id, nxt)
        assert p.state == nxt
        assert p.state_reason == ""


def test_forward_skips_rejected(store):
    p = projects.create("Skip", "space-shooter")
    with pytest.raises(projects.ProjectError):
        projects.transition(p.id, "playable")
    with pytest.raises(projects.ProjectError):
        projects.transition(p.id, "nope")


def test_backward_move_needs_reason_and_explains_stale(store):
    p = projects.create("Stale", "space-shooter")
    for nxt in ("blueprint_ready", "assets_pending", "assembling", "playable"):
        p = projects.transition(p.id, nxt)
    with pytest.raises(projects.ProjectError):
        projects.transition(p.id, "assets_pending")
    p = projects.mark_stale(p.id, "config edited after assembly")
    assert p.state == "assets_pending"
    assert p.state_reason == "config edited after assembly"
    with pytest.raises(projects.ProjectError):
        projects.mark_stale(p.id, "")


def test_duplicate_copies_files_with_new_identity(store):
    p = projects.create("Orig", "space-shooter")
    (p.dir / "blueprint.json").write_text("{}", encoding="utf-8")
    copy = projects.duplicate(p.id, "Copy")
    assert copy.id != p.id
    assert copy.name == "Copy"
    assert (copy.dir / "blueprint.json").exists()
    assert projects.get(p.id).name == "Orig"


def test_delete_removes_row_and_files(store):
    p = projects.create("Gone", "space-shooter")
    assert p.dir.is_dir()
    projects.delete(p.id)
    assert not p.dir.exists()
    with pytest.raises(projects.ProjectError):
        projects.get(p.id)
    # Deleting twice is an error, not silent success.
    with pytest.raises(projects.ProjectError):
        projects.delete(p.id)


def test_db_survives_reconnect(store):
    projects.create("Persist", "battle-2d")
    dbmod.connect().close()
    assert [p.name for p in projects.list_projects()] == ["Persist"]
