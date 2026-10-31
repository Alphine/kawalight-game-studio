"""Provider interface. Real adapters (DALL-E, etc.) implement ImageProvider."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class GeneratedImage:
    png_bytes: bytes
    width: int
    height: int
    model: str
    seed: int | None = None


class ImageProvider(ABC):
    """Contract every image provider adapter must satisfy (FR-007)."""

    id: str = "base"
    display_name: str = "base"
    model: str = "unknown"

    @abstractmethod
    def estimate_cents(self, n_images: int) -> int | None:
        """Return cost in cents, or None when the cost is unknown."""

    @abstractmethod
    def generate(
        self, prompt: str, *, style: str, width: int, height: int,
        seed: int | None = None, n_images: int = 1,
    ) -> list[GeneratedImage]:
        """Generate images. Must raise ProviderError (not crash) on failure."""


class TextProvider(ABC):
    """Contract every text/story provider adapter must satisfy.

    Mirrors ImageProvider for OpenAI-compatible ``chat/completions``
    endpoints (Llama hosts such as Groq, Together, OpenRouter). The story
    layer (``kgsm.story``) dispatches duck-typed -- ``generate_text(prompt,
    genre=...)`` on any registered provider -- so text adapters live in the
    main registry and return the dict shape ``story`` coerces.
    """

    id: str = "base-text"
    display_name: str = "base-text"
    model: str = "unknown"

    @abstractmethod
    def generate_text(
        self, prompt: str, genre: str | None = None, *,
        system: str | None = None, max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> dict[str, object]:
        """Generate text for the story layer.

        Returns ``{"text": str, "usage": dict}`` with non-blank ``text``
        and JSON-scalar ``usage`` values (the shape ``story`` coerces).
        Must raise ProviderError (not crash) on failure.
        """
