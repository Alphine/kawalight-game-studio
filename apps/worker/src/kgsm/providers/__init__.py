"""Provider adapters (SDD FR-006/FR-007)."""

from .base import (
    GeneratedImage,
    ImageProvider,
    ProviderError,
    TextProvider,
)
from .mock import FailingProvider, MockProvider
from .registry import (
    get_provider,
    get_text_provider,
    list_providers,
    list_text_providers,
    register_provider,
    unregister_provider,
)

__all__ = [
    "FailingProvider",
    "GeneratedImage",
    "ImageProvider",
    "MockProvider",
    "ProviderError",
    "TextProvider",
    "get_provider",
    "get_text_provider",
    "list_providers",
    "list_text_providers",
    "register_provider",
    "unregister_provider",
]
