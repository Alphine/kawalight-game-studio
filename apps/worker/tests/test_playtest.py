"""Playtest API tests (serve contract: docs/playtest.md).

Exercises the real route handlers through ``server.dispatch`` (no sockets),
mirroring test_api_ops.py. Staging uses the real Phaser templates, so the
staged bytes are the REAL game (same ``stage_export`` as exports).
"""

import os
from datetime import datetime

import pytest

from kgsm import playtest as playtest_mod
from kgsm import projects as projects_mod
from kgsm.api import RawBody, Request, write_project_json
from kgsm.api.server import dispatch
from test_config_validator import make_config


def call(method, path, body=None):
    return dispatch(Request(method=method, path=path, body=body or {}))


def make_project_with_config(name="Playtest Demo", genre="space-shooter"):
    project = projects_mod.create(name, genre)
    write_project_json(project.dir, "config.json", make_config())
    return project


def stage(project):
    status, body = call("POST", f"/projects/{project.id}/playtest")
    assert status == 201, body
    return body


def staged_dir(project):
    return project.dir / "builds" / "playtest"


# --------------------------------------------------------------------------
# POST stage
# --------------------------------------------------------------------------

def test_stage_happy_path(store):
    project = make_project_with_config()
    status, body = call("POST", f"/projects/{project.id}/playtest")
    assert status == 201, body
    assert set(body) == {"url", "stagedAt"}
    assert body["url"] == f"/api/v1/projects/{project.id}/playtest/"
    assert datetime.fromisoformat(body["stagedAt"]).tzinfo is not None

    staged = staged_dir(project)
    for rel in ("index.html", "config.json", "kgsm-manifest.json",
                "js/game/main.js", "assets/player.png"):
        assert (staged / rel).is_file(), rel


def test_stage_missing_config_is_404(store):
    project = projects_mod.create("No Config", "space-shooter")
    status, body = call("POST", f"/projects/{project.id}/playtest")
    assert status == 404
    assert body["error"]["code"] == "config-not-found"


def test_playtest_unknown_project_is_404(store):
    status, body = call("POST", "/projects/nope/playtest")
    assert status == 404
    assert body["error"]["code"] == "project-not-found"
    status, body = call("GET", "/projects/nope/playtest/index.html")
    assert status == 404
    assert body["error"]["code"] == "project-not-found"


def test_stage_invalid_stored_config_is_export_error(store):
    project = make_project_with_config()
    bad = make_config()
    bad["victory"] = {"afterWave": 99}
    write_project_json(project.dir, "config.json", bad)
    status, body = call("POST", f"/projects/{project.id}/playtest")
    assert status == 502
    assert body["error"]["code"] == "export-error"


def test_rebuild_overwrites_cleanly(store):
    project = make_project_with_config()
    first = stage(project)
    assert first["stagedAt"]

    staged = staged_dir(project)
    stray = staged / "stale.txt"
    stray.write_text("yesterday", encoding="utf-8")
    assert stray.is_file()

    second = stage(project)
    assert second["stagedAt"]
    assert not stray.exists()
    assert (staged / "index.html").is_file()
    assert (staged / "kgsm-manifest.json").is_file()


# --------------------------------------------------------------------------
# GET serve
# --------------------------------------------------------------------------

def test_serve_root_returns_index(store):
    project = make_project_with_config()
    stage(project)
    status, body = call("GET", f"/projects/{project.id}/playtest")
    assert status == 200, body
    assert isinstance(body, RawBody)
    assert body.content_type == "text/html; charset=utf-8"
    assert body.data == (staged_dir(project) / "index.html").read_bytes()
    assert b"<html" in body.data.lower()


def test_serve_root_trailing_slash_returns_index(store):
    project = make_project_with_config()
    stage(project)
    status, body = call("GET", f"/projects/{project.id}/playtest/")
    assert status == 200, body
    assert isinstance(body, RawBody)
    assert body.data == (staged_dir(project) / "index.html").read_bytes()


def test_serve_before_stage_is_404(store):
    project = make_project_with_config()
    status, body = call("GET", f"/projects/{project.id}/playtest")
    assert status == 404
    assert body["error"]["code"] == "playtest-not-found"
    status, body = call("GET", f"/projects/{project.id}/playtest/index.html")
    assert status == 404
    assert body["error"]["code"] == "playtest-not-found"


def test_serve_missing_file_is_404(store):
    project = make_project_with_config()
    stage(project)
    status, body = call("GET", f"/projects/{project.id}/playtest/nope.js")
    assert status == 404
    assert body["error"]["code"] == "playtest-not-found"


def test_serve_directory_is_404(store):
    project = make_project_with_config()
    stage(project)
    for rel in ("assets", "js", "js/game"):
        status, body = call("GET", f"/projects/{project.id}/playtest/{rel}")
        assert status == 404, rel
        assert body["error"]["code"] == "playtest-not-found"


@pytest.mark.parametrize("rel", [
    "..",
    "../config.json",
    "a/../../config.json",
    "%2e%2e/config.json",   # encoded ..
    "%2E%2E%2Fconfig.json",  # encoded ../
    "/etc/passwd",           # absolute (double slash after playtest/)
    "C:/Windows/win.ini",    # drive-absolute
    "..\\config.json",       # backslash smuggling
    "js\\game\\main.js",
    "./index.html",
    "js/./game/main.js",
    "js//game/main.js",
])
def test_escape_attempts_are_404(store, rel):
    project = make_project_with_config()
    stage(project)
    status, body = call("GET", f"/projects/{project.id}/playtest/{rel}")
    assert status == 404, rel
    assert body["error"]["code"] == "playtest-not-found"


def test_symlink_escape_is_404(store):
    project = make_project_with_config()
    stage(project)
    staged = staged_dir(project)
    outside = staged / "evil-outside.json"
    inside = staged / "evil-inside.html"
    try:
        os.symlink(project.dir / "config.json", outside)
        os.symlink(staged / "index.html", inside)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks need privileges on this Windows box")
    # Even an inside-pointing symlink is rejected: staged tree is
    # symlink-free by rule, not just containment-checked.
    for rel in ("evil-outside.json", "evil-inside.html"):
        status, body = call("GET", f"/projects/{project.id}/playtest/{rel}")
        assert status == 404, rel
        assert body["error"]["code"] == "playtest-not-found"


def test_junction_escape_is_404(store, tmp_path):
    # Directory junctions need no privilege to create and are invisible
    # to islink(); the resolve()+containment check must still block them.
    if os.name != "nt":
        pytest.skip("junctions are Windows-only")
    project = make_project_with_config()
    stage(project)
    staged = staged_dir(project)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("TOP SECRET", encoding="utf-8")
    link = staged / "junc"
    import subprocess

    made = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(outside)],
        capture_output=True, text=True)
    if made.returncode != 0:
        pytest.skip("could not create a junction here")
    try:
        status, body = call(
            "GET", f"/projects/{project.id}/playtest/junc/secret.txt")
        assert status == 404
        assert body["error"]["code"] == "playtest-not-found"
    finally:
        os.rmdir(link)  # removes the link only, never the target


def test_mime_types_over_dispatch(store):
    project = make_project_with_config()
    stage(project)
    staged = staged_dir(project)
    # The real template stages no .css today; plant one to pin the serve
    # path's mapping for stylesheets.
    (staged / "style.css").write_text("body{margin:0}", encoding="utf-8")

    cases = [
        ("index.html", "text/html; charset=utf-8"),
        ("js/game/main.js", "text/javascript; charset=utf-8"),
        ("style.css", "text/css; charset=utf-8"),
        ("assets/player.png", "image/png"),
        ("config.json", "application/json; charset=utf-8"),
    ]
    for rel, mime in cases:
        status, body = call("GET", f"/projects/{project.id}/playtest/{rel}")
        assert status == 200, rel
        assert isinstance(body, RawBody), rel
        assert body.content_type == mime, rel
        assert body.data == (staged / rel).read_bytes(), rel


@pytest.mark.parametrize("filename,mime", [
    ("index.html", "text/html; charset=utf-8"),
    ("page.htm", "text/html; charset=utf-8"),
    ("game.js", "text/javascript; charset=utf-8"),
    ("bundle.mjs", "text/javascript; charset=utf-8"),
    ("style.css", "text/css; charset=utf-8"),
    ("config.json", "application/json; charset=utf-8"),
    ("game.js.map", "application/json; charset=utf-8"),
    ("notes.txt", "text/plain; charset=utf-8"),
    ("readme.md", "text/markdown; charset=utf-8"),
    ("sprite.svg", "image/svg+xml"),
    ("player.png", "image/png"),
    ("shot.jpg", "image/jpeg"),
    ("shot.jpeg", "image/jpeg"),
    ("boom.gif", "image/gif"),
    ("tile.webp", "image/webp"),
    ("favicon.ico", "image/x-icon"),
    ("laser.wav", "audio/wav"),
    ("theme.mp3", "audio/mpeg"),
    ("drone.ogg", "audio/ogg"),
    ("cutscene.mp4", "video/mp4"),
    ("cutscene.webm", "video/webm"),
    ("hud.woff", "font/woff"),
    ("hud.woff2", "font/woff2"),
    ("hud.ttf", "font/ttf"),
    ("engine.wasm", "application/wasm"),
    ("SHOUTY.PNG", "image/png"),
    ("no-extension", "application/octet-stream"),
    ("weird.xyz", "application/octet-stream"),
])
def test_mime_table(filename, mime):
    assert playtest_mod.content_type_for(filename) == mime


def test_routes_registered_on_server():
    from kgsm.api import server

    patterns = {(method, rx.pattern) for method, rx, _ in server.ROUTES}
    assert ("POST", r"/projects/(?P<id>[^/]+)/playtest") in patterns
    assert ("GET", r"/projects/(?P<id>[^/]+)/playtest/?") in patterns
    assert ("GET", r"/projects/(?P<id>[^/]+)/playtest/(?P<path>.+)") \
        in patterns


def test_staged_root_symlink_is_404(store, tmp_path):
    project = make_project_with_config()
    stage(project)
    staged = staged_dir(project)
    real = tmp_path / "real-playtest"
    staged.rename(real)
    try:
        os.symlink(real, staged, target_is_directory=True)
    except (OSError, NotImplementedError):
        real.rename(staged)
        pytest.skip("symlinks need privileges on this Windows box")
    try:
        status, body = call(
            "GET", f"/projects/{project.id}/playtest/index.html")
        assert status == 404
        assert body["error"]["code"] == "playtest-not-found"
    finally:
        staged.unlink()  # removes the link only, never the target
        real.rename(staged)


@pytest.mark.parametrize("rel", [
    "a\x00b.html",      # raw NUL byte
    "a%00b.html",       # percent-encoded NUL (no such file either way)
    "%00",
])
def test_nul_paths_are_404(store, rel):
    project = make_project_with_config()
    stage(project)
    status, body = call("GET", f"/projects/{project.id}/playtest/{rel}")
    assert status == 404, rel
    assert body["error"]["code"] == "playtest-not-found"


def test_stage_with_secret_in_tree_is_export_error(store):
    from kgsm import secrets as secrets_mod

    secrets_mod.set_secret("k", "[PLAYTEST_LEAK_MARKER_7d2c]")
    project = make_project_with_config()
    assets = project.dir / "assets"
    assets.mkdir(exist_ok=True)
    (assets / "leak.txt").write_text(
        "prefix [PLAYTEST_LEAK_MARKER_7d2c] suffix", encoding="utf-8")
    status, body = call("POST", f"/projects/{project.id}/playtest")
    assert status == 502
    assert body["error"]["code"] == "export-error"
