"""Backup/restore tests (FR-027; contract §8)."""

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from kgsm import backup, db as dbmod
from kgsm import projects


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_create_backup_snapshots_dir_with_sidecar(store):
    project = projects.create("Sky Guardians", "space-shooter")
    (project.dir / "blueprint.json").write_text('{"a": 1}', encoding="utf-8")
    (project.dir / "assets").mkdir()
    (project.dir / "assets" / "ship.png").write_bytes(b"\x89PNG-fake")

    record = backup.create_backup(project.id)

    assert set(record) == {"backupId", "projectId", "file", "sha256",
                           "bytes", "createdAt"}
    assert record["projectId"] == project.id
    assert record["backupId"].startswith(f"{project.id}-")
    zipped = Path(record["file"])
    assert zipped.is_absolute() and zipped.is_file()
    assert zipped.parent == store["data_dir"] / "backups"
    assert record["sha256"] == _sha256(zipped)
    assert record["bytes"] == zipped.stat().st_size
    sidecar = zipped.with_suffix(zipped.suffix + ".sha256")
    assert sidecar.read_text(encoding="utf-8") == record["sha256"]
    with zipfile.ZipFile(zipped) as zf:
        names = set(zf.namelist())
    assert {"project.json", "blueprint.json",
            "assets/ship.png"} <= names
    with zipfile.ZipFile(zipped) as zf:
        stored = json.loads(zf.read("project.json").decode("utf-8"))
    assert stored["id"] == project.id and stored["name"] == "Sky Guardians"


def test_create_backup_twice_in_same_second_gets_unique_names(store):
    project = projects.create("Dup", "space-shooter")
    first = backup.create_backup(project.id)
    second = backup.create_backup(project.id)
    assert first["backupId"] != second["backupId"]
    assert len(backup.list_backups()) == 2


def test_create_backup_unknown_project(store):
    with pytest.raises(projects.ProjectError):
        backup.create_backup("does-not-exist")


def test_list_backups_parses_filenames_and_sidecars(store):
    project = projects.create("Listed", "farming")
    made = backup.create_backup(project.id)
    (records,) = [r for r in backup.list_backups()
                  if r["backupId"] == made["backupId"]]
    assert records["projectId"] == project.id
    assert records["file"] == made["file"]
    assert records["sha256"] == made["sha256"]
    assert records["bytes"] == made["bytes"]
    assert records["createdAt"]
    # Missing sidecar falls back to a fresh digest, not a crash.
    Path(made["file"]).with_suffix(".zip.sha256").unlink()
    (again,) = [r for r in backup.list_backups()
                if r["backupId"] == made["backupId"]]
    assert again["sha256"] == made["sha256"]


def test_delete_backup_removes_zip_and_sidecar(store):
    project = projects.create("Temp", "space-shooter")
    made = backup.create_backup(project.id)
    assert backup.delete_backup(made["backupId"]) is True
    assert not Path(made["file"]).exists()
    assert not Path(str(made["file"]) + ".sha256").exists()
    assert backup.delete_backup(made["backupId"]) is False
    assert backup.list_backups() == []


def test_delete_backup_rejects_path_traversal(store):
    with pytest.raises(backup.BackupError):
        backup.delete_backup("../kgsm")
    with pytest.raises(backup.BackupError):
        backup.delete_backup("a/b")


def test_restore_recreates_deleted_project_with_same_id(store):
    project = projects.create("Phoenix", "space-shooter")
    (project.dir / "blueprint.json").write_text('{"a": 1}', encoding="utf-8")
    made = backup.create_backup(project.id)
    projects.delete(project.id)
    assert not project.dir.exists()

    result = backup.restore_backup(made["backupId"])

    assert result["reassignedId"] is False
    revived = result["project"]
    assert revived.id == project.id
    assert revived.name == "Phoenix" and revived.genre == "space-shooter"
    assert (revived.dir / "blueprint.json").read_text(
        encoding="utf-8") == '{"a": 1}'
    assert projects.get(project.id).name == "Phoenix"  # DB row is back


def test_restore_collision_assigns_new_id(store):
    project = projects.create("Original", "space-shooter")
    made = backup.create_backup(project.id)

    result = backup.restore_backup(made["backupId"])  # original still there

    assert result["reassignedId"] is True
    clone = result["project"]
    assert clone.id != project.id
    assert clone.name == "Original"
    assert clone.dir.is_dir()
    assert (clone.dir / "project.json").exists()
    stored = json.loads((clone.dir / "project.json").read_text(
        encoding="utf-8"))
    assert stored["id"] == clone.id
    # Both rows coexist.
    assert {p.id for p in projects.list_projects()} == {project.id, clone.id}


def test_restore_collision_when_only_dir_exists(store):
    project = projects.create("Orphan", "space-shooter")
    made = backup.create_backup(project.id)
    conn = dbmod.connect()
    conn.execute("DELETE FROM projects WHERE id = ?", (project.id,))
    conn.commit()
    conn.close()

    result = backup.restore_backup(made["backupId"])

    assert result["reassignedId"] is True
    assert result["project"].id != project.id


def test_restore_missing_backup(store):
    with pytest.raises(backup.BackupError) as excinfo:
        backup.restore_backup("nope-20260101T000000Z")
    assert excinfo.value.code == "backup-not-found"


def test_restore_corrupt_zip(store):
    folder = backup.backups_dir()
    bad = folder / "abc-20260101T000000Z.zip"
    bad.write_bytes(b"this is not a zip")
    with pytest.raises(backup.BackupError, match="corrupt"):
        backup.restore_backup("abc-20260101T000000Z")


def test_restore_rejects_zip_without_project_json(store):
    folder = backup.backups_dir()
    bad = folder / "abc-20260101T000001Z.zip"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("blueprint.json", "{}")
    with pytest.raises(backup.BackupError, match="project.json missing"):
        backup.restore_backup("abc-20260101T000001Z")


def test_restore_validates_record_fields(store):
    folder = backup.backups_dir()

    def _write(stem: str, record: dict) -> str:
        target = folder / f"{stem}.zip"
        with zipfile.ZipFile(target, "w") as zf:
            zf.writestr("project.json", json.dumps(record))
        return stem

    base = {"id": "goodid123456", "name": "Good", "genre": "space-shooter",
            "state": "draft", "stateReason": "", "archived": False,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "updatedAt": "2026-01-01T00:00:00+00:00"}
    for key, value in [("name", "   "), ("genre", "racing"),
                       ("state", "flying")]:
        broken = dict(base, **{key: value})
        stem = _write(f"bad-{key}-20260101T000000Z", broken)
        with pytest.raises(backup.BackupError, match="corrupt"):
            backup.restore_backup(stem)


def test_restore_rejects_zip_slip(store):
    folder = backup.backups_dir()
    bad = folder / "evil-20260101T000000Z.zip"
    record = {"id": "evilid123456", "name": "Evil", "genre": "space-shooter",
              "state": "draft"}
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("project.json", json.dumps(record))
        zf.writestr("../../evil.txt", "pwned")
    with pytest.raises(backup.BackupError, match="[Ee]scape|unsafe|corrupt"):
        backup.restore_backup("evil-20260101T000000Z")
    assert not (store["projects_dir"] / "evil.txt").exists()
