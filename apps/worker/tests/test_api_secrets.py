"""Secrets API tests (contract §10; FR-008, NFR-002).

Exercises the real route handlers through ``server.dispatch`` (no sockets),
mirroring test_api_ops.py.
"""

from kgsm import secrets as secrets_mod
from kgsm.api import Request
from kgsm.api.server import dispatch


def call(method, path, body=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query={}))


def test_put_list_delete_roundtrip(store):
    status, body = call("PUT", "/secrets/openai-key", {"value": "sk-test"})
    assert status == 200, body
    assert body == {"name": "openai-key", "stored": True}

    status, body = call("PUT", "/secrets/other", {"value": "v2"})
    assert status == 200, body

    status, body = call("GET", "/secrets")
    assert status == 200, body
    assert body == {"names": ["openai-key", "other"]}
    assert "sk-test" not in repr(body)

    status, body = call("DELETE", "/secrets/openai-key")
    assert status == 200, body
    assert body == {"name": "openai-key", "deleted": True}

    status, body = call("DELETE", "/secrets/openai-key")
    assert status == 200, body
    assert body["deleted"] is False

    status, body = call("GET", "/secrets")
    assert status == 200, body
    assert body == {"names": ["other"]}


def test_put_rejects_bad_value(store):
    status, body = call("PUT", "/secrets/k", {})
    assert status == 400
    assert body["error"]["code"] == "bad-request"

    status, body = call("PUT", "/secrets/k", {"value": ""})
    assert status == 400

    status, body = call("PUT", "/secrets/k", {"value": 42})
    assert status == 400


def test_values_never_listed(store):
    secrets_mod.set_secret("hidden", "super-secret-value")
    status, body = call("GET", "/secrets")
    assert status == 200, body
    assert body == {"names": ["hidden"]}
