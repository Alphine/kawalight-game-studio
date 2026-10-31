"""Provider registry: swappable adapters behind one interface (FR-007).

Builtin adapters (mock + OpenAI-compatible + the Llama text/image preset)
register lazily on first use so importing this module stays side-effect
free and optional adapters can never break the mock default.

There is exactly one registry: the story route resolves text backends
through :func:`get_provider` and dispatches duck-typed (any provider
exposing ``generate_text(prompt, genre=...)``). :func:`get_text_provider`
and :func:`list_text_providers` are capability-filtered views over that
same registry for text-oriented callers. ``mock`` offers no
``generate_text`` -- the story layer substitutes its offline placeholder
-- so it never appears in the text views.
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
    if "llama-image" not in _PROVIDERS or "llama-text" not in _PROVIDERS:
        try:
            from .llama import LlamaImageProvider, LlamaTextProvider
        except ImportError:
            return  # adapter module absent; other adapters still stand
        _PROVIDERS.setdefault("llama-image", LlamaImageProvider())
        _PROVIDERS.setdefault("llama-text", LlamaTextProvider())


def get_provider(provider_id: str) -> ImageProvider:
    _ensure_builtins()
    try:
        return _PROVIDERS[provider_id]
    except KeyError:
        raise ProviderError(f"unknown provider {provider_id!r}") from None


def _is_text_capable(provider: object) -> bool:
    return callable(getattr(provider, "generate_text", None))


def get_text_provider(provider_id: str) -> ImageProvider:
    """Return a text-capable provider from the main registry.

    Raises ProviderError when the id is unknown or the provider exposes
    no ``generate_text`` (mirrors the story layer's dispatch rule).
    """
    provider = get_provider(provider_id)
    if not _is_text_capable(provider):
        raise ProviderError(
            f"provider {provider_id!r} does not support text generation")
    return provider


def list_providers() -> list[dict]:
    _ensure_builtins()
    return [
        {"id": p.id, "displayName": p.display_name, "model": p.model}
        for p in _PROVIDERS.values()
    ]


def list_text_providers() -> list[dict]:
    """Contract-shaped entries for text-capable providers only."""
    _ensure_builtins()
    return [
        {"id": p.id, "displayName": p.display_name, "model": p.model}
        for p in _PROVIDERS.values()
        if _is_text_capable(p)
    ]
