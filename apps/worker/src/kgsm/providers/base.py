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
