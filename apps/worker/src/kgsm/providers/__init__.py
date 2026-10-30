"""Provider adapters (SDD FR-006/FR-007)."""

from .base import GeneratedImage, ImageProvider, ProviderError
from .mock import FailingProvider, MockProvider
from .registry import get_provider, list_providers, register_provider

__all__ = [
    "FailingProvider",
    "GeneratedImage",
    "ImageProvider",
    "MockProvider",
    "ProviderError",
    "get_provider",
    "list_providers",
    "register_provider",
]
