# AUTO mode: one-click game pipeline (NEW)

`POST /projects/auto` runs the whole pipeline in one call: create project →
build blueprint → assemble → validate → store config → package a phaser
playable ZIP. Fully deterministic and offline: no providers, no network, no
spend (no `costs` quote/authorize involved).

## Route shape

Request (JSON object):

| Field   | Type   | Required | Meaning                                   |
|---------|--------|----------|-------------------------------------------|
| `name`  | string | yes      | Project name, 1..80 chars (trimmed)       |
| `genre` | string | yes      | One of the 5 genres (see below)           |
| `prompt`| string | no       | Free text: theme hint + recorded in notes (any length; notes keep the first 4000 chars) |
| `themeId`| string| no       | Explicit starter theme for the genre (whitespace-trimmed) |

Success: `201` with exactly these keys:

```json
{
  "project": { "id": "…", "name": "…", "genre": "…", /* … */ },
  "blueprint": { "schemaVersion": "1.0.0", "genre": "…", "theme": "…" },
  "config": { "template": { "id": "phaser.…", "version": "1.0.0" } },
  "validation": { "ok": true, "errors": [], "warnings": [] },
  "playable": "builds/my-game-playable.zip"
}
```

- `project`: the created project record (same shape as `POST /projects`).
- `blueprint`: the generated blueprint (also stored as `blueprint.json`).
- `config`: the assembled template config (also stored as `config.json`).
- `validation`: the config validation report (`ok` is always true on 201).
- `playable`: project-relative path of the playable ZIP under `builds/`
  (a `-source.zip` sibling is packaged alongside, as with manual export).

Errors:

| Status | Code                | Meaning                                    |
|--------|---------------------|--------------------------------------------|
| 400    | `bad-request`       | Wrong field type / missing field           |
| 400    | `invalid-name`      | `name` not 1..80 chars                     |
| 400    | `unknown-theme`     | `themeId` not a starter for this genre     |
| 404    | `unknown-genre`     | `genre` not one of the 5 genres            |
| 422    | `validation-failed` | Blueprint/config invalid; body has `report`|
| 422    | `assembly-failed`   | Assembler rejected the blueprint (no `report`)|
| 500    | `internal`          | Packaged manifest unreadable after export  |
| 502    | `export-error`      | Packaging failed                           |

Atomicity: any failure at/after project creation deletes the project again,
so a failed call never leaves a half-written project (no DB row, no
directory, no ZIPs). Re-calling with the same `name` is safe: names are not
unique, each call mints a fresh project id.

## Prompt / theme semantics

- Explicit `themeId` always wins over `prompt` keyword matching.
  Surrounding whitespace is stripped, so `" pirate-belt "` works.
- `prompt` length is unbounded at the API (subject to the 20 MB body
  cap): the full prompt is keyword-scanned, but only its first 4000
  chars are persisted into blueprint `notes` (the schema limit).
- Without `themeId`, the prompt is scanned case-insensitively for the
  genre's keywords in priority order (non-default themes first, default
  theme's keywords last); the first keyword found anywhere in the prompt
  selects its theme. E.g. for `space-shooter`, "neon alien raid" picks
  `neon-swarm`, not the `alien-invasion` default.
- With neither (or no keyword hit), the genre default (first row per genre)
  is used.
- The prompt is recorded verbatim into blueprint `notes` (truncated to 4000
  chars, the schema limit); empty/missing prompt yields `notes: ""`.
- The blueprint `seed` is derived deterministically
  (`sha256(genre, name, themeId)`), so the same request always builds the
  same blueprint.

Starters and keywords (implementation: `kgsm/auto.py` `STARTERS`/`KEYWORDS`):

| Genre            | themeId (default first) | Theme label    | Keywords                    |
|------------------|-------------------------|----------------|-----------------------------|
| `space-shooter`  | `alien-invasion`        | Alien Invasion | alien, invasion, xeno       |
|                  | `neon-swarm`            | Neon Swarm     | neon                        |
|                  | `pirate-belt`           | Pirate Belt    | pirate, raider, marauder    |
| `endless-runner` | `neon-rooftops`         | Neon Rooftops  | neon, roof, city            |
|                  | `desert-dash`           | Desert Dash    | desert, sand, cactus        |
|                  | `ember-caverns`         | Ember Caverns  | cave, cavern, ember, lava   |
| `side-scroller`  | `mossy-cliffs`          | Mossy Cliffs   | moss, cliff, forest         |
|                  | `lava-caves`            | Lava Caves     | lava, cave, magma           |
|                  | `sky-ruins`             | Sky Ruins      | sky, ruin, cloud            |
| `battle-2d`      | `monster-arena`         | Monster Arena  | monster, arena              |
|                  | `robot-foundry`         | Robot Foundry  | robot, foundry, steel       |
|                  | `shadow-crypt`          | Shadow Crypt   | shadow, crypt, undead, ghost|
| `farming`        | `sunny-acres`           | Sunny Acres    | sun, acre, field            |
|                  | `moonlit-grove`         | Moonlit Grove  | moon, night, grove          |
|                  | `tidepool-farm`         | Tidepool Farm  | tide, sea, coast            |

## Limits

- Starters differ by theme label and foe roster only; resolution, controls,
  difficulty preset (`normal`/`gradual`), and progression text are fixed per
  genre. Tune via `PUT /projects/{id}/blueprint` + reassemble afterwards.
- No AI/provider input: `prompt` never leaves the box and never changes
  anything except starter selection and `notes`.
- Phaser playable ZIP only; no Godot export in AUTO mode.
- Project state is left as created (`draft`); lifecycle transitions are the
  caller's job, same as manual export.
