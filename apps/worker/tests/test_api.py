"""Worker HTTP API tests (contract docs/api-contract.md v1).

End-to-end through a live localhost server using stdlib only
(urllib + threading).
"""

import json
import threading
import urllib.error
import urllib.request
import zipfile

import pytest
from PIL import Image

from kgsm.api.server import create_server
from kgsm.providers import (
    FailingProvider,
    MockProvider,
    register_provider,
    unregister_provider,
)
from test_config_validator import make_blueprint, make_config


@pytest.fixture()
def api(store):
    server = create_server("127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever,
                              kwargs={"poll_interval": 0.05})
    thread.daemon = True
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/api/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)


_NO_BODY = object()


def call(base, method, path, body=_NO_BODY):
    data = None
    headers = {"Accept": "application/json"}
    # Mirror the desktop UI: every request declares JSON, body or not.
    headers["Content-Type"] = "application/json"
    if body is not _NO_BODY:
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(base + path, data=data, method=method,
                                     headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            assert response.headers.get_content_type() == "application/json"
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def call_raw(base, method, path, raw: bytes):
    request = urllib.request.Request(
        base + path, data=raw, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def make_project(base, name="Demo", genre="space-shooter"):
    status, body = call(base, "POST", "/projects",
                        {"name": name, "genre": genre})
    assert status == 201, body
    return body


def make_png(path, size=(32, 32), color=(10, 200, 60)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)
    return path


class PaidProvider:
    """Deterministic paid provider for authorize/generate gate tests."""

    id = "test-paid"
    display_name = "Test paid"
    model = "paid-1"

    def estimate_cents(self, n_images):
        return 100 * n_images

    def generate(self, prompt, *, style, width, height, seed=None,
                 n_images=1):
        return MockProvider().generate(
            prompt, style=style, width=width, height=height, seed=seed,
            n_images=n_images)


@pytest.fixture(scope="module", autouse=True)
def _extra_providers():
    register_provider(FailingProvider())
    register_provider(PaidProvider())
    yield
    unregister_provider("failing")
    unregister_provider("test-paid")


# --------------------------------------------------------------------------
# §0 health + plumbing
# --------------------------------------------------------------------------

def test_health(api):
    from kgsm import __version__
    status, body = call(api, "GET", "/health")
    assert status == 200
    assert body == {"status": "ok", "worker": "kgsm", "version": __version__,
                    "contractVersion": "1.0.0"}


def test_unknown_route_is_json_404(api):
    status, body = call(api, "GET", "/nope")
    assert status == 404
    assert body["error"]["code"] == "not-found"


def test_invalid_json_body_is_bad_request(api):
    status, body = call_raw(api, "POST", "/projects", b"{oops")
    assert status == 400
    assert body["error"]["code"] == "bad-request"


def test_non_object_json_body_is_bad_request(api):
    status, body = call_raw(api, "POST", "/projects", b"[1,2]")
    assert status == 400
    assert body["error"]["code"] == "bad-request"


def _raw_request(base, method, path, data, headers):
    request = urllib.request.Request(base + path, data=data, method=method,
                                     headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_foreign_origin_is_refused_before_any_side_effect(api, store):
    # A drive-by page on another origin must not reach the handler at all.
    status, body = _raw_request(
        api, "POST", "/projects",
        json.dumps({"name": "Drive-by", "genre": "space-shooter"}).encode(),
        {"Content-Type": "application/json", "Origin": "https://evil.example"})
    assert status == 403
    assert body["error"]["code"] == "forbidden-origin"
    status, listing = call(api, "GET", "/projects")
    assert status == 200
    assert "Drive-by" not in json.dumps(listing)


def test_simple_cross_origin_post_is_refused_without_json_type(api):
    # text/plain POSTs need no CORS preflight, so the type check is the guard.
    status, body = _raw_request(
        api, "POST", "/projects",
        json.dumps({"name": "Simple", "genre": "space-shooter"}).encode(),
        {"Content-Type": "text/plain"})
    assert status == 415
    assert body["error"]["code"] == "unsupported-media-type"


def test_operator_listed_origin_is_allowed(api, monkeypatch):
    # The web build is served from basyid.dev, so the operator lists it.
    monkeypatch.setenv("KGSM_ALLOWED_ORIGINS", "https://basyid.dev/")
    status, _ = _raw_request(
        api, "POST", "/projects",
        json.dumps({"name": "Web Origin", "genre": "space-shooter"}).encode(),
        {"Content-Type": "application/json", "Origin": "https://basyid.dev"})
    assert status == 201
    # ...but a look-alike host is still refused.
    status, _ = _raw_request(
        api, "POST", "/projects",
        json.dumps({"name": "Lookalike", "genre": "space-shooter"}).encode(),
        {"Content-Type": "application/json",
         "Origin": "https://basyid.dev.evil.example"})
    assert status == 403


def test_local_dev_origin_is_still_allowed(api):
    status, _ = _raw_request(
        api, "POST", "/projects",
        json.dumps({"name": "Dev Origin", "genre": "space-shooter"}).encode(),
        {"Content-Type": "application/json",
         "Origin": "http://localhost:1420"})
    assert status == 201


# --------------------------------------------------------------------------
# §1 projects
# --------------------------------------------------------------------------

def test_projects_crud_flow(api):
    created = make_project(api, "Sky Guardians")
    pid = created["id"]
    assert created["state"] == "draft"

    status, body = call(api, "GET", f"/projects/{pid}")
    assert status == 200 and body["name"] == "Sky Guardians"

    status, body = call(api, "GET", "/projects")
    assert status == 200 and [p["id"] for p in body["projects"]] == [pid]

    status, body = call(api, "PATCH", f"/projects/{pid}",
                        {"name": "Sky Guardians 2", "archived": True})
    assert status == 200
    assert body["name"] == "Sky Guardians 2" and body["archived"] is True

    status, body = call(api, "GET", "/projects")
    assert status == 200 and body["projects"] == []
    status, body = call(api, "GET", "/projects?includeArchived=true")
    assert status == 200 and len(body["projects"]) == 1

    status, body = call(api, "POST", f"/projects/{pid}/duplicate",
                        {"name": "Copy"})
    assert status == 201
    assert body["id"] != pid and body["name"] == "Copy"

    status, body = call(api, "DELETE", f"/projects/{pid}")
    assert status == 200 and body == {"deleted": True, "id": pid}
    status, body = call(api, "GET", f"/projects/{pid}")
    assert status == 404 and body["error"]["code"] == "project-not-found"


def test_projects_create_errors(api):
    status, body = call(api, "POST", "/projects",
                        {"name": "  ", "genre": "space-shooter"})
    assert status == 400 and body["error"]["code"] == "invalid-name"
    status, body = call(api, "POST", "/projects",
                        {"name": "Ok", "genre": "racing"})
    assert status == 404 and body["error"]["code"] == "unknown-genre"
    status, body = call(api, "POST", "/projects", {"name": "NoGenre"})
    assert status == 400 and body["error"]["code"] == "bad-request"


def test_projects_missing_is_404(api):
    status, body = call(api, "GET", "/projects/does-not-exist")
    assert status == 404
    assert body["error"]["code"] == "project-not-found"
    status, body = call(api, "PATCH", "/projects/does-not-exist",
                        {"name": "x"})
    assert status == 404


def test_patch_validates_fields(api):
    pid = make_project(api)["id"]
    status, body = call(api, "PATCH", f"/projects/{pid}", {"name": ""})
    assert status == 400 and body["error"]["code"] == "invalid-name"
    status, body = call(api, "PATCH", f"/projects/{pid}",
                        {"archived": "yes"})
    assert status == 400 and body["error"]["code"] == "bad-request"


def test_transition_flow(api):
    pid = make_project(api)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/transition",
                        {"toState": "blueprint_ready"})
    assert status == 200 and body["state"] == "blueprint_ready"

    status, body = call(api, "POST", f"/projects/{pid}/transition",
                        {"toState": "playable"})
    assert status == 400 and body["error"]["code"] == "bad-transition"

    status, body = call(api, "POST", f"/projects/{pid}/transition",
                        {"toState": "draft"})
    assert status == 400 and body["error"]["code"] == "bad-transition"

    status, body = call(api, "POST", f"/projects/{pid}/transition",
                        {"toState": "draft", "reason": "redo"})
    assert status == 200 and body["state"] == "draft"
    assert body["stateReason"] == "redo"


def test_mark_stale(api):
    pid = make_project(api)["id"]
    call(api, "POST", f"/projects/{pid}/transition",
         {"toState": "blueprint_ready"})
    status, body = call(api, "POST", f"/projects/{pid}/mark-stale", {})
    assert status == 400
    assert body["error"]["code"] == "stale-reason-required"
    status, body = call(api, "POST", f"/projects/{pid}/mark-stale",
                        {"reason": "assets changed"})
    assert status == 200
    assert body["stateReason"] == "assets changed"


# --------------------------------------------------------------------------
# §2 blueprints
# --------------------------------------------------------------------------

def test_blueprint_validate(api):
    status, body = call(api, "POST", "/blueprints/validate",
                        {"blueprint": make_blueprint()})
    assert status == 200 and body["report"]["ok"] is True
    bad = make_blueprint()
    del bad["theme"]
    status, body = call(api, "POST", "/blueprints/validate",
                        {"blueprint": bad})
    assert status == 200 and body["report"]["ok"] is False
    status, body = call(api, "POST", "/blueprints/validate", {})
    assert status == 400


def test_blueprint_put_get_roundtrip(api):
    pid = make_project(api)["id"]
    status, body = call(api, "GET", f"/projects/{pid}/blueprint")
    assert status == 404 and body["error"]["code"] == "blueprint-not-found"

    status, body = call(api, "PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": make_blueprint()})
    assert status == 200 and body["stored"] is True
    assert body["report"]["ok"] is True

    status, body = call(api, "GET", f"/projects/{pid}/blueprint")
    assert status == 200
    assert body["blueprint"]["projectName"] == "Galaxy Strike"

    bad = make_blueprint()
    del bad["enemies"]
    status, body = call(api, "PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": bad})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False


def test_blueprint_assemble(api):
    pid = make_project(api)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {})
    assert status == 404 and body["error"]["code"] == "blueprint-not-found"

    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": make_blueprint()})
    assert status == 200, body
    assert body["storedConfig"] is True
    assert body["config"]["template"]["id"] == "phaser.space-shooter"
    assert body["report"]["ok"] is True

    # Stored blueprint is used when no inline one is given.
    call(api, "PUT", f"/projects/{pid}/blueprint",
         {"blueprint": make_blueprint()})
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {})
    assert status == 200 and body["storedConfig"] is True
    status, body = call(api, "GET", f"/projects/{pid}/config")
    assert status == 200 and "world" in body["config"]

    bad = make_blueprint()
    del bad["enemies"]
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": bad})
    assert status == 422 and body["error"]["code"] == "assembly-failed"


def test_assemble_rejects_genre_mismatch(api):
    pid = make_project(api, "Farm", "farming")["id"]
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": make_blueprint()})
    assert status == 422 and body["error"]["code"] == "assembly-failed"


# --------------------------------------------------------------------------
# §3 configs
# --------------------------------------------------------------------------

def test_configs_validate(api):
    status, body = call(api, "POST", "/configs/validate",
                        {"genre": "space-shooter", "config": make_config()})
    assert status == 200 and body["report"]["ok"] is True
    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    status, body = call(api, "POST", "/configs/validate",
                        {"genre": "space-shooter", "config": bad})
    assert status == 200 and body["report"]["ok"] is False
    status, body = call(api, "POST", "/configs/validate",
                        {"genre": "racing", "config": {}})
    assert status == 501 and body["error"]["code"] == "unknown-genre"


def test_config_put_get_roundtrip(api):
    pid = make_project(api)["id"]
    status, body = call(api, "GET", f"/projects/{pid}/config")
    assert status == 404 and body["error"]["code"] == "config-not-found"

    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": make_config()})
    assert status == 200 and body["stored"] is True
    status, body = call(api, "GET", f"/projects/{pid}/config")
    assert status == 200 and body["config"]["seed"] == 42

    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": bad})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False


def test_config_put_rejects_mismatched_schema(api):
    pid = make_project(api, "Farm", "farming")["id"]
    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": make_config()})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False


# --------------------------------------------------------------------------
# §4 assets
# --------------------------------------------------------------------------

def test_asset_import_and_list(api, tmp_path):
    pid = make_project(api)["id"]
    src = make_png(tmp_path / "src" / "ship.png")
    status, body = call(api, "POST", f"/projects/{pid}/assets/import",
                        {"src": str(src), "entity": "player", "role": "ship"})
    assert status == 201, body
    assert body["path"] == "assets/player/ship-ship.png"
    assert body["meta"]["width"] == 32 and body["meta"]["sha256"]

    status, body = call(api, "GET", f"/projects/{pid}/assets")
    assert status == 200
    assert body["assets"][0]["path"] == "assets/player/ship-ship.png"
    assert body["assets"][0]["meta"]["source"] == "imported"

    status, body = call(api, "GET", f"/projects/{pid}/assets?entity=enemy")
    assert status == 200 and body["assets"] == []


def test_asset_import_errors(api, tmp_path):
    pid = make_project(api)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/assets/import",
                        {"src": str(tmp_path / "missing.png"),
                         "entity": "e", "role": "r"})
    assert status == 400 and body["error"]["code"] == "asset-error"
    bad = tmp_path / "note.txt"
    bad.write_text("nope", encoding="utf-8")
    status, body = call(api, "POST", f"/projects/{pid}/assets/import",
                        {"src": str(bad), "entity": "e", "role": "r"})
    assert status == 400 and body["error"]["code"] == "asset-error"
    status, body = call(api, "POST", f"/projects/{pid}/assets/import",
                        {"src": "relative/path.png",
                         "entity": "e", "role": "r"})
    assert status == 400 and body["error"]["code"] == "bad-request"


def test_asset_inspect_and_palette(api, tmp_path):
    pid = make_project(api)["id"]
    src = make_png(tmp_path / "src" / "gem.png")
    _, imported = call(api, "POST", f"/projects/{pid}/assets/import",
                       {"src": str(src), "entity": "pickup", "role": "gem"})
    rel = imported["path"]

    status, body = call(api, "POST", f"/projects/{pid}/assets/inspect",
                        {"path": rel})
    assert status == 200, body
    assert body["width"] == 32 and body["hasAlpha"] is False
    assert body["errors"] == [] and "path" not in body
    assert body["colorCount64"] >= 1
    assert body["distinctColorsCapped257"] >= 1

    status, body = call(api, "POST", f"/projects/{pid}/assets/inspect",
                        {"path": "assets/pickup/nope.png"})
    assert status == 200 and body["errors"] == ["file not found"]

    status, body = call(api, "POST", f"/projects/{pid}/assets/inspect",
                        {"path": "../config.json"})
    assert status == 400 and body["error"]["code"] == "path-escape"

    status, body = call(api, "POST", f"/projects/{pid}/assets/palette",
                        {"path": rel, "maxColors": 4})
    assert status == 200, body
    assert body["path"] == rel and body["sampledColors"] >= 1
    assert body["topColors"] and body["pixelArtHint"]


def test_asset_slice(api, tmp_path):
    pid = make_project(api)["id"]
    sheet_src = tmp_path / "src" / "walk.png"
    make_png(sheet_src, size=(32, 16))
    _, imported = call(api, "POST", f"/projects/{pid}/assets/import",
                       {"src": str(sheet_src), "entity": "hero",
                        "role": "walk"})
    status, body = call(api, "POST", f"/projects/{pid}/assets/slice",
                        {"sheet": imported["path"], "entity": "hero",
                         "animation": "walk", "frameRate": 12,
                         "frameWidth": 16, "frameHeight": 16})
    assert status == 201, body
    assert body["animation"] == "walk" and body["frameRate"] == 12
    assert body["frames"] == ["frame-000.png", "frame-001.png"]

    status, body = call(api, "POST", f"/projects/{pid}/assets/slice",
                        {"sheet": imported["path"], "entity": "hero",
                         "animation": "bad", "frameRate": 99,
                         "frameWidth": 16, "frameHeight": 16})
    assert status == 400
    status, body = call(api, "POST", f"/projects/{pid}/assets/slice",
                        {"sheet": "assets/hero/missing.png", "entity": "hero",
                         "animation": "x", "frameRate": 12,
                         "frameWidth": 16, "frameHeight": 16})
    assert status == 404 and body["error"]["code"] == "asset-not-found"


def test_asset_generate_mock_free(api):
    pid = make_project(api)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        {"providerId": "mock", "prompt": "a hero ship",
                         "style": "pixel-art", "width": 32, "height": 32,
                         "nImages": 2, "entity": "player", "role": "ship"})
    assert status == 201, body
    assert len(body["assets"]) == 2
    assert body["assets"][0]["meta"]["source"] == "generated"
    assert body["assets"][0]["meta"]["provider"] == "mock"
    assert body["quote"]["cents"] == 0
    assert body["spentCents"] == 0

    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        {"providerId": "nope", "prompt": "x",
                         "style": "pixel-art", "width": 16, "height": 16,
                         "entity": "e", "role": "r"})
    assert status == 404 and body["error"]["code"] == "unknown-provider"
    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        {"providerId": "mock", "prompt": "x",
                         "style": "oil-painting", "width": 16, "height": 16,
                         "entity": "e", "role": "r"})
    assert status == 400
    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        {"providerId": "mock", "prompt": "x",
                         "style": "pixel-art", "width": 16, "height": 16,
                         "nImages": 17, "entity": "e", "role": "r"})
    assert status == 400


def test_asset_generate_confirmation_gates(api):
    pid = make_project(api)["id"]
    payload = {"providerId": "failing", "prompt": "boom",
               "style": "pixel-art", "width": 16, "height": 16,
               "entity": "fx", "role": "boom"}
    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        payload)
    assert status == 409, body
    assert body["error"]["code"] == "needs-confirmation"
    assert body["quote"]["cents"] is None

    status, body = call(api, "POST", f"/projects/{pid}/assets/generate",
                        {**payload, "confirmed": True})
    assert status == 502 and body["error"]["code"] == "provider-error"

    # Paid provider blocked by a spend limit even when confirmed.
    call(api, "PUT", "/costs/limits", {"scope": "global", "cents": 50})
    paid = {**payload, "providerId": "test-paid", "confirmed": True}
    status, body = call(api, "POST", f"/projects/{pid}/assets/generate", paid)
    assert status == 402, body
    assert body["error"]["code"] == "cost-blocked"
    assert body["quote"]["cents"] == 100


# --------------------------------------------------------------------------
# §6 costs
# --------------------------------------------------------------------------

def test_costs_quote_and_authorize(api):
    status, body = call(api, "POST", "/costs/quote",
                        {"providerId": "mock", "nImages": 4,
                         "projectId": "p1"})
    assert status == 200
    assert body == {"providerId": "mock", "projectId": "p1", "nImages": 4,
                    "cents": 0, "needsConfirmation": False, "reason": "free"}

    status, body = call(api, "POST", "/costs/authorize",
                        {"providerId": "mock", "nImages": 4,
                         "confirmed": False})
    assert status == 200 and body["authorized"] is True

    status, body = call(api, "POST", "/costs/quote",
                        {"providerId": "ghost", "nImages": 1})
    assert status == 404 and body["error"]["code"] == "unknown-provider"
    status, body = call(api, "POST", "/costs/quote",
                        {"providerId": "mock", "nImages": 99})
    assert status == 400


def test_costs_authorize_gates(api):
    status, body = call(api, "POST", "/costs/authorize",
                        {"providerId": "test-paid", "nImages": 1,
                         "confirmed": False})
    assert status == 409, body
    assert body["error"]["code"] == "needs-confirmation"
    assert body["quote"]["cents"] == 100

    call(api, "PUT", "/costs/limits", {"scope": "global", "cents": 50})
    status, body = call(api, "POST", "/costs/authorize",
                        {"providerId": "test-paid", "nImages": 1,
                         "confirmed": True})
    assert status == 402 and body["error"]["code"] == "cost-blocked"


def test_costs_limits_roundtrip(api):
    status, body = call(api, "GET", "/costs/limits")
    assert status == 200
    assert body["global"] is None and body["project"] is None
    assert body["spentThisMonth"] == {"global": 0, "project": 0}

    status, body = call(api, "PUT", "/costs/limits",
                        {"scope": "global", "cents": 1000})
    assert status == 200 and body == {"scope": "global", "cents": 1000}
    status, body = call(api, "PUT", "/costs/limits",
                        {"scope": "project", "projectId": "p1", "cents": 200})
    assert status == 200
    status, body = call(api, "GET", "/costs/limits?projectId=p1")
    assert status == 200
    assert body["global"] == 1000 and body["project"] == 200

    status, body = call(api, "PUT", "/costs/limits",
                        {"scope": "global", "cents": -1})
    assert status == 400
    status, body = call(api, "PUT", "/costs/limits",
                        {"scope": "project", "cents": 10})
    assert status == 400
    status, body = call(api, "PUT", "/costs/limits",
                        {"scope": "global", "cents": None})
    assert status == 200 and body["cents"] is None


def test_costs_ledger(api):
    pid = make_project(api)["id"]
    call(api, "POST", f"/projects/{pid}/assets/generate",
         {"providerId": "mock", "prompt": "ship", "style": "pixel-art",
          "width": 16, "height": 16, "entity": "e", "role": "r"})
    status, body = call(api, "GET", "/costs/ledger")
    assert status == 200, body
    assert body["totalCents"] == 0
    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["projectId"] == pid and entry["amountCents"] == 0

    status, body = call(api, "GET", "/costs/ledger?month=not-a-month")
    assert status == 400


# --------------------------------------------------------------------------
# §7 export
# --------------------------------------------------------------------------

def test_export_flow(api):
    project = make_project(api, "Galaxy Strike")
    pid = project["id"]
    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": make_config()})
    assert status == 200

    status, body = call(api, "POST", f"/projects/{pid}/exports", {})
    assert status == 201, body
    assert body["playable"] == "builds/galaxy-strike-playable.zip"
    assert body["source"] == "builds/galaxy-strike-source.zip"
    assert isinstance(body["warnings"], list)
    assert body["manifest"]["projectName"] == "Galaxy Strike"
    with zipfile.ZipFile(
            _project_file(api, pid, body["playable"])) as zf:
        assert "kgsm-manifest.json" in zf.namelist()

    status, body = call(api, "GET", f"/projects/{pid}/exports")
    assert status == 200
    assert len(body["exports"]) == 2
    assert body["exports"][0]["bytes"] > 0
    assert body["exports"][0]["createdAt"]


def _project_file(api_base, pid, rel):
    # Tests run in-process; resolve the project dir from the worker paths.
    import os
    from pathlib import Path
    return Path(os.environ["KGSM_PROJECTS_DIR"]) / pid / rel


def test_export_errors(api):
    pid = make_project(api)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/exports", {})
    assert status == 404 and body["error"]["code"] == "config-not-found"

    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    status, body = call(api, "POST", f"/projects/{pid}/exports",
                        {"config": bad})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"
    assert body["report"]["ok"] is False

    status, body = call(api, "POST", f"/projects/{pid}/exports",
                        {"config": make_config()})
    assert status == 201, body


def test_export_godot_flow(api):
    project = make_project(api, "Galaxy Strike")
    pid = project["id"]
    status, body = call(api, "PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": make_blueprint()})
    assert status == 200
    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": make_config()})
    assert status == 200

    status, body = call(api, "POST", f"/projects/{pid}/exports/godot", {})
    assert status == 201, body
    assert body["godot"] == "builds/galaxy-strike-godot4.zip"
    assert isinstance(body["warnings"], list)
    assert body["manifest"]["projectName"] == "Galaxy Strike"
    assert body["manifest"]["template"]["id"] == "godot.space-shooter"
    with zipfile.ZipFile(
            _project_file(api, pid, body["godot"])) as zf:
        names = zf.namelist()
        assert "kgsm-manifest.json" in names
        assert "project.godot" in names

    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    status, body = call(api, "POST", f"/projects/{pid}/exports/godot",
                        {"config": bad})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


def test_runner_assemble_validate_store_export(api):
    from test_config_validator import (
        make_runner_blueprint,
        make_runner_config,
    )

    pid = make_project(api, "Sprint", "endless-runner")["id"]
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": make_runner_blueprint()})
    assert status == 200, body
    assert body["report"]["ok"] is True
    assert body["config"]["template"]["id"] == "phaser.endless-runner"

    status, body = call(api, "POST", "/configs/validate",
                        {"genre": "endless-runner",
                         "config": make_runner_config()})
    assert status == 200 and body["report"]["ok"] is True

    status, body = call(api, "GET", f"/projects/{pid}/config")
    assert status == 200
    assert body["config"]["template"]["id"] == "phaser.endless-runner"

    status, body = call(api, "POST", f"/projects/{pid}/exports", {})
    assert status == 201, body
    assert body["manifest"]["template"]["id"] == "phaser.endless-runner"


@pytest.mark.parametrize("genre,template_id,bp_name,cfg_name", [
    ("side-scroller", "phaser.side-scroller",
     "make_side_blueprint", "make_side_config"),
    ("battle-2d", "phaser.battle-2d",
     "make_battle_blueprint", "make_battle_config"),
    ("farming", "phaser.farming",
     "make_farm_blueprint", "make_farm_config"),
])
def test_new_genre_assemble_validate_store_export(
        api, genre, template_id, bp_name, cfg_name):
    import test_config_validator as fixtures

    pid = make_project(api, f"Demo {genre}", genre)["id"]
    status, body = call(api, "POST", f"/projects/{pid}/blueprint/assemble",
                        {"blueprint": getattr(fixtures, bp_name)()})
    assert status == 200, body
    assert body["report"]["ok"] is True
    assert body["config"]["template"]["id"] == template_id

    status, body = call(api, "POST", "/configs/validate",
                        {"genre": genre,
                         "config": getattr(fixtures, cfg_name)()})
    assert status == 200 and body["report"]["ok"] is True

    status, body = call(api, "GET", f"/projects/{pid}/config")
    assert status == 200
    assert body["config"]["template"]["id"] == template_id

    status, body = call(api, "PUT", f"/projects/{pid}/config",
                        {"config": getattr(fixtures, cfg_name)()})
    assert status == 200 and body["stored"] is True

    status, body = call(api, "POST", f"/projects/{pid}/exports", {})
    assert status == 201, body
    assert body["manifest"]["template"]["id"] == template_id
