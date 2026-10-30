"""Project service: CRUD + lifecycle state machine (SDD §2.4, FR-001, FR-019).

The database row is the index; ``project.json`` inside the project directory is
the portable record used by backup/restore and reopen (FR-019/FR-027).
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import db as dbmod
from . import paths

GENRES = ("space-shooter", "endless-runner", "side-scroller", "battle-2d", "farming")

STATES = (
    "draft",
    "blueprint_ready",
    "assets_pending",
    "assembling",
    "playable",
    "validating",
    "export_ready",
    "exported",
)

_NEXT = {STATES[i]: STATES[i + 1] for i in range(len(STATES) - 1)}


class ProjectError(Exception):
    pass


@dataclass
class Project:
    id: str
    name: str
    genre: str
    state: str
    state_reason: str
    archived: bool
    created_at: str
    updated_at: str

    @property
    def dir(self) -> Path:
        return paths.projects_dir() / self.id


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_project(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"],
        name=row["name"],
        genre=row["genre"],
        state=row["state"],
        state_reason=row["state_reason"] or "",
        archived=bool(row["archived"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _write_record(project: Project) -> None:
    project.dir.mkdir(parents=True, exist_ok=True)
    record = {
        "id": project.id,
        "name": project.name,
        "genre": project.genre,
        "state": project.state,
        "stateReason": project.state_reason,
        "archived": project.archived,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
    }
    (project.dir / "project.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


def create(name: str, genre: str, conn: sqlite3.Connection | None = None) -> Project:
    name = name.strip()
    if not (1 <= len(name) <= 80):
        raise ProjectError("project name must be 1..80 characters")
    if genre not in GENRES:
        raise ProjectError(f"unknown genre {genre!r}; expected one of {', '.join(GENRES)}")
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = Project(
            id=uuid.uuid4().hex[:12],
            name=name,
            genre=genre,
            state="draft",
            state_reason="",
            archived=False,
            created_at=_now(),
            updated_at=_now(),
        )
        conn.execute(
            "INSERT INTO projects (id, name, genre, state, state_reason, archived,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (project.id, project.name, project.genre, project.state, "",
             0, project.created_at, project.updated_at),
        )
        conn.commit()
        _write_record(project)
        return project
    finally:
        if own:
            conn.close()


def get(project_id: str, conn: sqlite3.Connection | None = None) -> Project:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        row = conn.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if row is None:
            raise ProjectError(f"project {project_id!r} not found")
        return _row_to_project(row)
    finally:
        if own:
            conn.close()


def list_projects(
    include_archived: bool = False, conn: sqlite3.Connection | None = None
) -> list[Project]:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        sql = "SELECT * FROM projects"
        if not include_archived:
            sql += " WHERE archived = 0"
        sql += " ORDER BY updated_at DESC"
        return [_row_to_project(r) for r in conn.execute(sql).fetchall()]
    finally:
        if own:
            conn.close()


def _save(project: Project, conn: sqlite3.Connection) -> Project:
    project.updated_at = _now()
    conn.execute(
        "UPDATE projects SET name = ?, genre = ?, state = ?, state_reason = ?,"
        " archived = ?, updated_at = ? WHERE id = ?",
        (project.name, project.genre, project.state, project.state_reason,
         int(project.archived), project.updated_at, project.id),
    )
    conn.commit()
    _write_record(project)
    return project


def rename(project_id: str, new_name: str, conn: sqlite3.Connection | None = None) -> Project:
    new_name = new_name.strip()
    if not (1 <= len(new_name) <= 80):
        raise ProjectError("project name must be 1..80 characters")
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = get(project_id, conn)
        project.name = new_name
        return _save(project, conn)
    finally:
        if own:
            conn.close()


def transition(
    project_id: str, to_state: str, reason: str = "",
    conn: sqlite3.Connection | None = None,
) -> Project:
    if to_state not in STATES:
        raise ProjectError(f"unknown state {to_state!r}")
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = get(project_id, conn)
        if to_state == project.state:
            return project
        forward_ok = _NEXT.get(project.state) == to_state
        backward_ok = STATES.index(to_state) < STATES.index(project.state)
        if not (forward_ok or backward_ok):
            raise ProjectError(
                f"cannot transition {project.state!r} -> {to_state!r}:"
                " forward moves one step, backward moves need mark_stale"
            )
        if backward_ok and not reason:
            raise ProjectError("backward transition requires a reason")
        project.state = to_state
        project.state_reason = reason if backward_ok else ""
        return _save(project, conn)
    finally:
        if own:
            conn.close()


def mark_stale(
    project_id: str, reason: str, to_state: str = "assets_pending",
    conn: sqlite3.Connection | None = None,
) -> Project:
    """Return a project to an earlier state, explaining why (SDD §2.4)."""
    if not reason:
        raise ProjectError("mark_stale requires a reason")
    if to_state not in STATES:
        raise ProjectError(f"unknown state {to_state!r}")
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = get(project_id, conn)
        if STATES.index(to_state) >= STATES.index(project.state):
            project.state_reason = reason
            return _save(project, conn)
        return transition(project_id, to_state, reason, conn)
    finally:
        if own:
            conn.close()


def set_archived(
    project_id: str, archived: bool, conn: sqlite3.Connection | None = None
) -> Project:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = get(project_id, conn)
        project.archived = archived
        return _save(project, conn)
    finally:
        if own:
            conn.close()


def duplicate(
    project_id: str, new_name: str, conn: sqlite3.Connection | None = None
) -> Project:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        source = get(project_id, conn)
        copy = create(new_name, source.genre, conn)
        if source.dir.is_dir():
            for item in source.dir.iterdir():
                if item.name == "project.json":
                    continue
                dest = copy.dir / item.name
                if item.is_dir():
                    shutil.copytree(item, dest)
                else:
                    shutil.copy2(item, dest)
        return get(copy.id, conn)
    finally:
        if own:
            conn.close()


def delete(project_id: str, conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        project = get(project_id, conn)
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        shutil.rmtree(project.dir, ignore_errors=True)
    finally:
        if own:
            conn.close()
