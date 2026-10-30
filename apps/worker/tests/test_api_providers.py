"""Provider API tests (contract §5 + §4/§6 integration for openai-compat).

Exercises the real route handlers through ``server.dispatch`` (no sockets),
with the OpenAI-compatible HTTP hop mocked (no network).
"""

import pytest

from kgsm import projects as projects_mod
from kgsm import secrets as secrets_mod
from kgsm.api import Request
from kgsm.api.server import dispatch
from test_openai_provider import (
    TEST_KEY,
    b64_images_body,
    install_fake,
    make_png_bytes,
)


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


def make_project_id():
    return projects_mod.create("Provider Demo", "space-shooter").id


# --------------------------------------------------------------------------
# §5 providers
# --------------------------------------------------------------------------

def test_providers_list_shape(store):
    status, body = call("GET", "/providers")
    assert status == 200, body
    assert set(body) == {"providers"}
    by_id = {p["id"]: p for p in body["providers"]}
    assert "mock" in by_id and "openai-compat" in by_id
    for provider in body["providers"]:
        assert set(provider) == {"id", "displayName", "model"}
    assert by_id["openai-compat"]["model"] == "gpt-image-1"


# --------------------------------------------------------------------------
# §4+§6 integration: openai-compat through the generate-via-quote flow
# --------------------------------------------------------------------------

def _generate_payload(**overrides):
    payload = {"providerId": "openai-compat", "prompt": "a hero ship",
               "style": "pixel-art", "width": 32, "height": 32,
               "entity": "player", "role": "ship"}
    payload.update(overrides)
    return payload


def test_generate_unknown_cost_needs_confirmation(store):
    pid = make_project_id()
    status, body = call("POST", f"/projects/{pid}/assets/generate",
                        _generate_payload())
    assert status == 409, body
    assert body["error"]["code"] == "needs-confirmation"
    assert body["quote"]["cents"] is None
    assert body["quote"]["providerId"] == "openai-compat"


def test_generate_without_key_fails_clean(store):
    pid = make_project_id()
    status, body = call("POST", f"/projects/{pid}/assets/generate",
                        _generate_payload(confirmed=True))
    assert status == 502, body
    assert body["error"]["code"] == "provider-error"
    assert "API key" in body["error"]["message"]
    # NFR-003: failure writes nothing -- no assets, no spend.
    status, body = call("GET", f"/projects/{pid}/assets")
    assert status == 200 and body["assets"] == []
    status, body = call("GET", "/costs/ledger")
    assert status == 200 and body["entries"] == []


def test_generate_success_saves_provenance_and_history(store, monkeypatch):
    secrets_mod.set_secret("openai_compat_api_key", TEST_KEY)
    png = make_png_bytes(8, 8)
    captured = install_fake(
        monkeypatch, lambda req: _fake_response(b64_images_body(png)))
    pid = make_project_id()
    status, body = call("POST", f"/projects/{pid}/assets/generate",
                        _generate_payload(confirmed=True))
    assert status == 201, body
    assert len(captured) == 1
    assert body["quote"]["providerId"] == "openai-compat"
    assert body["spentCents"] == 0  # unknown cost records 0 actual
    (asset,) = body["assets"]
    assert asset["path"].startswith("assets/player/")
    assert asset["meta"]["source"] == "generated"
    assert asset["meta"]["provider"] == "openai-compat"
    assert asset["meta"]["model"] == "gpt-image-1"
    assert asset["meta"]["prompt"] == "a hero ship"
    # Generation history passthrough: the saved asset is listed with meta.
    status, body = call("GET", f"/projects/{pid}/assets")
    assert status == 200
    assert [a["path"] for a in body["assets"]] == [asset["path"]]
    assert body["assets"][0]["meta"]["provider"] == "openai-compat"
    status, body = call("GET", "/costs/ledger")
    assert status == 200 and len(body["entries"]) == 1


def _fake_response(payload: bytes):
    from test_openai_provider import FakeResponse

    return FakeResponse(payload)
