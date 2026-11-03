"""Build the complete example game for a genre.

For each genre this runs the same route calls the studio makes:

    blueprint  ->  assemble config  ->  Meta-generated assets  ->  config  ->  playable export

and stores the result under ``packages/templates/phaser/<genre>/example/``:

    example/
      prompts.json        art direction: one entry per generated sprite
      project/            blueprint.json, config.json, assets/ (generated)
      <slug>-playable.zip the exported, playable build
      manifest.json       which prompt made which asset, and the provider/model

Art comes from the Meta image provider (``meta-image``). It runs locally with the
key in the local secrets store (``.kgsm/secrets.json``). Each image is a paid call,
so run one genre at a time and keep the prompts short and deliberate.

Usage (from apps/worker, with PYTHONPATH=src):

    python -m kgsm.examples farming
    python -m kgsm.examples --dry-run farming   # validate prompts, no generation
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from . import paths

PROVIDER = "meta-image"


def example_dir(genre: str) -> Path:
    return paths.templates_dir() / "phaser" / genre / "example"


def load_prompts(genre: str) -> list[dict]:
    path = example_dir(genre) / "prompts.json"
    if not path.is_file():
        raise SystemExit(f"missing art direction: {path}")
    prompts = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(prompts, list) or not prompts:
        raise SystemExit(f"{path}: expected a non-empty list")
    required = ("sprite", "entity", "role", "width", "height", "style", "prompt")
    for i, item in enumerate(prompts):
        missing = [k for k in required if k not in item]
        if missing:
            raise SystemExit(f"{path}[{i}]: missing {', '.join(missing)}")
    return prompts


KEYING_NOTE = ("border-connected near-white background keyed to transparent after "
               "generation (provider returns opaque backdrops)")


def key_background(path: Path) -> bool:
    """Turn near-white backdrop connected to the image edge into transparency.

    Only pixels reachable from the border through near-white pixels change, so
    white highlights inside the subject survive. Returns True when the file changed.
    """
    from collections import deque

    from PIL import Image

    img = Image.open(path).convert("RGBA")
    width, height = img.size
    px = img.load()

    def backdrop(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and min(r, g, b) >= 226 and max(r, g, b) - min(r, g, b) <= 28

    queue = deque()
    seen = set()
    for x in range(width):
        for y in (0, height - 1):
            queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            queue.append((x, y))
    changed = False
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        if not backdrop(x, y):
            continue
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        changed = True
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    if changed:
        img.save(path)
    return changed


def finalize_asset(project_dir: Path, rel: str) -> None:
    """Key the backdrop of one generated asset and update its sidecar hash."""
    import hashlib

    target = project_dir / rel
    original = hashlib.sha256(target.read_bytes()).hexdigest()
    if not key_background(target):
        return
    sidecar = target.with_suffix(target.suffix + ".meta.json")
    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    meta.setdefault("providerSha256", meta.get("sha256", original))
    meta["sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
    meta["postProcess"] = KEYING_NOTE
    sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _call(method: str, path: str, body: dict | None = None, project_id: str | None = None):
    from .api import Request
    from .api.server import dispatch

    status, response = dispatch(Request(method=method, path=path, body=body or {}))
    if status >= 400:
        raise SystemExit(f"{method} {path} failed ({status}): {response}")
    return response


def _reload_asset(project_dir: Path, rel: str) -> dict:
    sidecar = project_dir / (rel + ".meta.json")
    return {"path": rel, "meta": json.loads(sidecar.read_text(encoding="utf-8"))}


def build(genre: str, *, dry_run: bool = False) -> Path:
    from . import projects as projects_mod

    blueprint_path = paths.templates_dir() / "phaser" / genre / "blueprint.demo.json"
    blueprint = json.loads(blueprint_path.read_text(encoding="utf-8"))
    prompts = load_prompts(genre)
    prompts_text = (example_dir(genre) / "prompts.json").read_text(encoding="utf-8")
    if dry_run:
        print(f"{genre}: {len(prompts)} prompts ok")
        return example_dir(genre)

    # Projects go to a throwaway root so the example never mixes with user data.
    tmp = Path(tempfile.mkdtemp(prefix="kgsm-example-"))
    try:
        os.environ["KGSM_PROJECTS_DIR"] = str(tmp / "projects")
        project = projects_mod.create(blueprint["projectName"], genre)
        pid = project.id

        _call("PUT", f"/projects/{pid}/blueprint", {"blueprint": blueprint})
        assembled = _call("POST", f"/projects/{pid}/blueprint/assemble", {})
        config = assembled["config"]

        sprites = dict(config["assets"]["sprites"])
        manifest = []
        for item in prompts:
            if item["sprite"] not in sprites:
                raise SystemExit(f"{genre}: sprite {item['sprite']!r} is not in the config")
            response = _call("POST", f"/projects/{pid}/assets/generate", {
                "providerId": PROVIDER,
                "prompt": item["prompt"],
                "style": item["style"],
                "width": item["width"],
                "height": item["height"],
                "nImages": 1,
                "entity": item["entity"],
                "role": item["role"],
                "confirmed": True,
            })
            asset = response["assets"][0]
            finalize_asset(projects_mod.get(pid).dir, asset["path"])
            asset = _reload_asset(projects_mod.get(pid).dir, asset["path"])
            sprites[item["sprite"]] = asset["path"]
            manifest.append({"sprite": item["sprite"], "file": asset["path"],
                             "provider": asset["meta"].get("provider"),
                             "model": asset["meta"].get("model"),
                             "sha256": asset["meta"].get("sha256"),
                             "providerSha256": asset["meta"].get("providerSha256"),
                             "postProcess": asset["meta"].get("postProcess")})
            print(f"  generated {item['sprite']} -> {asset['path']}")

        config["assets"]["sprites"] = sprites
        _call("PUT", f"/projects/{pid}/config", {"config": config})
        export = _call("POST", f"/projects/{pid}/exports", {})

        out = example_dir(genre)
        if out.exists():
            old = out.with_name(out.name + ".old")
            shutil.rmtree(old, ignore_errors=True)
            out.rename(old)
            shutil.rmtree(old, ignore_errors=True)
        (out / "project").mkdir(parents=True)
        project_dir = projects_mod.get(pid).dir
        shutil.copy2(blueprint_path, out / "project" / "blueprint.json")
        shutil.copy2(project_dir / "config.json", out / "project" / "config.json")
        if (project_dir / "assets").is_dir():
            shutil.copytree(project_dir / "assets", out / "project" / "assets")
        zip_src = project_dir / export["playable"]
        shutil.copy2(zip_src, out / Path(export["playable"]).name)
        (out / "prompts.json").write_text(prompts_text, encoding="utf-8")
        (out / "manifest.json").write_text(json.dumps({
            "genre": genre,
            "provider": PROVIDER,
            "assets": manifest,
            "playable": Path(export["playable"]).name,
        }, indent=2), encoding="utf-8")
    except BaseException:
        print(f"build failed; work folder kept for inspection: {tmp}", file=sys.stderr)
        raise
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"{genre}: example written to {out}")
    return out


def add_assets(genre: str, extra_path: Path, *, dry_run: bool = False) -> list[dict]:
    """Generate extra sprites for an existing example, without rebuilding it.

    Each entry in ``extra_path`` (a JSON list, same shape as prompts.json) becomes one
    new Meta image. Its sprite key is added to the example config, so the template
    loads it automatically. Existing assets are left alone. Costs one paid call per entry.
    Set "opaque": true for full-frame backgrounds, so the edge is not keyed out.
    """
    from .exporters.phaser import package_all
    from .providers import get_provider

    ex = example_dir(genre)
    project = ex / "project"
    config_path = project / "config.json"
    if not config_path.is_file():
        raise SystemExit(f"{genre}: no example to extend (run the full build first)")
    extra = json.loads(Path(extra_path).read_text(encoding="utf-8"))
    if not isinstance(extra, list) or not extra:
        raise SystemExit(f"{extra_path}: expected a non-empty list")
    required = ("sprite", "entity", "role", "width", "height", "style", "prompt")
    for i, item in enumerate(extra):
        missing = [k for k in required if k not in item]
        if missing:
            raise SystemExit(f"{extra_path}[{i}]: missing {', '.join(missing)}")
    if dry_run:
        print(f"{genre}: {len(extra)} extra prompts ok")
        return []

    config = json.loads(config_path.read_text(encoding="utf-8"))
    sprites = config["assets"]["sprites"]
    provider = get_provider(PROVIDER)
    manifest_path = ex / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    added = []
    for item in extra:
        if item["sprite"] in sprites and not item.get("replace", False):
            raise SystemExit(f"{genre}: sprite {item['sprite']!r} already exists; set replace to overwrite")
        images = provider.generate(
            item["prompt"], style=item["style"], width=item["width"], height=item["height"],
            seed=None, n_images=1)
        image = images[0]
        rel = f"assets/{item['entity']}/{item['role']}-gen-000.png"
        target = project / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(image.png_bytes)
        import hashlib
        sha = hashlib.sha256(image.png_bytes).hexdigest()
        meta = {"source": "generated", "entity": item["entity"], "role": item["role"],
                "prompt": item["prompt"], "provider": PROVIDER, "model": image.model,
                "seed": None, "width": image.width, "height": image.height,
                "mode": "RGBA", "sha256": sha}
        target.with_suffix(target.suffix + ".meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8")
        if not item.get("opaque", False):
            finalize_asset(project, rel)
        meta = json.loads(target.with_suffix(target.suffix + ".meta.json").read_text(encoding="utf-8"))
        sprites[item["sprite"]] = rel
        entry = {"sprite": item["sprite"], "file": rel, "provider": PROVIDER,
                 "model": meta.get("model"), "sha256": meta.get("sha256"),
                 "providerSha256": meta.get("providerSha256"), "postProcess": meta.get("postProcess")}
        manifest["assets"].append(entry)
        added.append(entry)
        print(f"  added {item['sprite']} -> {rel}")

    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    prompts_path = ex / "prompts.json"
    prompts = json.loads(prompts_path.read_text(encoding="utf-8"))
    prompts.extend(extra)
    prompts_path.write_text(json.dumps(prompts, indent=2), encoding="utf-8")

    # Re-export the playable build so the zip carries the new art.
    blueprint = json.loads((project / "blueprint.json").read_text(encoding="utf-8"))
    out_dir = Path(tempfile.mkdtemp(prefix="kgsm-example-export-"))
    result = package_all(project_name=blueprint["projectName"], genre=genre, config=config,
                         project_dir=project, builds_dir=out_dir)
    zip_src = Path(result["playable"]) if Path(result["playable"]).is_absolute() else out_dir / result["playable"]
    for old in ex.glob("*-playable.zip"):
        old.unlink()
    shutil.copy2(zip_src, ex / zip_src.name)
    manifest["playable"] = zip_src.name
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"{genre}: {len(added)} asset(s) added, playable re-exported")
    return added


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kgsm-examples",
                                     description="Build a genre's complete example game.")
    parser.add_argument("genre")
    parser.add_argument("--add", metavar="PROMPTS_JSON", default=None,
                        help="generate extra sprites into the existing example (no rebuild)")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate the art direction without calling the provider")
    args = parser.parse_args(argv)
    try:
        if args.add:
            add_assets(args.genre, Path(args.add), dry_run=args.dry_run)
        else:
            build(args.genre, dry_run=args.dry_run)
    except SystemExit as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
