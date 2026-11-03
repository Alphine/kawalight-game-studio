"""Meta AI (Muse) providers: the default story and image backends.

Meta's developer API is OpenAI-compatible at ``https://api.meta.ai/v1``
and serves Muse text models (``muse-spark-*``) plus ``muse-image-*``.
Both adapters reuse the Llama BYOK machinery line-for-line: the request
shape, SSRF guards, cost behaviour and error mapping are the parents'.
Only identity, secret names and defaults differ, so the Meta key is a
separate secret from any Llama/Together key.

- :class:`MetaTextProvider` (``meta-text``) answers story generation.
- :class:`MetaImageProvider` (``meta-image``) answers asset generation.
"""

from __future__ import annotations

from .llama import LlamaImageProvider, LlamaTextProvider

SECRET_API_KEY = "meta_api_key"
SECRET_BASE_URL = "meta_base_url"
SECRET_TEXT_MODEL = "meta_text_model"
SECRET_IMAGE_MODEL = "meta_image_model"
SECRET_IMAGE_PRICE_CENTS = "meta_price_cents_per_image"

DEFAULT_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_TEXT_MODEL = "muse-spark-1.3"
DEFAULT_IMAGE_MODEL = "muse-image-1.0"


class MetaTextProvider(LlamaTextProvider):
    """Muse text model for story generation (``providerId: meta-text``)."""

    id = "meta-text"
    display_name = "Meta AI text (Muse, default)"

    secret_api_key = SECRET_API_KEY
    secret_base_url = SECRET_BASE_URL
    secret_model = SECRET_TEXT_MODEL
    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_TEXT_MODEL
    # muse-spark-1.3 is a reasoning model: at default effort it can spend the
    # whole max_tokens budget on hidden reasoning and return empty content.
    # "minimal" is the lowest level the API accepts for this model.
    extra_payload = {"reasoning_effort": "minimal"}


class MetaImageProvider(LlamaImageProvider):
    """Muse image model for asset generation (``providerId: meta-image``)."""

    id = "meta-image"
    display_name = "Meta AI images (Muse, default)"

    secret_api_key = SECRET_API_KEY
    secret_base_url = SECRET_BASE_URL
    secret_model = SECRET_IMAGE_MODEL
    secret_price_cents = SECRET_IMAGE_PRICE_CENTS
    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_IMAGE_MODEL
