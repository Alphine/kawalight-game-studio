"""Asset routes (contract §4; FR-010..013/025)."""

from __future__ import annotations

import json
import threading
from pathlib import Path

from .. import costs as costs_mod
from ..assets import (
    AssetError,
    import_asset,
    inspect_image,
    palette_report,
    save_frames,
    save_generated,
)
from ..providers import ProviderError, get_provider
from . import (
    ApiError,
    Request,
    bad_request,
    check_segment,
    need_int,
    need_str,
    opt_bool,
    opt_int,
    quote_to_dict,
    require_project,
    resolve_inside,
)

_STYLES = ("pixel-art", "illustrated-2d")
_MAX_IMAGE_SIDE = 4096  # upper bound for provider generate width/height

_INSPECT_KEYS = ("format", "mode", "width", "height", "hasAlpha", "alphaMin",
                 "alphaMax", "colorCount64", "distinctColorsCapped257")

# Serializes generate_assets' quote→authorize→generate→record_spend flow so
# concurrent ThreadingHTTPServer requests cannot both pass limits and both
# spend (TOCTOU overspend), and generated-file numbering cannot collide.
_GENERATE_LOCK = threading.Lock()


def _posix(rel_path: str) -> str:
    """Asset paths go on the wire with forward slashes (contract §4)."""
    return rel_path.replace("\\", "/")


def _inspect_with_capped_colors(target: Path) -> dict:
    # inspect.py already reports distinctColorsCapped257 via
    # getcolors(maxcolors=256); kept as a thin alias for the route below.
    return inspect_image(target)


def import_asset_route(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    src = need_str(body, "src")
    entity = check_segment(body.get("entity"), "entity")
    role = check_segment(body.get("role"), "role")
    animation = body.get("animation")
    if animation is not None:
        animation = check_segment(animation, "animation")
    if not Path(src).is_absolute():
        raise bad_request("src must be an absolute local-filesystem path")
    try:
        result = import_asset(project.dir, src, entity=entity, role=role,
                              animation=animation)
    except AssetError as exc:
        raise ApiError("asset-error", str(exc), 400) from None
    result["path"] = _posix(result["path"])
    return 201, result


def generate_assets(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    provider_id = need_str(body, "providerId")
    prompt = need_str(body, "prompt")
    if not prompt.strip():
        raise bad_request("prompt must not be empty")
    style = need_str(body, "style")
    if style not in _STYLES:
        raise bad_request(f"style must be one of {', '.join(_STYLES)}")
    width = need_int(body, "width", 1, _MAX_IMAGE_SIDE)
    height = need_int(body, "height", 1, _MAX_IMAGE_SIDE)
    n_images = opt_int(body, "nImages", 1, 1, costs_mod.MAX_IMAGES_PER_QUOTE)
    assert n_images is not None
    seed = body.get("seed")
    if seed is not None and not isinstance(seed, int):
        raise bad_request("seed must be an integer")
    if isinstance(seed, bool):
        raise bad_request("seed must be an integer")
    entity = check_segment(body.get("entity"), "entity")
    role = check_segment(body.get("role"), "role")
    confirmed = opt_bool(body, "confirmed", False)

    with _GENERATE_LOCK:
        try:
            quote = costs_mod.quote(provider_id, n_images,
                                    project_id=project.id)
        except ProviderError as exc:
            raise ApiError("unknown-provider", str(exc), 404) from None
        except costs_mod.CostError as exc:
            raise ApiError("bad-request", str(exc), 400) from None
        try:
            costs_mod.authorize(quote, confirmed)
        except costs_mod.CostError as exc:
            message = str(exc)
            quoted = {"quote": quote_to_dict(quote)}
            if quote.blocked:
                raise ApiError("cost-blocked", message, 402, quoted) from None
            raise ApiError("needs-confirmation", message, 409,
                           quoted) from None

        provider = get_provider(provider_id)
        try:
            images = provider.generate(
                prompt, style=style, width=width, height=height, seed=seed,
                n_images=n_images)
        except ProviderError as exc:
            raise ApiError("provider-error", str(exc), 502) from None
        saved = []
        for image in images:
            try:
                record = save_generated(
                    project.dir, image, entity=entity, role=role,
                    prompt=prompt, provider_id=provider_id, seed=seed)
            except AssetError as exc:
                raise ApiError("asset-error", str(exc), 400) from None
            record["path"] = _posix(record["path"])
            saved.append(record)
        spent = quote.cents if quote.cents is not None else 0
        costs_mod.record_spend(
            spent, f"generate {n_images} image(s) via {provider_id}",
            project_id=project.id)
        return 201, {"assets": saved, "quote": quote_to_dict(quote),
                     "spentCents": spent}


def slice_assets(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    body = req.body
    sheet_rel = need_str(body, "sheet")
    entity = check_segment(body.get("entity"), "entity")
    animation = check_segment(body.get("animation"), "animation")
    frame_rate = need_int(body, "frameRate", 1, 60)
    grid: dict = {
        "frame_width": need_int(body, "frameWidth", 1, None),
        "frame_height": need_int(body, "frameHeight", 1, None),
        "margin": opt_int(body, "margin", 0, 0, None) or 0,
        "spacing": opt_int(body, "spacing", 0, 0, None) or 0,
    }
    columns = opt_int(body, "columns", None, 1, None)
    rows = opt_int(body, "rows", None, 1, None)
    if columns is not None:
        grid["columns"] = columns
    if rows is not None:
        grid["rows"] = rows
    sheet = resolve_inside(project.dir, sheet_rel)
    if not sheet.is_file():
        raise ApiError("asset-not-found", f"sheet {sheet_rel!r} not found",
                       404)
    try:
        animation_obj = save_frames(project.dir, sheet, entity=entity,
                                    animation=animation, frame_rate=frame_rate,
                                    **grid)
    except AssetError as exc:
        raise ApiError("asset-error", str(exc), 400) from None
    except (OSError, ValueError) as exc:
        raise ApiError("asset-error", f"cannot slice sheet: {exc}",
                       400) from None
    return 201, animation_obj


def inspect_asset(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    rel = need_str(req.body, "path")
    target = resolve_inside(project.dir, rel)
    info = _inspect_with_capped_colors(target)
    response: dict = {"errors": info.get("errors", []),
                      "warnings": info.get("warnings", [])}
    for key in _INSPECT_KEYS:
        if key in info:
            response[key] = info[key]
    return 200, response


def palette_asset(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    rel = need_str(req.body, "path")
    max_colors = opt_int(req.body, "maxColors", 16, 1, None)
    assert max_colors is not None
    target = resolve_inside(project.dir, rel)
    if not target.is_file():
        raise ApiError("asset-not-found", f"asset {rel!r} not found", 404)
    try:
        report = palette_report(target, max_colors)
    except (OSError, ValueError) as exc:
        raise ApiError("asset-error", f"cannot read asset: {exc}",
                       400) from None
    return 200, {"path": rel, "sampledColors": report["sampledColors"],
                 "topColors": report["topColors"],
                 "pixelArtHint": report["pixelArtHint"]}


def list_assets(req: Request) -> tuple[int, dict]:
    project = require_project(req.group("id"))
    entity = req.query.get("entity")
    base = project.dir / "assets"
    items = []
    if base.is_dir():
        paths = sorted(p for p in base.rglob("*") if p.is_file())
        for path in paths:
            if path.name.endswith(".meta.json"):
                continue
            rel = path.relative_to(project.dir).as_posix()
            if entity and not rel.startswith(f"assets/{entity}/"):
                continue
            item: dict = {"path": rel}
            sidecar = path.parent / (path.name + ".meta.json")
            if sidecar.is_file():
                try:
                    item["meta"] = json.loads(
                        sidecar.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    pass
            items.append(item)
    return 200, {"assets": items}


ROUTES = [
    ("POST", r"/projects/(?P<id>[^/]+)/assets/import", import_asset_route),
    ("POST", r"/projects/(?P<id>[^/]+)/assets/generate", generate_assets),
    ("POST", r"/projects/(?P<id>[^/]+)/assets/slice", slice_assets),
    ("POST", r"/projects/(?P<id>[^/]+)/assets/inspect", inspect_asset),
    ("POST", r"/projects/(?P<id>[^/]+)/assets/palette", palette_asset),
    ("GET", r"/projects/(?P<id>[^/]+)/assets", list_assets),
]
