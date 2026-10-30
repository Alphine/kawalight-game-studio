"""Minimal worker CLI used by smoke tests and later the desktop shell."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _load_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cmd_validate(args: argparse.Namespace) -> int:
    from .validation import (
        validate_blueprint,
        validate_manifest,
        validate_space_shooter_config,
    )

    data = _load_json(args.file)
    if args.kind == "config":
        # Auto-detect the genre validator from the config's template id.
        template_id = (data.get("template") or {}).get("id", "")
        if template_id == "phaser.endless-runner":
            from .validation import validate_endless_runner_config
            report = validate_endless_runner_config(data)
        elif template_id == "phaser.side-scroller":
            from .validation import validate_side_scroller_config
            report = validate_side_scroller_config(data)
        elif template_id == "phaser.battle-2d":
            from .validation import validate_battle_2d_config
            report = validate_battle_2d_config(data)
        elif template_id == "phaser.farming":
            from .validation import validate_farming_config
            report = validate_farming_config(data)
        else:
            report = validate_space_shooter_config(data)
    else:
        kinds = {"blueprint": validate_blueprint, "manifest": validate_manifest}
        report = kinds[args.kind](data)
    print(json.dumps(report.to_dict(), indent=2))
    print(report.summary())
    return 0 if report.ok else 1


def cmd_assemble(args: argparse.Namespace) -> int:
    from .blueprint import (
        AssemblyError,
        assemble_battle_2d,
        assemble_endless_runner,
        assemble_farming,
        assemble_side_scroller,
        assemble_space_shooter,
    )

    blueprint = _load_json(args.blueprint)
    genre = blueprint.get("genre", "")
    if genre == "endless-runner":
        assemble = assemble_endless_runner
    elif genre == "space-shooter":
        assemble = assemble_space_shooter
    elif genre == "side-scroller":
        assemble = assemble_side_scroller
    elif genre == "battle-2d":
        assemble = assemble_battle_2d
    elif genre == "farming":
        assemble = assemble_farming
    else:
        print(f"error: no assembler for genre {genre!r}", file=sys.stderr)
        return 1
    try:
        config = assemble(blueprint)
    except AssemblyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    Path(args.out).write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    from . import backup
    from .projects import ProjectError

    try:
        record = backup.create_backup(args.project_id)
    except (ProjectError, backup.BackupError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(record, indent=2))
    return 0


def cmd_backups(args: argparse.Namespace) -> int:
    from . import backup

    records = backup.list_backups()
    if args.project_id:
        records = [r for r in records if r["projectId"] == args.project_id]
    print(json.dumps({"backups": records}, indent=2))
    return 0


def cmd_backup_delete(args: argparse.Namespace) -> int:
    from . import backup

    try:
        deleted = backup.delete_backup(args.backup_id)
    except backup.BackupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"backupId": args.backup_id, "deleted": deleted},
                     indent=2))
    return 0 if deleted else 1


def cmd_restore(args: argparse.Namespace) -> int:
    from . import backup

    try:
        result = backup.restore_backup(args.backup_id)
    except backup.BackupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    project = result["project"]
    print(json.dumps({
        "project": {
            "id": project.id, "name": project.name, "genre": project.genre,
            "state": project.state, "stateReason": project.state_reason,
            "archived": project.archived, "createdAt": project.created_at,
            "updatedAt": project.updated_at,
        },
        "reassignedId": result["reassignedId"],
    }, indent=2))
    return 0


def cmd_audio_import(args: argparse.Namespace) -> int:
    from . import audio
    from . import paths
    from .projects import ProjectError, get

    try:
        project = get(args.project_id)
    except ProjectError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    try:
        result = audio.import_audio(paths.projects_dir() / project.id,
                                    args.src, role=args.role,
                                    entity=args.entity)
    except audio.AudioError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


def cmd_audio_list(args: argparse.Namespace) -> int:
    from . import audio
    from . import paths
    from .projects import ProjectError, get

    try:
        project = get(args.project_id)
    except ProjectError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    items = audio.list_audio(paths.projects_dir() / project.id)
    print(json.dumps({"audio": items}, indent=2))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    from .exporters import ExportError, package_all

    try:
        result = package_all(
            project_name=args.name, genre=args.genre,
            config=_load_json(args.config), project_dir=args.project_dir,
            builds_dir=args.builds_dir)
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kgsm")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("validate", help="validate a JSON file")
    p.add_argument("kind", choices=["config", "blueprint", "manifest"])
    p.add_argument("file")
    p.set_defaults(func=cmd_validate)
    p = sub.add_parser("assemble", help="blueprint -> template config")
    p.add_argument("blueprint")
    p.add_argument("-o", "--out", required=True)
    p.set_defaults(func=cmd_assemble)
    p = sub.add_parser("backup", help="snapshot a project dir into .kgsm/backups")
    p.add_argument("project_id")
    p.set_defaults(func=cmd_backup)
    p = sub.add_parser("backups", help="list backup snapshots")
    p.add_argument("--project-id", default=None)
    p.set_defaults(func=cmd_backups)
    p = sub.add_parser("backup-delete", help="delete a backup snapshot")
    p.add_argument("backup_id")
    p.set_defaults(func=cmd_backup_delete)
    p = sub.add_parser("restore", help="restore a project from a backup")
    p.add_argument("backup_id")
    p.set_defaults(func=cmd_restore)
    p = sub.add_parser("audio-import", help="import wav/mp3/ogg into audio/")
    p.add_argument("project_id")
    p.add_argument("src")
    p.add_argument("--role", required=True)
    p.add_argument("--entity", default=None)
    p.set_defaults(func=cmd_audio_import)
    p = sub.add_parser("audio-list", help="list imported audio files")
    p.add_argument("project_id")
    p.set_defaults(func=cmd_audio_list)
    p = sub.add_parser("export", help="package playable + source ZIPs")
    p.add_argument("project_dir")
    p.add_argument("--config", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--genre", required=True)
    p.add_argument("--builds-dir", required=True)
    p.set_defaults(func=cmd_export)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
