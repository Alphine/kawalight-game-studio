"""OpenAI-compatible image-generation adapter (FR-006).

Talks to any ``POST {base_url}/images/generations`` endpoint that follows the
OpenAI Images API shape (api.openai.com, local gateways, self-hosted
OpenAI-compatible servers). HTTP uses stdlib ``urllib`` only -- no third-party
SDK. Configuration comes from :mod:`kgsm.secrets` (see ``docs/providers.md``)
and is resolved lazily on every call, so keys can be rotated without a
worker restart. Secret values are never logged or included in errors.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

from PIL import Image

from .. import secrets as secrets_mod
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


def _positive_int(value: object) -> int | None:
    """Coerce *value* to an int >= 0, else None (honest unknown)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and value.strip():
        try:
            parsed = int(value.strip())
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None


class OpenAICompatProvider(ImageProvider):
    """ImageProvider backed by an OpenAI-compatible images endpoint.

    Resolution order for every setting is: explicit constructor argument,
    then :mod:`kgsm.secrets`, then the documented default. The API key has
    no default -- generation without one raises :class:`ProviderError`.
    """

    id = "openai-compat"
    display_name = "OpenAI-compatible (BYOK)"

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        price_cents_per_image: int | str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        if timeout_s is None:
            timeout_s = DEFAULT_TIMEOUT_S
        if (
            isinstance(timeout_s, bool)
            or not isinstance(timeout_s, (int, float))
            or timeout_s <= 0
        ):
            raise ValueError("timeout_s must be a positive number of seconds")
        self._model_override = (model or "").strip() or None
        self._base_url_override = (base_url or "").strip() or None
        self._api_key_override = api_key or None
        self._price_override = price_cents_per_image
        self._timeout_s = timeout_s
        self.calls: list[dict] = []

    @property
    def model(self) -> str:  # noqa: D102 (ImageProvider contract attr)
        if self._model_override:
            return self._model_override
        configured = (secrets_mod.get_secret(SECRET_MODEL) or "").strip()
        return configured or DEFAULT_MODEL

    def _base_url(self) -> str:
        if self._base_url_override:
            return self._base_url_override
        configured = (secrets_mod.get_secret(SECRET_BASE_URL) or "").strip()
        return configured or DEFAULT_BASE_URL

    def _api_key(self) -> str | None:
        if self._api_key_override:
            return self._api_key_override
        return secrets_mod.get_secret(SECRET_API_KEY) or None

    def _price_cents(self) -> int | None:
        if self._price_override is not None:
            return _positive_int(self._price_override)
        return _positive_int(secrets_mod.get_secret(SECRET_PRICE_CENTS))

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
        api_key = self._api_key()
        if not api_key:
            raise ProviderError(
                "openai-compat: no API key configured "
                f"(store one as secret {SECRET_API_KEY!r})"
            )
        base_url = self._base_url()
        if not base_url.startswith(("http://", "https://")):
            raise ProviderError(
                f"openai-compat: base URL must start with http:// or https://: "
                f"{base_url!r}"
            )

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

        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        try:
            raw = urllib.request.urlopen(request, timeout=self._timeout_s).read()
        except urllib.error.HTTPError as exc:
            raise ProviderError(
                f"openai-compat: images request failed with HTTP {exc.code}"
                + _http_detail(exc, api_key)
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderError(
                f"openai-compat: request failed: {exc}"
            ) from None

        try:
            obj = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError(
                f"openai-compat: invalid JSON response: {exc}"
            ) from None
        if not isinstance(obj, dict) or not obj.get("data"):
            raise ProviderError("openai-compat: response has no 'data' images")
        items = obj["data"]
        if not isinstance(items, list) or len(items) < n_images:
            got = len(items) if isinstance(items, list) else 0
            raise ProviderError(
                f"openai-compat: asked for {n_images} image(s), got {got}"
            )

        images = []
        for index in range(n_images):
            blob = _decode_item(self, items[index], index)
            png = _to_png(blob, index)
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
                f"openai-compat: image {index} has an invalid 'url'"
            )
        # Signed URLs carry their own auth; never forward our API key to a
        # third-party host.
        request = urllib.request.Request(url, method="GET")
        try:
            blob = urllib.request.urlopen(
                request, timeout=self._timeout_s
            ).read(MAX_FETCH_BYTES + 1)
        except urllib.error.HTTPError as exc:
            raise ProviderError(
                f"openai-compat: image download failed with HTTP {exc.code}"
            ) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderError(
                f"openai-compat: image download failed: {exc}"
            ) from None
        if len(blob) > MAX_FETCH_BYTES:
            raise ProviderError(
                f"openai-compat: image {index} exceeds "
                f"{MAX_FETCH_BYTES} bytes"
            )
        if not blob:
            raise ProviderError(
                f"openai-compat: image {index} downloaded empty"
            )
        return blob


def _http_detail(exc: urllib.error.HTTPError, api_key: str) -> str:
    try:
        detail = exc.read().decode("utf-8", "replace").strip()[:500]
    except Exception:  # noqa: BLE001 - error detail is best effort
        return ""
    if not detail:
        return ""
    if api_key and api_key in detail:  # defense in depth; never leak the key
        detail = detail.replace(api_key, "***")
    return f": {detail}"


def _decode_item(
    provider: OpenAICompatProvider, item: object, index: int
) -> bytes:
    if not isinstance(item, dict):
        raise ProviderError(
            f"openai-compat: image {index} is not an object"
        )
    if item.get("b64_json"):
        if not isinstance(item["b64_json"], str):
            raise ProviderError(
                f"openai-compat: image {index} 'b64_json' is not a string"
            )
        try:
            blob = base64.b64decode(item["b64_json"], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ProviderError(
                f"openai-compat: image {index} is not valid base64: {exc}"
            ) from None
        if not blob:
            raise ProviderError(
                f"openai-compat: image {index} decoded to empty bytes"
            )
        return blob
    if item.get("url"):
        return provider._fetch_url(item["url"], index)
    raise ProviderError(
        f"openai-compat: image {index} has neither 'b64_json' nor 'url'"
    )


def _to_png(blob: bytes, index: int) -> bytes:
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
            f"openai-compat: image {index} is not a readable image: {exc}"
        ) from None


def _png_size(png: bytes, fallback: tuple[int, int]) -> tuple[int, int]:
    try:
        with Image.open(io.BytesIO(png)) as img:
            return img.width, img.height
    except Exception:  # noqa: BLE001 - requested size is an honest fallback
        return fallback
