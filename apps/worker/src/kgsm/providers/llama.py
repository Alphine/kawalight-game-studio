"""Meta/Llama-compatible provider preset (FR-006/FR-007).

One bring-your-own-key preset covering both generation modalities through
OpenAI-compatible endpoints that host Llama (and companion image models):

- :class:`LlamaTextProvider` (``llama-text``) posts
  ``POST {base_url}/chat/completions`` for story/text generation. It lives
  in the main registry and answers the story layer's duck-typed
  ``generate_text(prompt, genre=...)`` call, so ``POST /stories/generate``
  with ``providerId: "llama-text"`` works with no other wiring.
- :class:`LlamaImageProvider` (``llama-image``) subclasses
  :class:`kgsm.providers.openai_compat.OpenAICompatProvider`, so image
  generation reuses that machinery line-for-line with Llama-ecosystem
  secret names and defaults.

``LLAMA_PRESETS`` documents ready-to-copy settings per host (Groq, Together
AI, OpenRouter, Hugging Face). Configuration lives in :mod:`kgsm.secrets`
exactly like ``openai-compat`` -- key + base URL are shared by both
modalities, each modality has its own model secret -- resolved lazily on
every call. Secrets stay in the local store (NFR-002): they are never
logged, never returned by any API, and never included in errors.
HTTP uses stdlib ``urllib`` only.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .. import secrets as secrets_mod
from ._http import (
    decode_json,
    post_json,
    require_api_key,
    validate_base_url,
    validate_timeout,
)
from .base import ImageProvider, ProviderError, TextProvider
from .openai_compat import OpenAICompatProvider

SECRET_API_KEY = "llama_api_key"
SECRET_BASE_URL = "llama_base_url"
SECRET_TEXT_MODEL = "llama_text_model"
SECRET_IMAGE_MODEL = "llama_image_model"
SECRET_IMAGE_PRICE_CENTS = "llama_price_cents_per_image"

DEFAULT_BASE_URL = "https://api.together.xyz/v1"
DEFAULT_TEXT_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo"
DEFAULT_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell"
DEFAULT_TIMEOUT_S = 120
DEFAULT_MAX_TOKENS = 512
MAX_MAX_TOKENS = 8192
DEFAULT_TEMPERATURE = 0.7
MIN_TEMPERATURE = 0.0
MAX_TEMPERATURE = 2.0

LLAMA_PRESETS: dict[str, dict[str, object]] = {
    "together": {
        "display_name": "Together AI",
        "key_url": "https://api.together.xyz/settings/api-keys",
        "base_url": "https://api.together.xyz/v1",
        "text_model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "image_model": "black-forest-labs/FLUX.1-schnell",
        "notes": "Text + images on one key (also the preset defaults).",
    },
    "groq": {
        "display_name": "Groq",
        "key_url": "https://console.groq.com/keys",
        "base_url": "https://api.groq.com/openai/v1",
        "text_model": "llama-3.3-70b-versatile",
        "image_model": None,
        "notes": "Text only: Groq has no images endpoint, so llama-image "
        "calls fail there. Use Together for images.",
    },
    "openrouter": {
        "display_name": "OpenRouter",
        "key_url": "https://openrouter.ai/keys",
        "base_url": "https://openrouter.ai/api/v1",
        "text_model": "meta-llama/llama-3.3-70b-instruct",
        "image_model": None,
        "notes": "Text via chat completions. OpenRouter serves images "
        "through a different chat-modality API this adapter does not "
        "speak -- use Together for images.",
    },
    "huggingface": {
        "display_name": "Hugging Face",
        "key_url": "https://huggingface.co/settings/tokens",
        "base_url": "https://router.huggingface.co/v1",
        "text_model": "meta-llama/Llama-3.3-70B-Instruct",
        "image_model": None,
        "notes": "Text only, via the Inference Providers OpenAI-compatible "
        "route. Gated Llama models need license acceptance plus a token "
        "with Inference permission.",
    },
}


def get_preset(name: str) -> dict[str, object]:
    """Return a copy of the named host preset (see ``LLAMA_PRESETS``)."""
    try:
        return dict(LLAMA_PRESETS[name])
    except KeyError:
        known = ", ".join(sorted(LLAMA_PRESETS))
        raise ValueError(
            f"unknown llama preset {name!r} (known: {known})"
        ) from None


class LlamaImageProvider(OpenAICompatProvider):
    """Llama-preset image adapter: all HTTP is inherited, nothing copied.

    Only the identity, secret names, and defaults differ from
    ``openai-compat``; request shape, parsing, validation, SSRF guards,
    cost behavior, and error mapping are exactly the parent's.
    """

    id = "llama-image"
    display_name = "Meta Llama images (BYOK)"

    secret_api_key = SECRET_API_KEY
    secret_base_url = SECRET_BASE_URL
    secret_model = SECRET_IMAGE_MODEL
    secret_price_cents = SECRET_IMAGE_PRICE_CENTS
    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_IMAGE_MODEL


class LlamaTextProvider(ImageProvider, TextProvider):
    """TextProvider backed by an OpenAI-compatible chat endpoint.

    Resolution order for every setting is: explicit constructor argument,
    then :mod:`kgsm.secrets`, then the documented default. The API key has
    no default -- generation without one raises :class:`ProviderError`.

    It also satisfies ``ImageProvider`` structurally so it can live in the
    main registry (which the story route resolves through): ``estimate``
    is honestly unknown and image ``generate`` fails cleanly as a
    ProviderError instead of crashing with AttributeError.
    """

    id = "llama-text"
    display_name = "Meta Llama text (BYOK)"

    secret_api_key = SECRET_API_KEY
    secret_base_url = SECRET_BASE_URL
    secret_model = SECRET_TEXT_MODEL
    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_TEXT_MODEL

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._model_override = (model or "").strip() or None
        self._base_url_override = (base_url or "").strip() or None
        self._api_key_override = api_key or None
        self._timeout_s = validate_timeout(timeout_s, DEFAULT_TIMEOUT_S)
        self.calls: list[dict] = []

    @property
    def model(self) -> str:  # noqa: D102 (TextProvider contract attr)
        if self._model_override:
            return self._model_override
        configured = (secrets_mod.get_secret(self.secret_model) or "").strip()
        return configured or self.default_model

    def _base_url(self) -> str:
        if self._base_url_override:
            return self._base_url_override
        configured = (secrets_mod.get_secret(self.secret_base_url) or "").strip()
        return configured or self.default_base_url

    def _api_key(self) -> str | None:
        if self._api_key_override:
            return self._api_key_override
        return secrets_mod.get_secret(self.secret_api_key) or None

    # -- ImageProvider (structural: text-only, fails clean) ------------

    def estimate_cents(self, n_images: int) -> int | None:
        """Text cost is unquoted: always None (confirmation mandatory)."""
        return None

    def generate(
        self, prompt: str, *, style: str, width: int, height: int,
        seed: int | None = None, n_images: int = 1,
    ):
        raise ProviderError(
            f"{self.id}: text-only provider (no image generation)"
        )

    # -- TextProvider --------------------------------------------------

    def generate_text(
        self, prompt: str, genre: str | None = None, *,
        system: str | None = None, max_tokens: int = DEFAULT_MAX_TOKENS,
        temperature: float = DEFAULT_TEMPERATURE,
    ) -> dict[str, object]:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ProviderError("prompt must not be empty")
        if genre is not None and not isinstance(genre, str):
            raise ProviderError("genre must be a string")
        if system is not None and not isinstance(system, str):
            raise ProviderError("system must be a string")
        if (
            isinstance(max_tokens, bool)
            or not isinstance(max_tokens, int)
            or max_tokens < 1
            or max_tokens > MAX_MAX_TOKENS
        ):
            raise ProviderError(
                f"max_tokens must be an integer 1..{MAX_MAX_TOKENS}"
            )
        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or not MIN_TEMPERATURE <= temperature <= MAX_TEMPERATURE
        ):
            raise ProviderError(
                "temperature must be a number "
                f"{MIN_TEMPERATURE}..{MAX_TEMPERATURE}"
            )
        api_key = require_api_key(self._api_key(), self.id, self.secret_api_key)
        base_url = self._base_url()
        validate_base_url(base_url, self.id)

        model = self.model
        effective_system = system.strip() if system and system.strip() else None
        if effective_system is None and genre and genre.strip():
            effective_system = (
                f"You are writing a {genre.strip()} game story."
            )
        messages = []
        if effective_system:
            messages.append({"role": "system",
                             "content": effective_system})
        messages.append({"role": "user", "content": prompt.strip()})
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        url = base_url.rstrip("/") + "/chat/completions"
        self.calls.append({
            "prompt": prompt.strip(),
            "genre": genre.strip() if genre and genre.strip() else None,
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "at": datetime.now(timezone.utc).isoformat(),
        })

        raw = post_json(url, payload, api_key=api_key,
                        timeout_s=self._timeout_s, provider_id=self.id,
                        what="chat request")
        obj = decode_json(raw, self.id)
        if not isinstance(obj, dict) or not obj.get("choices"):
            raise ProviderError(f"{self.id}: response has no 'choices'")
        choices = obj["choices"]
        if not isinstance(choices, list) or not choices:
            raise ProviderError(f"{self.id}: response has no 'choices'")
        first = choices[0]
        if not isinstance(first, dict):
            raise ProviderError(f"{self.id}: choice 0 is not an object")
        message = first.get("message")
        if not isinstance(message, dict):
            raise ProviderError(f"{self.id}: choice 0 has no message")
        text = _content_text(message.get("content"))
        if text is None or not text.strip():
            raise ProviderError(f"{self.id}: choice 0 has no message content")
        return {"text": text, "usage": {"model": model}}


def _content_text(content: object) -> str | None:
    """Extract assistant text from a chat ``message.content`` value.

    Strict OpenAI-compatible servers return a string; some gateways return
    a list of ``{"type": "text", "text": ...}`` blocks instead. Anything
    else yields None (caller raises).
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part["text"] for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ]
        if parts:
            return "".join(parts)
    return None
