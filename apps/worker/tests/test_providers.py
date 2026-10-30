"""Provider registry + mock adapter tests (FR-006/FR-007, NFR-003)."""

import pytest

from kgsm.providers import (
    FailingProvider,
    MockProvider,
    ProviderError,
    get_provider,
    list_providers,
)


def test_mock_is_registered_by_default():
    ids = {p["id"] for p in list_providers()}
    assert "mock" in ids
    assert isinstance(get_provider("mock"), MockProvider)


def test_unknown_provider_raises():
    with pytest.raises(ProviderError):
        get_provider("nope")


def test_mock_generates_deterministic_png():
    provider = MockProvider()
    a = provider.generate("ship", style="pixel-art", width=32, height=32, seed=7)[0]
    b = provider.generate("ship", style="pixel-art", width=32, height=32, seed=7)[0]
    assert a.png_bytes == b.png_bytes
    assert a.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    assert (a.width, a.height) == (32, 32)
    c = provider.generate("ship", style="pixel-art", width=32, height=32, seed=8)[0]
    assert c.png_bytes != a.png_bytes


def test_mock_is_free_and_validates_input():
    provider = MockProvider()
    assert provider.estimate_cents(4) == 0
    with pytest.raises(ProviderError):
        provider.generate("  ", style="pixel-art", width=32, height=32)
    with pytest.raises(ProviderError):
        provider.generate("x", style="pixel-art", width=32, height=32, n_images=99)


def test_failing_provider_raises_without_side_effects(store):
    provider = FailingProvider()
    assert provider.estimate_cents(1) is None
    with pytest.raises(ProviderError):
        provider.generate("ship", style="pixel-art", width=32, height=32)
    # NFR-003: a provider failure writes nothing into project storage.
    assert not store["projects_dir"].exists()
