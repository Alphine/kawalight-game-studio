"""Provider registry: swappable adapters behind one interface (FR-007).

Builtin adapters (mock + OpenAI-compatible) register lazily on first use so
importing this module stays side-effect free and optional adapters can never
break the mock default.
"""

from __future__ import annotations

from .base import ImageProvider, ProviderError

_PROVIDERS: dict[str, ImageProvider] = {}


def register_provider(provider: ImageProvider) -> None:
    _PROVIDERS[provider.id] = provider


def _ensure_builtins() -> None:
    if "mock" not in _PROVIDERS:
        from .mock import MockProvider

        _PROVIDERS["mock"] = MockProvider()
    if "openai-compat" not in _PROVIDERS:
        try:
            from .openai_compat import OpenAICompatProvider
        except ImportError:
            return  # adapter module absent; mock default still stands
        _PROVIDERS["openai-compat"] = OpenAICompatProvider()


def get_provider(provider_id: str) -> ImageProvider:
    _ensure_builtins()
    try:
        return _PROVIDERS[provider_id]
    except KeyError:
        raise ProviderError(f"unknown provider {provider_id!r}") from None


def list_providers() -> list[dict]:
    _ensure_builtins()
    return [
        {"id": p.id, "displayName": p.display_name, "model": p.model}
        for p in _PROVIDERS.values()
    ]
