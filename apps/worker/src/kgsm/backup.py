"""Project backup and restore (FR-027; contract §8).

A backup is a ZIP snapshot of the project directory (which includes the
portable ``project.json`` record) stored under
``.kgsm/backups/<project-id>-<UTC-timestamp>.zip`` plus a ``.sha256`` sidecar.
Restore re-creates the directory and the DB row from the ZIP's
``project.json``, assigning a fresh id when the original id collides.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import stat
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import db as dbmod
from . import paths
from . import projects as projects_mod


class BackupError(Exception):
    """A backup/restore failure. ``code`` selects the API status mapping."""

    def __init__(self, message: str, code: str = "backup-error") -> None:
        super().__init__(message)
        self.code = code


def backups_dir() -> Path:
    """Directory holding backup ZIPs + sidecars (created on demand)."""
    target = paths.data_dir() / "backups"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_backup_id(backup_id: str) -> str:
    if (not isinstance(backup_id, str) or not backup_id or backup_id in (".", "..")
            or "/" in backup_id or "\\" in backup_id or "\x00" in backup_id):
        raise BackupError(f"invalid backup id {backup_id!r}")
    return backup_id


def _zip_path(backup_id: str) -> Path:
    return backups_dir() / f"{_check_backup_id(backup_id)}.zip"


def _record_from_path(path: Path, backup_id: str, project_id: str) -> dict:
    sidecar = path.with_suffix(path.suffix + ".sha256")
    try:
        sha256 = sidecar.read_text(encoding="utf-8").strip().split()[0]
    except (OSError, IndexError):
        sha256 = _sha256_file(path)
    stat = path.stat()
    return {
        "backupId": backup_id,
        "projectId": project_id,
        "file": str(path.resolve()),
        "sha256": sha256,
        "bytes": stat.st_size,
        "createdAt": datetime.fromtimestamp(
            stat.st_mtime, timezone.utc).isoformat(),
    }


def create_backup(project_id: str) -> dict:
    """Snapshot a project's directory into a timestamped ZIP (FR-027)."""
    project = projects_mod.get(project_id)  # raises ProjectError (→ 404)
    if not project.dir.is_dir():
        raise BackupError(f"project {project_id!r} has no directory to back up")
    record_file = project.dir / "project.json"
    if not record_file.is_file():
        # Keep the snapshot self-describing; reuse the canonical writer so
        # the record shape always matches projects.py.
        projects_mod._write_record(project)  # noqa: SLF001 (same package)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = f"{project.id}-{stamp}"
    dest = backups_dir() / f"{base}.zip"
    suffix = 0
    while dest.exists():
        suffix += 1
        dest = backups_dir() / f"{base}-{suffix:02d}.zip"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(project.dir.rglob("*")):
            # Never follow a planted symlink: its target bytes would leak
            # into the snapshot.
            if path.is_symlink() or not path.is_file():
                continue
            zf.write(path, path.relative_to(project.dir).as_posix())
    sha256 = _sha256_file(dest)
    dest.with_suffix(dest.suffix + ".sha256").write_text(sha256, encoding="utf-8")
    return {
        "backupId": dest.stem,
        "projectId": project.id,
        "file": str(dest.resolve()),
        "sha256": sha256,
        "bytes": dest.stat().st_size,
        "createdAt": _now(),
    }


def list_backups() -> list[dict]:
    """List snapshots newest-first (parsed from filenames + sidecars)."""
    folder = backups_dir()
    records = []
    for path in sorted(folder.glob("*.zip"), reverse=True):
        project_id = path.stem.split("-", 1)[0] if "-" in path.stem else ""
        records.append(_record_from_path(path, path.stem, project_id))
    return records


def delete_backup(backup_id: str) -> bool:
    """Delete a snapshot ZIP + sidecar. Returns False when absent."""
    path = _zip_path(backup_id)
    if not path.is_file():
        return False
    path.unlink()
    sidecar = path.with_suffix(path.suffix + ".sha256")
    try:
        sidecar.unlink()
    except OSError:
        pass
    return True


def _read_record(zf: zipfile.ZipFile, backup_id: str) -> dict:
    try:
        raw = zf.read("project.json").decode("utf-8")
    except KeyError:
        raise BackupError(
            f"backup {backup_id!r} is corrupt: project.json missing") from None
    try:
        record = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BackupError(
            f"backup {backup_id!r} is corrupt: project.json invalid ({exc})"
        ) from None
    if not isinstance(record, dict):
        raise BackupError(f"backup {backup_id!r} is corrupt: project.json "
                          f"must be an object")
    return record


def _validate_record(record: dict, backup_id: str) -> dict:
    name = record.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise BackupError(f"backup {backup_id!r} is corrupt: project name "
                          f"must be 1..80 characters")
    genre = record.get("genre")
    if genre not in projects_mod.GENRES:
        raise BackupError(f"backup {backup_id!r} is corrupt: unknown genre "
                          f"{genre!r}")
    state = record.get("state", "draft")
    if state not in projects_mod.STATES:
        raise BackupError(f"backup {backup_id!r} is corrupt: unknown state "
                          f"{state!r}")
    state_reason = record.get("stateReason", "")
    if not isinstance(state_reason, str):
        raise BackupError(f"backup {backup_id!r} is corrupt: stateReason "
                          f"must be a string")
    archived = bool(record.get("archived", False))
    created_at = record.get("createdAt") or _now()
    if not isinstance(created_at, str):
        created_at = _now()
    try:
        custom_genre = projects_mod.normalize_custom_genre(
            record.get("customGenre"))
    except projects_mod.ProjectError as exc:
        raise BackupError(f"backup {backup_id!r} is corrupt: {exc}") from None
    return {
        "custom_genre": custom_genre,
        "name": name.strip(),
        "genre": genre,
        "state": state,
        "state_reason": state_reason,
        "archived": archived,
        "created_at": created_at,
    }


_RESTORE_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def _verify_sidecar(path: Path, backup_id: str) -> None:
    """Fail closed when the .sha256 sidecar exists but does not match.

    A missing/unreadable sidecar is tolerated (hand-made and legacy ZIPs);
    every snapshot written by create_backup carries one.
    """
    sidecar = path.with_suffix(path.suffix + ".sha256")
    try:
        expected = sidecar.read_text(encoding="utf-8").strip().split()[0]
    except (OSError, IndexError):
        return
    if _sha256_file(path) != expected:
        raise BackupError(
            f"backup {backup_id!r} is corrupt: sha256 mismatch "
            f"(snapshot may have been tampered with)")


def _check_entries_safe(zf: zipfile.ZipFile, dest: Path,
                        backup_id: str) -> None:
    for info in zf.infolist():
        name = info.filename
        candidate = Path(name)
        if not name or candidate.is_absolute() or ".." in candidate.parts:
            raise BackupError(f"backup {backup_id!r} is corrupt: unsafe "
                              f"entry {name!r}")
        # A crafted ZIP could plant symlinks that later reads (copytree,
        # list, inspect) would follow out of the project dir.
        mode = (info.external_attr >> 16) & 0o170000
        if stat.S_ISLNK(mode):
            raise BackupError(f"backup {backup_id!r} is corrupt: symlink "
                              f"entry {name!r} not allowed")
        target = (dest / candidate).resolve()
        if target != dest.resolve() and dest.resolve() not in target.parents:
            raise BackupError(f"backup {backup_id!r} is corrupt: entry "
                              f"escapes project dir: {name!r}")


def _extract_safe(zf: zipfile.ZipFile, dest: Path, backup_id: str) -> None:
    _check_entries_safe(zf, dest, backup_id)
    zf.extractall(dest)


def _row_exists(conn: sqlite3.Connection, project_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone() \
        is not None


def restore_backup(backup_id: str,
                   conn: sqlite3.Connection | None = None) -> dict:
    """Restore a snapshot: re-create dir + DB row, remapping id on collision.

    Returns ``{"project": Project, "reassignedId": bool}``. A missing
    snapshot raises ``BackupError`` with code ``backup-not-found``; a
    corrupt/invalid one uses ``backup-error``.
    """
    path = _zip_path(backup_id)
    if not path.is_file():
        raise BackupError(f"backup {backup_id!r} not found",
                          code="backup-not-found")
    _verify_sidecar(path, backup_id)
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise BackupError(
            f"backup {backup_id!r} is corrupt: not a valid ZIP") from None
    with zf:
        try:
            record = _read_record(zf, backup_id)
        except zipfile.BadZipFile:
            raise BackupError(f"backup {backup_id!r} is corrupt: unreadable "
                              f"ZIP") from None
        fields = _validate_record(record, backup_id)
        own = conn is None
        conn = conn or dbmod.connect()
        try:
            raw_wanted = record.get("id")
            wanted = raw_wanted if isinstance(raw_wanted, str) else ""
            # The ZIP's id is untrusted: anything that is not a plain
            # 12-hex project id (e.g. '../../x') is treated as a
            # collision so a fresh safe id is minted below.
            if not _RESTORE_ID_RE.match(wanted):
                wanted = ""
            collision = (not wanted or _row_exists(conn, wanted)
                         or (paths.projects_dir() / wanted).exists())
            if collision:
                final_id = uuid.uuid4().hex[:12]
                while _row_exists(conn, final_id) or (
                        paths.projects_dir() / final_id).exists():
                    final_id = uuid.uuid4().hex[:12]
                reassigned = True
            else:
                final_id = wanted
                reassigned = False
            dest = paths.projects_dir() / final_id
            # Validate every entry BEFORE creating the destination so an
            # unsafe/corrupt ZIP leaves no orphan project dir behind.
            _check_entries_safe(zf, dest, backup_id)
            dest.mkdir(parents=True, exist_ok=True)
            zf.extractall(dest)
            project = projects_mod.Project(
                id=final_id, name=fields["name"], genre=fields["genre"],
                state=fields["state"], state_reason=fields["state_reason"],
                archived=fields["archived"],
                created_at=fields["created_at"], updated_at=_now(),
                custom_genre=fields["custom_genre"])
            projects_mod._write_record(project)  # noqa: SLF001 (same package)
            conn.execute(
                "INSERT INTO projects (id, name, genre, state, state_reason,"
                " archived, created_at, updated_at, custom_genre)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (project.id, project.name, project.genre, project.state,
                 project.state_reason, int(project.archived),
                 project.created_at, project.updated_at,
                 project.custom_genre))
            conn.commit()
            return {"project": project, "reassignedId": reassigned}
        finally:
            if own:
                conn.close()
