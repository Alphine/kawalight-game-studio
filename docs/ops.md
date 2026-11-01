# KGSM Operations: backup/restore + audio import

Owner: A5-worker-ops. Implements FR-027 (backup/restore) and the FR-029
wave-1 slice (audio import only). Wire shapes follow the frozen
[API contract](api-contract.md) (§8 backup/restore, §9 audio); this doc
covers behaviour the contract leaves to the implementation.

## 1. Backup / restore (FR-027)

Module: `apps/worker/src/kgsm/backup.py`. Stdlib only (`zipfile`,
`hashlib`, `sqlite3`).

### Layout

```text
.kgsm/backups/<project-id>-<UTC-timestamp>.zip        # snapshot
.kgsm/backups/<project-id>-<UTC-timestamp>.zip.sha256 # hex digest sidecar
```

- `<UTC-timestamp>` is `%Y%m%dT%H%M%SZ` (e.g. `20261029T193000Z`); a
  second backup within the same second gets a `-01`, `-02`, … suffix so
  names (and therefore `backupId`s) stay unique.
- `backupId` is the ZIP filename stem.
- The ZIP holds the whole project directory with POSIX relative names,
  including the portable `project.json` record (rewritten from the DB
  first if it is missing, so a snapshot is always self-describing).

### Endpoints (§8)

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/projects/{id}/backup` | `201 {backupId, projectId, file, sha256, bytes, createdAt}` (`file` is absolute) |
| `GET` | `/backups` | `200 {backups: [...]}` newest-first, parsed from filenames/sidecars |
| `POST` | `/projects/restore` `{backupId}` | `201 {project, reassignedId}` |

- Unknown project → `404 project-not-found`; unknown snapshot →
  `404 backup-not-found`; corrupt ZIP / invalid record →
  `422 backup-error`.
- `GET /backups` recomputes the digest when a sidecar is missing instead
  of failing.

### Restore semantics

1. The ZIP must be a valid archive containing a `project.json` object.
2. The record is validated: name 1..80 chars, genre in the known five,
   state in the lifecycle (default `draft` when absent), `stateReason`
   a string. Anything else fails closed with `backup-error`.
3. **Collision:** when the record's id already exists as a DB row *or* a
   project directory, restore mints a fresh 12-hex id and sets
   `reassignedId: true`; otherwise the original id is kept.
4. Extraction is zip-slip safe: absolute names, `..` segments, and
   resolved paths escaping the destination abort the restore.
5. `project.json` is rewritten with the final id, then the DB row is
   inserted. Restore never overwrites an existing project directory.

### CLI

```text
kgsm backup <project-id>            # print the backup record as JSON
kgsm backups [--project-id <id>]    # list snapshots (newest first)
kgsm backup-delete <backup-id>      # delete ZIP + sidecar (exit 1 if absent)
kgsm restore <backup-id>            # print {project, reassignedId} as JSON
```

Exit code is `1` with a one-line `error: …` on stderr for unknown
projects/backups and corrupt snapshots.

### Deleting snapshots

`backup.delete_backup(backup_id)` removes the ZIP and its sidecar and
returns `False` when the id does not exist. There is intentionally no
`DELETE /backups/...` route: the frozen contract (§8) defines only
create/list/restore, so deletion is a module + CLI operation until a
contract revision adds it. Ids are confined to plain names (`/`, `\`,
`..` rejected) so deletion cannot escape the backups directory.

### Retention (no automatic pruning)

Snapshots accumulate: nothing deletes them unless you do. Prune by hand
from the CLI when the backups directory grows:

```powershell
kgsm backups --project-id <id>   # newest first; note stale backupIds
kgsm backup-delete <backup-id>   # removes ZIP + sidecar
```

For unattended machines, schedule the same two commands (e.g. a weekly
Task Scheduler job that lists snapshots and deletes all but the newest
N per project). A future contract revision may add
`DELETE /backups/{id}` with UI wiring; until then, retention is this
documented CLI routine, not an API feature.

## 2. Audio import (FR-029 wave-1 slice)

Module: `apps/worker/src/kgsm/audio.py`. Stdlib only (`wave` for WAV
structure; hand-rolled header sniffing for MP3/OGG). Generation and
SFX synthesis are P2 and out of scope.

### Layout

```text
projects/<id>/audio/[<entity>/]<role>-<stem>.<ext> + .meta.json sidecar
```

### Endpoints (§9)

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/projects/{id}/audio/import` `{src, role, entity?}` | `201 {path, meta}` |
| `GET` | `/projects/{id}/audio` | `200 {audio: [{path, meta?}]}` |

- `src` must be an absolute local path (same-machine worker, FR-010);
  relative paths → `400 bad-request`.
- `role` is required, `entity` optional; both must be plain names
  (separators/`..` → `400 path-escape`).
- Failures (bad extension, missing/empty source, unrecognized or
  mismatched content, limit breach) → `400 audio-error`.

### Validation and limits

- Extensions: `.wav`, `.mp3`, `.ogg` only.
- Content must match the extension: WAV needs `RIFF…WAVE` (then fully
  parsed with `wave`), MP3 needs an `ID3` tag or MPEG frame sync,
  OGG needs the `OggS` magic.
- `MAX_AUDIO_BYTES = 32 MiB`; `MAX_DURATION_SECONDS = 600` (10 min).
  The duration gate applies only when a duration is known (always for
  WAV, estimated for CBR MP3 from the first frame header, best-effort
  for OGG from the vorbis headers + final granule; otherwise
  `durationSeconds` is `null` and only the size gate applies).

### Sidecar metadata

`meta` always carries the contract fields
`{source: "imported", role, entity|null, sha256, bytes}` plus
manifest-ready extras: `format` (`wav`/`mp3`/`ogg`),
`durationSeconds` (or `null`), `sampleRate` (or `null`), `channels`
(or `null`).

### CLI

```text
kgsm audio-import <project-id> <src> --role <role> [--entity <e>]
kgsm audio-list <project-id>
```

### Testing

```text
.venv/Scripts/python -m pytest apps/worker/tests/test_backup.py \
    apps/worker/tests/test_audio.py apps/worker/tests/test_api_ops.py
```

All three files use the shared `store` fixture (`tests/conftest.py`)
to redirect `KGSM_DATA_DIR`/`KGSM_PROJECTS_DIR` at a tmp dir; audio
fixtures are synthesized with stdlib `wave` plus hand-built
MP3/OGG headers, so no binary assets are committed.
