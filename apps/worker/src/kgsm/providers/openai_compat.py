"""OpenAI-compatible image-generation adapter (FR-006).

Talks to any ``POST {base_url}/images/generations`` endpoint that follows the
OpenAI Images API shape (api.openai.com, local gateways, self-hosted
OpenAI-compatible servers). HTTP uses stdlib ``urllib`` only -- no third-party
SDK. Configuration comes from :mod:`kgsm.secrets` (see ``docs/providers.md``)
and is resolved lazily on every call, so keys can be rotated without a
worker restart. Secret values are never logged or included in errors.

The secret names and defaults are class attributes so provider presets
(such as the Meta/Llama preset in :mod:`kgsm.providers.llama`) can reuse
every line of this machinery by subclassing.
"""

from __future__ import annotations

import base64
import binascii
import io
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlsplit

from PIL import Image

from .. import secrets as secrets_mod
from ._http import (
    decode_json,
    ensure_redirect_guard,
    host_is_blocked,
    positive_int,
    post_json,
    require_api_key,
    validate_base_url,
    validate_timeout,
)
from .base import GeneratedImage, ImageProvider, ProviderError

SECRET_API_KEY = "openai_compat_api_key"
SECRET_BASE_URL = "openai_compat_base_url"
SECRET_MODEL = "openai_compat_model"
SECRET_PRICE_CENTS = "openai_compat_price_cents_per_image"

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-image-1"
DEFAULT_TIMEOUT_S = 120
MAX_IMAGE_SIDE = 4096
MAX_FETCH_BYTES = 25 * 1024 * 1024

_STYLE_SUFFIX = {
    "pixel-art": "pixel art",
    "illustrated-2d": "detailed 2D illustration",
}

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class OpenAICompatProvider(ImageProvider):
    """ImageProvider backed by an OpenAI-compatible images endpoint.

    Resolution order for every setting is: explicit constructor argument,
    then :mod:`kgsm.secrets`, then the documented default. The API key has
    no default -- generation without one raises :class:`ProviderError`.
    """

    id = "openai-compat"
    display_name = "OpenAI-compatible (BYOK)"

    secret_api_key = SECRET_API_KEY
    secret_base_url = SECRET_BASE_URL
    secret_model = SECRET_MODEL
    secret_price_cents = SECRET_PRICE_CENTS
    default_base_url = DEFAULT_BASE_URL
    default_model = DEFAULT_MODEL

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        price_cents_per_image: int | str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self._model_override = (model or "").strip() or None
        self._base_url_override = (base_url or "").strip() or None
        self._api_key_override = api_key or None
        self._price_override = price_cents_per_image
        self._timeout_s = validate_timeout(timeout_s, DEFAULT_TIMEOUT_S)
        self.calls: list[dict] = []

    @property
    def model(self) -> str:  # noqa: D102 (ImageProvider contract attr)
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

    def _price_cents(self) -> int | None:
        if self._price_override is not None:
            return positive_int(self._price_override)
        return positive_int(secrets_mod.get_secret(self.secret_price_cents))

    # -- ImageProvider -------------------------------------------------

    def estimate_cents(self, n_images: int) -> int | None:
        """Per-image price times *n_images*, or None when unknown.

        There is no hardcoded price table: provider pricing varies by model,
        size, and quality tier and changes often, so any unknown price is
        honestly reported as None (confirmation mandatory, FR-009).
        """
        price = self._price_cents()
        if price is None:
            return None
        return price * n_images

    def generate(
        self, prompt: str, *, style: str, width: int, height: int,
        seed: int | None = None, n_images: int = 1,
    ) -> list[GeneratedImage]:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ProviderError("prompt must not be empty")
        if isinstance(n_images, bool) or not isinstance(n_images, int):
            raise ProviderError("n_images must be 1..16")
        if n_images < 1 or n_images > 16:
            raise ProviderError("n_images must be 1..16")
        for name, side in (("width", width), ("height", height)):
            if (
                isinstance(side, bool)
                or not isinstance(side, int)
                or side < 1
                or side > MAX_IMAGE_SIDE
            ):
                raise ProviderError(
                    f"{name} must be an integer 1..{MAX_IMAGE_SIDE}"
                )
        api_key = require_api_key(self._api_key(), self.id, self.secret_api_key)
        base_url = self._base_url()
        validate_base_url(base_url, self.id)

        model = self.model
        suffix = _STYLE_SUFFIX.get(style)
        styled_prompt = (
            f"{prompt.strip()}, {suffix}" if suffix else prompt.strip()
        )
        payload = {
            "model": model,
            "prompt": styled_prompt,
            "n": n_images,
            "size": f"{width}x{height}",
        }
        url = base_url.rstrip("/") + "/images/generations"
        self.calls.append({
            "prompt": prompt.strip(),
            "style": style,
            "model": model,
            "n_images": n_images,
            "size": f"{width}x{height}",
            "at": datetime.now(timezone.utc).isoformat(),
        })

        raw = post_json(url, payload, api_key=api_key,
                        timeout_s=self._timeout_s, provider_id=self.id,
                        what="images request")
        obj = decode_json(raw, self.id)
        if not isinstance(obj, dict) or not obj.get("data"):
            raise ProviderError(f"{self.id}: response has no 'data' images")
        items = obj["data"]
        if not isinstance(items, list) or len(items) < n_images:
            got = len(items) if isinstance(items, list) else 0
            raise ProviderError(
                f"{self.id}: asked for {n_images} image(s), got {got}"
            )

        images = []
        for index in range(n_images):
            blob = _decode_item(self, items[index], index)
            png = _to_png(self, blob, index)
            actual_w, actual_h = _png_size(png, (width, height))
            images.append(GeneratedImage(
                png_bytes=png, width=actual_w, height=actual_h,
                model=model, seed=seed,
            ))
        return images

    def _fetch_url(self, url: object, index: int) -> bytes:
        if not isinstance(url, str) or not url.startswith(
            ("http://", "https://")
        ):
            raise ProviderError(
                f"{self.id}: image {index} has an invalid 'url'"
            )
        # SSRF guard: provider-supplied URLs must never reach private,
        # loopback, link-local (169.254/metadata), or reserved addresses.
        try:
            _host = urlsplit(url).hostname or ""
        except ValueError:
            _host = ""
        if host_is_blocked(_host):
            raise ProviderError(
                f"{self.id}: image {index} 'url' host is not allowed"
            )
        # Signed URLs carry their own auth; never forward our API key to a
        # third-party host.
        ensure_redirect_guard()  # re-validate every redirect hop pre-fetch
        request = urllib.request.Request(url, method="GET")
        try:
            blob = urllib.request.urlopen(
                request, timeout=self._timeout_s
            ).read(MAX_FETCH_BYTES + 1)
        except urllib.error.HTTPError as exc:
            raise ProviderError(
                f"{self.id}: image download failed with HTTP {exc.code}"
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderError(
                f"{self.id}: image download failed: {exc}"
            ) from None
        if len(blob) > MAX_FETCH_BYTES:
            raise ProviderError(
                f"{self.id}: image {index} exceeds "
                f"{MAX_FETCH_BYTES} bytes"
            )
        if not blob:
            raise ProviderError(
                f"{self.id}: image {index} downloaded empty"
            )
        return blob


def _decode_item(
    provider: OpenAICompatProvider, item: object, index: int
) -> bytes:
    pid = provider.id
    if not isinstance(item, dict):
        raise ProviderError(
            f"{pid}: image {index} is not an object"
        )
    if item.get("b64_json"):
        if not isinstance(item["b64_json"], str):
            raise ProviderError(
                f"{pid}: image {index} 'b64_json' is not a string"
            )
        try:
            blob = base64.b64decode(item["b64_json"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ProviderError(
                f"{pid}: image {index} is not valid base64: {exc}"
            ) from None
        if not blob:
            raise ProviderError(
                f"{pid}: image {index} decoded to empty bytes"
            )
        return blob
    if item.get("url"):
        return provider._fetch_url(item["url"], index)
    raise ProviderError(
        f"{pid}: image {index} has neither 'b64_json' nor 'url'"
    )


def _to_png(provider: OpenAICompatProvider, blob: bytes, index: int) -> bytes:
    if blob[:8] == _PNG_SIGNATURE:
        return blob
    try:
        img = Image.open(io.BytesIO(blob))
        img.load()
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as exc:  # noqa: BLE001 - mapped to ProviderError below
        raise ProviderError(
            f"{provider.id}: image {index} is not a readable image: {exc}"
        ) from None


def _png_size(png: bytes, fallback: tuple[int, int]) -> tuple[int, int]:
    try:
        with Image.open(io.BytesIO(png)) as img:
            return img.width, img.height
    except Exception:  # noqa: BLE001 - requested size is an honest fallback
        return fallback
