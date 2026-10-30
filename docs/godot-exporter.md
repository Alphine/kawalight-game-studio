# Godot 4 exporter (FR-021)

Standalone adapter that turns a validated KGSM blueprint + genre config into
a **Godot 4 project skeleton**: `project.godot`, scenes, GDScript mechanics,
`config.json`, assets and a neutral `kgsm-manifest.json`.

- Code: `packages/templates/godot/godot_exporter.py` + `godot_genres/`
- Descriptors: `packages/templates/godot/<genre>/template.json`
- Tests: `packages/templates/godot/tests/` (`pytest packages/templates/godot/tests`)
- Runtime target: Godot **4.3**, GL Compatibility renderer, 2D

## Scope

The adapter is **standalone and stdlib-only**: it imports without any worker
(`kgsm`) dependency so it stays independently testable (NFR-005). Worker
integration is wired: `apps/worker/src/kgsm/exporters/godot.py` validates the
project's `phaser.<genre>` config, re-stamps the template id to
`godot.<genre>`, and publishes one secret-scanned `*-godot4.zip`, served by
`POST /projects/{id}/exports/godot` (contract Rev 1.3) and the Export view's
"Export Godot 4 project" button.

## Usage

```python
import sys
sys.path.insert(0, "packages/templates/godot")
from godot_exporter import package_all, stage_export

staged = stage_export(
    project_name="Galaxy Strike",
    blueprint=blueprint,      # validated blueprint, genre in the 5 below
    config=config,            # validated genre config, template id godot.<genre>
    project_dir="projects/abc",  # optional: project art overrides starter art
    asset_dirs=None,          # optional: starter-art dirs (default: sibling
                              # phaser <genre>/assets when present)
    out_dir="builds/galaxy-godot",
)
# staged -> {"dir", "files", "manifest", "warnings"}

result = package_all(
    project_name="Galaxy Strike", blueprint=blueprint, config=config,
    builds_dir="builds",
)
# result -> {"project": "builds/galaxy-strike-godot.zip", ...}
```

CLI for manual runs:

```console
python packages/templates/godot/godot_exporter.py blueprint.json config.json out/
```

Inputs must already be validated (NFR-009): the exporter only checks
structure — schema versions, `godot.<genre>` template id matching the
blueprint genre, required sections and non-empty entity lists — and raises
`GodotExportError` otherwise.

## Generated project layout

```text
project.godot        name, window (blueprint resolution), input map,
                     GameConfig autoload, GL Compatibility renderer
config.json          genre config verbatim; tuning values are read live
scenes/main.tscn     main scene (Main + Player/Grid + Camera? + HUD)
scenes/*.tscn        player, HUD and genre entity scenes
scripts/game_config.gd  autoload: loads config.json, sprite paths, best scores
scripts/hud.gd       shared score/status/message/hint HUD
scripts/main.gd      genre director (spawns, scoring, pause, restart)
scripts/*.gd         genre mechanics (see table)
assets/*             starter art, project overrides, or generated placeholders
kgsm-manifest.json   neutral manifest, export-manifest.schema.json shape
README.md            how to open the project in Godot
```

Open: import `project.godot` in Godot 4.3 and press F5.

## Genre mechanics mapping

| Genre | Director (`main.gd`) | Key scripts |
| --- | --- | --- |
| `space-shooter` | wave queue + inter-wave delay, kill × multiplier, wave-clear bonus, lives, victory after `afterWave` | `player.gd` clamped 8-way move, pooled weapon (`poolSize`), power levels, i-frames; `enemy.gd` drift/sine/dive + per-wave scaling; `shot.gd` pooled projectile; `pickup.gd` drops |
| `endless-runner` | speed ramp `baseSpeed`→`maxSpeed`, distance/coins, gap tightening, milestones, best distance | `player.gd` gravity jump + slide hitbox; `obstacle.gd` ground/high movers; `coin.gd` lines/arcs |
| `side-scroller` | level built from `platforms`/`hazards`/`enemies`/`collectibles`/`checkpoints`/`exit`, kill plane, par-time bonus, best score | `player.gd` accel, coyote time, jump buffer, stomp bounce, knockback, i-frames; `walker.gd` patrol + stomp; `camera.gd` deadzone/lerp follow; `spikes`/`coin`/`checkpoint`/`exit` areas |
| `battle-2d` | arena spawns at `minDistFromPlayer`, foe-shot pool, heal-or-bonus pickups with TTL, waves, victory | `player.gd` auto-aim bolts (`aimRange`), spin melee, i-frames; `enemy.gd` chaser/weaver/shooter AI; `shot.gd`/`foe_shot.gd` pools; `pickup.gd` TTL blink |
| `farming` | coins/banked vs `targetCoins`, day timer, tool select, crop cycle, goal state | `farm_grid.gd` plot grid + click routing; `plot.gd` plant → water-each-stage → timed growth → ripe → harvest payout |

Common states in every director: pause toggle, game-over/goal message,
restart on the primary action key. Tuning lives in `config.json` (NFR-007);
no re-export is needed to change speeds, counts or timers.

## Input mapping

Config `controls` keys map to Godot actions per genre (e.g. `fire` → `fire`,
`toolPlant` → `tool_plant`). Key names map to physical keycodes: letters,
`SPACE`, arrows, `ONE`–`NINE`/`ZERO`, plus `ESCAPE`/`ENTER`/`TAB`/`SHIFT`/
`CTRL`/`ALT`/`PAUSE`. Unknown keys and unmapped controls are skipped with a
manifest warning, never silently rebound.

## Assets and manifest

- Starter art defaults to the sibling `packages/templates/phaser/<genre>/assets`
  so Godot reuses the same PNGs; pass `asset_dirs` to override.
- `project_dir/assets/**` overlays starter files; `<name>.meta.json`
  sidecars with `source: imported|generated` become manifest provenance.
- Every texture referenced by a staged scene is guaranteed on disk: missing
  art becomes a generated placeholder PNG plus a warning.
- The manifest matches `export-manifest.schema.json` (`runtime.name:
  "godot"`); `configHash` is the canonical-JSON SHA-256 of the config.
- Staging clears `out_dir` first and zips atomically (temp + replace), so a
  failed export never corrupts the last good build (NFR-003).

## Known limits

- GDScript/`.tscn` output is consistency-tested (all `preload`/`ext_resource`
  paths resolve, `load_steps` counts, mechanic keywords, placeholder PNG
  headers) but has **not** been opened in a real Godot 4.3 editor; that
  acceptance pass is still open.
- No secret-store scan runs standalone (NFR-002): the worker integration
  covers this by publishing through the shared secret-scanned `export_zip`.
- Genre config schemas still pin `phaser.<genre>` template ids; the worker
  re-stamps a copy to `godot.<genre>` internally, so no Godot schema variants
  are needed (standalone callers must pass an already-stamped config).
- Best-effort placeholders are solid-marker PNGs, not game art.
