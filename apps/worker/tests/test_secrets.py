"""Credential store tests (FR-008, NFR-002)."""

from kgsm import secrets


def test_secret_roundtrip(store):
    assert secrets.get_secret("openai") is None
    secrets.set_secret("openai", "sk-test-123")
    assert secrets.get_secret("openai") == "sk-test-123"
    assert secrets.delete_secret("openai") is True
    assert secrets.get_secret("openai") is None
    assert secrets.delete_secret("openai") is False


def test_list_names_never_returns_values(store):
    secrets.set_secret("openai", "sk-test-123")
    names = secrets.list_secret_names()
    assert names == ["openai"]
    assert "sk-test-123" not in str(names)


def test_redact_masks_values(store):
    secrets.set_secret("openai", "sk-test-123")
    assert secrets.redact("key=sk-test-123 ok") == "key=*** ok"
    assert secrets.redact("nothing here") == "nothing here"
