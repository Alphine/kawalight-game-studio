"""Godot 4 project exporter (SDD FR-021).

Turns a validated KGSM blueprint + genre config into a Godot 4 project
skeleton: project.godot, scenes, GDScript mechanics per genre, config.json,
assets and a neutral kgsm-manifest.json (FR-018 shape).

Standalone: stdlib only, importable without worker (kgsm) dependencies.
Worker wiring and UI integration are deliberately out of scope.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PureWindowsPath

from godot_genres import GENRES
from godot_genres.base import (
    EXPORTER_VERSION,
    GODOT_VERSION,
    SUPPORTED_GENRES,
    build_manifest,
    game_config_gd,
    hud_gd,
    hud_tscn,
    icon_svg,
    placeholder_png,
    project_godot_text,
    readme_text,
    sha256_hex,
)

__all__ = [
    "EXPORTER_VERSION",
    "GODOT_VERSION",
    "SUPPORTED_GENRES",
    "GodotExportError",
    "package_all",
    "stage_export",
    "template_id_for_genre",
]

_HERE = Path(__file__).resolve().parent


class GodotExportError(Exception):
    pass


def template_id_for_genre(genre: str) -> str:
    return f"godot.{genre}"


def _template_meta(genre: str, warnings: list[str]) -> dict:
    fallback = {"id": template_id_for_genre(genre), "version": EXPORTER_VERSION}
    path = _HERE / genre / "template.json"
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        warnings.append(f"template descriptor missing for {genre!r}; using default")
        return fallback
    if meta.get("id") != fallback["id"]:
        warnings.append(
            f"template.json id {meta.get('id')!r} does not match"
            f" {fallback['id']!r}; using descriptor"
        )
    return {"id": str(meta.get("id", fallback["id"])),
            "version": str(meta.get("version", EXPORTER_VERSION))}


def _validate_inputs(blueprint: dict, config: dict) -> str:
    if not isinstance(blueprint, dict):
        raise GodotExportError("blueprint must be an object")
    if not isinstance(config, dict):
        raise GodotExportError("config must be an object")
    if blueprint.get("schemaVersion") != "1.0.0":
        raise GodotExportError(
            f"unsupported blueprint schemaVersion {blueprint.get('schemaVersion')!r}")
    if config.get("schemaVersion") != "1.0.0":
        raise GodotExportError(
            f"unsupported config schemaVersion {config.get('schemaVersion')!r}")
    genre = blueprint.get("genre")
    if genre not in SUPPORTED_GENRES:
        raise GodotExportError(
            f"unsupported genre {genre!r}; expected one of"
            f" {', '.join(SUPPORTED_GENRES)}")
    if not blueprint.get("projectName"):
        raise GodotExportError("blueprint needs a non-empty 'projectName'")
    template = config.get("template", {})
    if not isinstance(template, dict):
        raise GodotExportError("config 'template' must be an object")
    expected = template_id_for_genre(genre)
    if template.get("id") != expected:
        raise GodotExportError(
            f"config template id {template.get('id')!r} does not match"
            f" blueprint genre {genre!r} (expected {expected!r})")
    genre_mod = GENRES[genre]
    missing = [s for s in genre_mod.REQUIRED_SECTIONS if s not in config]
    if missing:
        raise GodotExportError(
            f"config missing required sections: {', '.join(missing)}")
    for problem in genre_mod.validate(config):
        raise GodotExportError(f"config invalid: {problem}")
    return genre


def _resolution(blueprint: dict, config: dict) -> tuple[int, int]:
    res = blueprint.get("resolution", {})
    if isinstance(res, dict) and res.get("width") and res.get("height"):
        return int(res["width"]), int(res["height"])
    world = config.get("world", {})
    return int(world.get("width", 960)), int(world.get("height", 540))


def _input_actions(genre_mod, config: dict, warnings: list[str]) -> dict[str, str]:
    controls = config.get("controls", {})
    if not isinstance(controls, dict):
        raise GodotExportError("config 'controls' must be an object")
    actions = {}
    for key, value in controls.items():
        action = genre_mod.CONTROL_ACTIONS.get(key)
        if action is None:
            warnings.append(
                f"input: no Godot action mapping for control {key!r}; skipped")
            continue
        actions[action] = str(value)
    return actions


def _default_asset_dirs(genre: str) -> list[Path]:
    sibling = _HERE.parent / "phaser" / genre / "assets"
    return [sibling] if sibling.is_dir() else []


def _scene_asset_refs(out_dir: Path) -> dict[str, str]:
    """role-by-path for res://assets/* referenced by staged scenes/scripts."""
    refs: dict[str, str] = {}
    for item in sorted(out_dir.rglob("*")):
        if not item.is_file() or item.suffix not in (".tscn", ".gd"):
            continue
        for ref in re.findall(r"res://(assets/[^\"'\s)]+)",
                              item.read_text(encoding="utf-8")):
            refs.setdefault(ref, Path(ref).stem)
    return refs


def _safe_sprite_rel(rel: str) -> str:
    """Normalize a config sprite path; reject traversal/absolute entries.

    Sprite values come from config JSON (or scene refs) and are joined
    under out_dir, so absolute paths and '..' segments would write
    outside the staged project. Returns a posix-style relative path.
    """
    text = str(rel)
    segs = [s for s in re.split(r"[\\/]+", text) if s not in ("", ".")]
    if (not segs or ".." in segs or Path(text).is_absolute()
            or PureWindowsPath(text).is_absolute()):
        raise GodotExportError(
            f"unsafe sprite path {rel!r}: must be relative without '..'")
    return "/".join(segs)


def _stage_assets(
    *,
    config: dict,
    out_dir: Path,
    project_dir: Path | None,
    asset_dirs: list[Path] | None,
    genre: str,
    warnings: list[str],
) -> list[dict]:
    """Copy starter art, overlay project art, emit placeholders for gaps."""
    sprites: dict[str, str] = {}
    assets_cfg = config.get("assets", {})
    if isinstance(assets_cfg, dict) and isinstance(
            assets_cfg.get("sprites"), dict):
        sprites = {str(k): str(v) for k, v in assets_cfg["sprites"].items()}
    # Every texture a staged scene references must exist on disk, even if
    # the config sprite table omits it (placeholder + warning, never dangling).
    for ref, role in _scene_asset_refs(out_dir).items():
        if ref not in sprites.values():
            sprites.setdefault(f"{role} (scene ref)", ref)
            warnings.append(
                f"assets: {ref!r} referenced by scenes but missing from"
                " config sprites")
    if asset_dirs is None:
        asset_dirs = _default_asset_dirs(genre)
    else:
        asset_dirs = [Path(d) for d in asset_dirs]

    staged: dict[str, dict] = {}
    for role, rel in sprites.items():
        rel = _safe_sprite_rel(rel)
        dest = out_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        found = None
        for d in asset_dirs:
            cand = d / Path(str(rel)).name
            if cand.is_file():
                found = cand
                break
        if found is None:
            dest.write_bytes(placeholder_png())
            warnings.append(
                f"assets: placeholder sprite written for missing {rel!r}")
        else:
            shutil.copy2(found, dest)
        staged[dest.relative_to(out_dir).as_posix()] = {
            "path": dest.relative_to(out_dir).as_posix(),
            "sha256": sha256_hex(dest.read_bytes()),
            "role": str(role),
            "source": "starter",
            "provider": None, "model": None, "prompt": None, "seed": None,
        }

    if project_dir is not None and (project_dir / "assets").is_dir():
        for item in sorted((project_dir / "assets").rglob("*")):
            if not item.is_file() or item.name.endswith(".meta.json"):
                continue
            rel = item.relative_to(project_dir / "assets").as_posix()
            dest = out_dir / "assets" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dest)
            entry = {
                "path": dest.relative_to(out_dir).as_posix(),
                "sha256": sha256_hex(dest.read_bytes()),
                "role": item.stem,
                "source": "starter",
                "provider": None, "model": None, "prompt": None, "seed": None,
            }
            meta_file = item.with_suffix(item.suffix + ".meta.json")
            if meta_file.is_file():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    meta = {}
                if meta.get("source") in ("imported", "generated"):
                    entry.update({
                        "role": str(meta.get("role", entry["role"])),
                        "source": meta["source"],
                        "provider": meta.get("provider"),
                        "model": meta.get("model"),
                        "prompt": meta.get("prompt"),
                        "seed": meta.get("seed"),
                    })
            staged[entry["path"]] = entry
    return [staged[k] for k in sorted(staged)]


def stage_export(
    *,
    project_name: str,
    blueprint: dict,
    config: dict,
    project_dir: str | Path | None = None,
    asset_dirs: list[str | Path] | None = None,
    out_dir: str | Path,
) -> dict:
    """Stage a Godot 4 project skeleton into out_dir (cleared first)."""
    genre = _validate_inputs(blueprint, config)
    genre_mod = GENRES[genre]
    out_dir = Path(out_dir)
    project_dir = Path(project_dir) if project_dir is not None else None
    warnings: list[str] = []

    meta = _template_meta(genre, warnings)
    width, height = _resolution(blueprint, config)
    visual = blueprint.get("visualStyle", "pixel-art")
    actions = _input_actions(genre_mod, config, warnings)

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ctx = {
        "project_name": project_name,
        "blueprint": blueprint,
        "config": config,
        "warnings": warnings,
        "width": width,
        "height": height,
    }
    files: dict[str, str | bytes] = {
        "project.godot": project_godot_text(
            project_name=project_name, width=width, height=height,
            actions=actions, pixel_art=(visual != "illustrated-2d"),
            warnings=warnings),
        "icon.svg": icon_svg(),
        "config.json": json.dumps(config, indent=2),
        "scenes/hud.tscn": hud_tscn(),
        "scripts/game_config.gd": game_config_gd(),
        "scripts/hud.gd": hud_gd(),
        "README.md": readme_text(
            project_name=project_name, genre=genre,
            godot_version=GODOT_VERSION),
    }
    files.update(genre_mod.generate(ctx))
    for rel, content in files.items():
        dest = out_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            dest.write_bytes(content)
        else:
            dest.write_text(content, encoding="utf-8")

    assets = _stage_assets(
        config=config, out_dir=out_dir, project_dir=project_dir,
        asset_dirs=(None if asset_dirs is None else [Path(d) for d in asset_dirs]),
        genre=genre, warnings=warnings)

    manifest = build_manifest(
        project_name=project_name, genre=genre,
        template_id=meta["id"], template_version=meta["version"],
        config=config, assets=assets, warnings=list(warnings))
    (out_dir / "kgsm-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    staged_files = sorted(p.relative_to(out_dir).as_posix()
                          for p in out_dir.rglob("*") if p.is_file())
    return {"dir": str(out_dir), "files": staged_files, "manifest": manifest,
            "warnings": warnings}


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "game"


def _assert_no_secrets(staged_dir: Path, secrets: list[str]) -> None:
    """Fail closed when a staged plaintext file contains a secret value.

    Scans every UTF-8-decodable staged file in full (never truncated);
    binary files that fail UTF-8 decoding are skipped.
    """
    values = [s for s in secrets if isinstance(s, str) and s]
    if not values:
        return
    for item in sorted(staged_dir.rglob("*")):
        if not item.is_file():
            continue
        try:
            text = item.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for secret in values:
            if secret in text:
                rel = item.relative_to(staged_dir).as_posix()
                raise GodotExportError(
                    f"secret value detected in staged file {rel!r}")


def export_zip(
    staged_dir: str | Path,
    zip_path: str | Path,
    *,
    secrets: list[str] | None = None,
) -> Path:
    """Zip a staged Godot project atomically (write temp, then replace).

    When ``secrets`` (a list of secret values) is given, every staged
    UTF-8-decodable file is scanned first and a match fails the export.
    With ``secrets=None`` no scan runs: standalone/CLI callers that handle
    secrets must pass their values explicitly.
    """
    staged_dir, zip_path = Path(staged_dir), Path(zip_path)
    if secrets:
        _assert_no_secrets(staged_dir, list(secrets))
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.with_suffix(zip_path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in sorted(staged_dir.rglob("*")):
            if item.is_file():
                zf.write(item, item.relative_to(staged_dir).as_posix())
    os.replace(tmp, zip_path)
    return zip_path


def package_all(
    *,
    project_name: str,
    blueprint: dict,
    config: dict,
    project_dir: str | Path | None = None,
    asset_dirs: list[str | Path] | None = None,
    builds_dir: str | Path,
    secrets: list[str] | None = None,
) -> dict:
    """Stage into temp and publish one Godot project ZIP (never partial).

    ``secrets`` is forwarded to :func:`export_zip` for the pre-zip scan.
    """
    builds_dir = Path(builds_dir)
    slug = _slug(project_name)
    with tempfile.TemporaryDirectory(prefix="kgsm-godot-") as tmp:
        staged = stage_export(
            project_name=project_name, blueprint=blueprint, config=config,
            project_dir=project_dir, asset_dirs=asset_dirs,
            out_dir=Path(tmp) / "project")
        project_zip = export_zip(
            staged["dir"], builds_dir / f"{slug}-godot.zip",
            secrets=secrets)
    return {"project": str(project_zip), "warnings": staged["warnings"],
            "manifest": staged["manifest"]}


def _read_json(path: Path, what: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise GodotExportError(f"{what} not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise GodotExportError(f"{what} is not valid JSON: {exc}") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Stage a Godot 4 project skeleton from blueprint+config")
    parser.add_argument("blueprint", help="blueprint.json path")
    parser.add_argument("config", help="genre config.json path")
    parser.add_argument("out_dir", help="output directory (cleared first)")
    parser.add_argument("--project-dir", default=None)
    parser.add_argument("--asset-dir", action="append", default=None)
    parser.add_argument("--secrets-file", default=None,
                        help="JSON list of secret values to scan the"
                             " staged files for (match fails the export)")
    args = parser.parse_args(argv)
    blueprint = _read_json(Path(args.blueprint), "blueprint")
    config = _read_json(Path(args.config), "config")
    secrets = None
    if args.secrets_file is not None:
        secrets = _read_json(Path(args.secrets_file), "secrets")
        if not isinstance(secrets, list):
            print("error: secrets file must hold a JSON list of strings",
                  file=sys.stderr)
            return 1
    try:
        staged = stage_export(
            project_name=str(blueprint.get("projectName", "game")),
            blueprint=blueprint, config=config,
            project_dir=args.project_dir, asset_dirs=args.asset_dir,
            out_dir=args.out_dir)
        if secrets:
            _assert_no_secrets(Path(staged["dir"]), secrets)
    except GodotExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"staged {len(staged['files'])} files in {staged['dir']}")
    for warning in staged["warnings"]:
        print(f"warning: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
