# Playtest and Export

## Playtest

The **Playtest** tab runs the real game. The worker:

1. Takes the project's stored `config.json`.
2. Stages the game files into `builds/playtest/`, overwriting any old copy.
3. Scans the staged files for secrets. If a stored key appears, staging fails.
4. Serves the game to the studio over localhost.

A project needs a stored config before it can be played. If you see
"config.json not found", save a config first (see
[Troubleshooting](Troubleshooting.md)).

The studio also has a schematic canvas preview for quick sketches. It does not
run the real game.

Console mode shows the game in a console-style frame.

Details: [docs/playtest.md](../docs/playtest.md).

## Export

- **ZIP build:** a playable Phaser game. Download it from the Export view or the
  Builds list.
- **Godot 4 project:** produced by the Godot exporter. It is not yet verified in
  a real Godot editor. See [docs/godot-exporter.md](../docs/godot-exporter.md).

Exports are secret-scanned like playtest builds.

## Backup and restore

Create a backup from a project, then restore it from the backup list. Each
backup is a ZIP plus a SHA-256 sidecar. Restore assigns a new project id if the
original id is taken. See [docs/ops.md](../docs/ops.md).
