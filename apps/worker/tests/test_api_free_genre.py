"""Free-genre (customGenre) API tests.

A project may carry a free-text ``customGenre`` alongside a preset base genre
(the mechanic template). It is stored with the project, returned by the API
only when set, and used as theme context for Muse story and asset prompts.

Dispatch-based like test_api_genres.py, so no sockets are needed.
"""

import json

import pytest

from kgsm import projects as projects_mod
from kgsm import story as story_mod
from kgsm.api import Request, routes_assets, routes_story
from kgsm.api.server import dispatch


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


def test_create_stores_and_returns_custom_genre(store):
    status, body = call("POST", "/projects",
                        {"name": "Cat Towers", "genre": "puzzle-match",
                         "customGenre": "  tower defense with cats  "})
    assert status == 201
    assert body["genre"] == "puzzle-match"
    assert body["customGenre"] == "tower defense with cats"

    status, fetched = call("GET", f"/projects/{body['id']}")
    assert status == 200 and fetched["customGenre"] == "tower defense with cats"

    stored = projects_mod.get(body["id"])
    assert stored.custom_genre == "tower defense with cats"

    record = json.loads((stored.dir / "project.json").read_text(encoding="utf-8"))
    assert record["customGenre"] == "tower defense with cats"


def test_preset_project_has_no_custom_genre_key(store):
    status, body = call("POST", "/projects",
                        {"name": "Plain", "genre": "farming"})
    assert status == 201
    assert "customGenre" not in body
    record = json.loads(
        (projects_mod.get(body["id"]).dir / "project.json").read_text(encoding="utf-8"))
    assert "customGenre" not in record


def test_blank_custom_genre_means_none(store):
    status, body = call("POST", "/projects",
                        {"name": "Blank", "genre": "farming",
                         "customGenre": "   "})
    assert status == 201
    assert "customGenre" not in body


def test_custom_genre_accepts_max_length(store):
    text = "x" * projects_mod.MAX_CUSTOM_GENRE_CHARS
    status, body = call("POST", "/projects",
                        {"name": "Max", "genre": "battle-2d",
                         "customGenre": text})
    assert status == 201 and body["customGenre"] == text


@pytest.mark.parametrize("bad", [
    123,                                   # not a string
    ["cats"],                              # not a string
    "x" * (projects_mod.MAX_CUSTOM_GENRE_CHARS + 1),  # oversize
    "cats\nwith hats",                     # newline (control char)
    "cats\x00",                            # NUL byte
    "cats\x7f",                            # DEL
    "cats\tmice",                          # tab (control char)
])
def test_custom_genre_rejects_unsafe_or_oversize(store, bad):
    status, body = call("POST", "/projects",
                        {"name": "Bad", "genre": "side-scroller",
                         "customGenre": bad})
    assert status == 400
    assert body["error"]["code"] == "bad-request"
    assert projects_mod.list_projects() == []


def test_custom_genre_survives_rename_and_duplicate(store):
    _, body = call("POST", "/projects",
                   {"name": "Orig", "genre": "endless-runner",
                    "customGenre": "visual novel mystery"})
    pid = body["id"]

    status, renamed = call("PATCH", f"/projects/{pid}", {"name": "Renamed"})
    assert status == 200 and renamed["customGenre"] == "visual novel mystery"

    status, copy = call("POST", f"/projects/{pid}/duplicate",
                        {"name": "Copy"})
    assert status == 201 and copy["customGenre"] == "visual novel mystery"


def test_story_uses_custom_genre_as_context(store, monkeypatch):
    _, body = call("POST", "/projects",
                   {"name": "Story", "genre": "farming",
                    "customGenre": "cozy cat cafe"})
    seen = {}

    def fake_generate_text(provider, prompt, genre=None):
        seen["genre"] = genre
        return "text", {}

    monkeypatch.setattr(story_mod, "generate_text", fake_generate_text)
    status, _ = call("POST", "/stories/generate",
                     {"providerId": "mock", "prompt": "a tale",
                      "projectId": body["id"]})
    assert status == 201
    assert seen["genre"] == "cozy cat cafe"


def test_story_explicit_genre_wins_over_custom_genre(store, monkeypatch):
    _, body = call("POST", "/projects",
                   {"name": "Story2", "genre": "farming",
                    "customGenre": "cozy cat cafe"})
    seen = {}

    def fake_generate_text(provider, prompt, genre=None):
        seen["genre"] = genre
        return "text", {}

    monkeypatch.setattr(story_mod, "generate_text", fake_generate_text)
    status, _ = call("POST", "/stories/generate",
                     {"providerId": "mock", "prompt": "a tale",
                      "projectId": body["id"], "genre": "fairy"})
    assert status == 201
    assert seen["genre"] == "fairy"


class _RecordingProvider:
    def __init__(self, sink):
        self.sink = sink

    def generate(self, prompt, **kwargs):
        self.sink.append(prompt)
        return []


def _asset_body(pid, prompt):
    return {"providerId": "mock", "prompt": prompt, "style": "pixel-art",
            "width": 64, "height": 64, "entity": "hero", "role": "idle",
            "projectId": pid}


def test_asset_prompt_gets_custom_genre_context(store, monkeypatch):
    _, body = call("POST", "/projects",
                   {"name": "Art", "genre": "space-shooter",
                    "customGenre": "neon tower defense"})
    sent = []
    monkeypatch.setattr(routes_assets, "get_provider",
                        lambda pid: _RecordingProvider(sent))
    status, _ = call("POST", f"/projects/{body['id']}/assets/generate",
                     _asset_body(body["id"], "a laser cat"))
    assert status == 201
    assert sent == ["a laser cat\n\nGenre: neon tower defense"]


def test_asset_prompt_unchanged_without_custom_genre(store, monkeypatch):
    _, body = call("POST", "/projects",
                   {"name": "Art2", "genre": "space-shooter"})
    sent = []
    monkeypatch.setattr(routes_assets, "get_provider",
                        lambda pid: _RecordingProvider(sent))
    status, _ = call("POST", f"/projects/{body['id']}/assets/generate",
                     _asset_body(body["id"], "a laser cat"))
    assert status == 201
    assert sent == ["a laser cat"]


def test_normalize_custom_genre_direct():
    assert projects_mod.normalize_custom_genre(None) == ""
    assert projects_mod.normalize_custom_genre("  ok  ") == "ok"
    with pytest.raises(projects_mod.ProjectError):
        projects_mod.normalize_custom_genre("bad\nline")
    with pytest.raises(projects_mod.ProjectError):
        projects_mod.normalize_custom_genre(5)
