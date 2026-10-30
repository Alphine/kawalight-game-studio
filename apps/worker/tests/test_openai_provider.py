"""OpenAI-compatible provider adapter tests (FR-006/FR-009).

All HTTP is mocked (no network): ``urllib.request.urlopen`` is replaced per
test with a fake that asserts on the outgoing request and replays canned
bytes.
"""

import base64
import io
import json
import urllib.error
import urllib.request

import pytest
from PIL import Image

from kgsm import costs, secrets
from kgsm.providers import get_provider, list_providers
from kgsm.providers.base import ProviderError
from kgsm.providers.openai_compat import (
    DEFAULT_MODEL,
    OpenAICompatProvider,
)

TEST_KEY = "test-key-not-a-real-secret"


def make_png_bytes(width=4, height=3, color=(200, 30, 30)):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


def make_jpeg_bytes(width=6, height=5):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (30, 200, 60)).save(buf, format="JPEG")
    return buf.getvalue()


def b64_images_body(*blobs):
    return json.dumps({
        "created": 1,
        "data": [{"b64_json": base64.b64encode(b).decode()} for b in blobs],
    }).encode("utf-8")


class FakeResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            out, self._payload = self._payload, b""
            return out
        out, self._payload = self._payload[:n], self._payload[n:]
        return out


def install_fake(monkeypatch, handler):
    """Replace urlopen; returns the list of captured (request, kwargs)."""
    captured = []

    def fake(req, *args, **kwargs):
        captured.append((req, kwargs))
        return handler(req)

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return captured


def request_json(req):
    return json.loads(req.data.decode("utf-8"))


# --------------------------------------------------------------------------
# Registration + cost behavior
# --------------------------------------------------------------------------

def test_openai_compat_registered_alongside_mock_default():
    ids = {p["id"] for p in list_providers()}
    assert "mock" in ids  # mock default unbroken
    assert "openai-compat" in ids
    provider = get_provider("openai-compat")
    assert isinstance(provider, OpenAICompatProvider)
    assert provider.model == DEFAULT_MODEL


def test_estimate_unknown_by_default(store):
    provider = OpenAICompatProvider()
    assert provider.estimate_cents(3) is None
    for bad in ("nope", "-5", "", "  "):
        secrets.set_secret("openai_compat_price_cents_per_image", bad)
        assert provider.estimate_cents(3) is None


def test_estimate_with_configured_price(store):
    secrets.set_secret("openai_compat_price_cents_per_image", "7")
    assert OpenAICompatProvider().estimate_cents(3) == 21
    assert OpenAICompatProvider(price_cents_per_image=5).estimate_cents(2) == 10


def test_unknown_cost_quote_needs_confirmation(store):
    quote = costs.quote("openai-compat", 2, project_id="p1")
    assert quote.cents is None
    assert quote.needs_confirmation is True
    with pytest.raises(costs.CostError):
        costs.authorize(quote, confirmed=False)
    costs.authorize(quote, confirmed=True)  # explicit confirmation passes


def test_paid_quote_needs_confirmation(store):
    secrets.set_secret("openai_compat_price_cents_per_image", "10")
    quote = costs.quote("openai-compat", 2, project_id="p1")
    assert quote.cents == 20
    with pytest.raises(costs.CostError):
        costs.authorize(quote, confirmed=False)
    costs.authorize(quote, confirmed=True)


# --------------------------------------------------------------------------
# generate(): request shape + parsing (mocked HTTP)
# --------------------------------------------------------------------------

def test_generate_posts_openai_shape_and_parses_b64(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    png = make_png_bytes(4, 3)
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        seen["auth"] = req.get_header("Authorization")
        seen["payload"] = request_json(req)
        return FakeResponse(b64_images_body(png, png))

    captured = install_fake(monkeypatch, handler)
    provider = OpenAICompatProvider()
    images = provider.generate(
        "a hero ship", style="pixel-art", width=64, height=64,
        seed=9, n_images=2,
    )
    assert len(captured) == 1
    assert captured[0][1].get("timeout") == 120
    assert seen["url"] == "https://api.openai.com/v1/images/generations"
    assert seen["method"] == "POST"
    assert seen["auth"] == f"Bearer {TEST_KEY}"
    assert seen["payload"] == {
        "model": DEFAULT_MODEL,
        "prompt": "a hero ship, pixel art",
        "n": 2,
        "size": "64x64",
    }
    assert len(images) == 2
    for image in images:
        assert image.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
        assert (image.width, image.height) == (4, 3)  # actual dims reported
        assert image.model == DEFAULT_MODEL
        assert image.seed == 9
    assert provider.calls and provider.calls[0]["n_images"] == 2


def test_generate_style_hint_and_passthrough(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    prompts = []

    def handler(req):
        prompts.append(request_json(req)["prompt"])
        return FakeResponse(b64_images_body(make_png_bytes()))

    install_fake(monkeypatch, handler)
    provider = OpenAICompatProvider()
    provider.generate("ship", style="illustrated-2d", width=16, height=16)
    assert prompts == ["ship, detailed 2D illustration"]
    provider.generate("ship", style="future-style", width=16, height=16)
    assert prompts[1] == "ship"  # unknown styles pass through untouched


def test_generate_model_selectable(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    models = []

    def handler(req):
        models.append(request_json(req)["model"])
        return FakeResponse(b64_images_body(make_png_bytes()))

    install_fake(monkeypatch, handler)
    OpenAICompatProvider().generate("x", style="pixel-art",
                                    width=16, height=16)
    assert models == [DEFAULT_MODEL]
    secrets.set_secret("openai_compat_model", "secret-model")
    assert OpenAICompatProvider().model == "secret-model"
    OpenAICompatProvider().generate("x", style="pixel-art",
                                    width=16, height=16)
    assert models[1] == "secret-model"
    custom = OpenAICompatProvider(model="custom-model")
    assert custom.model == "custom-model"
    custom.generate("x", style="pixel-art", width=16, height=16)
    assert models[2] == "custom-model"  # constructor wins over secrets


def test_generate_base_url_override_and_trailing_slash(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    urls = []

    def handler(req):
        urls.append(req.full_url)
        return FakeResponse(b64_images_body(make_png_bytes()))

    install_fake(monkeypatch, handler)
    provider = OpenAICompatProvider(base_url="https://gateway.test/v1/")
    provider.generate("x", style="pixel-art", width=16, height=16)
    assert urls == ["https://gateway.test/v1/images/generations"]
    secrets.set_secret("openai_compat_base_url", "http://127.0.0.1:9999")
    provider = OpenAICompatProvider()
    provider.generate("x", style="pixel-art", width=16, height=16)
    assert urls[1] == "http://127.0.0.1:9999/images/generations"


def test_generate_jpeg_normalized_to_png(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    install_fake(monkeypatch, lambda req: FakeResponse(
        b64_images_body(make_jpeg_bytes())))
    (image,) = OpenAICompatProvider().generate(
        "x", style="pixel-art", width=6, height=5)
    assert image.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    assert (image.width, image.height) == (6, 5)


def test_generate_url_fallback_fetches_without_auth(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    png = make_png_bytes()
    gets = []

    def handler(req):
        if req.full_url.endswith("/images/generations"):
            body = json.dumps({"data": [
                {"url": "https://cdn.test/img-1.png"},
            ]}).encode()
            return FakeResponse(body)
        gets.append(req)
        return FakeResponse(png)

    install_fake(monkeypatch, handler)
    (image,) = OpenAICompatProvider().generate(
        "x", style="pixel-art", width=4, height=3)
    assert image.png_bytes == png
    assert len(gets) == 1
    assert gets[0].get_method() == "GET"
    assert gets[0].get_header("Authorization") is None  # signed URL: no key


# --------------------------------------------------------------------------
# generate(): validation + error mapping (mocked HTTP)
# --------------------------------------------------------------------------

def test_generate_without_key_fails_before_http(store, monkeypatch):
    called = install_fake(
        monkeypatch, lambda req: FakeResponse(b"{}"))
    with pytest.raises(ProviderError, match="no API key"):
        OpenAICompatProvider().generate(
            "x", style="pixel-art", width=16, height=16)
    assert called == []  # no HTTP attempted


def test_generate_validates_inputs(store, monkeypatch):
    install_fake(monkeypatch, lambda req: FakeResponse(b"{}"))
    provider = OpenAICompatProvider(api_key=TEST_KEY)
    with pytest.raises(ProviderError):
        provider.generate("  ", style="pixel-art", width=16, height=16)
    for bad_n in (0, 17):
        with pytest.raises(ProviderError):
            provider.generate("x", style="pixel-art", width=16, height=16,
                              n_images=bad_n)
    for bad_side in (0, 5000):
        with pytest.raises(ProviderError):
            provider.generate("x", style="pixel-art", width=bad_side,
                              height=16)
    bad_base = OpenAICompatProvider(api_key=TEST_KEY,
                                    base_url="ftp://x.test/v1")
    with pytest.raises(ProviderError, match="base URL"):
        bad_base.generate("x", style="pixel-art", width=16, height=16)


def test_generate_http_error_mapping_redacts_key(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)

    def handler(req):
        raise urllib.error.HTTPError(
            req.full_url, 401, "Unauthorized", {},
            io.BytesIO(b'{"error":{"message":"bad key"}}'))

    install_fake(monkeypatch, handler)
    with pytest.raises(ProviderError) as excinfo:
        OpenAICompatProvider().generate(
            "x", style="pixel-art", width=16, height=16)
    assert "HTTP 401" in str(excinfo.value)
    assert "bad key" in str(excinfo.value)
    assert TEST_KEY not in str(excinfo.value)


def test_generate_network_error_mapping(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)

    def handler(req):
        raise urllib.error.URLError("connection refused")

    install_fake(monkeypatch, handler)
    with pytest.raises(ProviderError, match="request failed"):
        OpenAICompatProvider().generate(
            "x", style="pixel-art", width=16, height=16)


@pytest.mark.parametrize("raw", [
    b"not json",
    b"{}",
    b'{"data": []}',
    b'{"data": [{"b64_json": "!!!not-base64!!!"}]}',
    b'{"data": [{"caption": "no image here"}]}',
    b'{"data": ["nope"]}',
])
def test_generate_malformed_responses(store, monkeypatch, raw):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    install_fake(monkeypatch, lambda req: FakeResponse(raw))
    with pytest.raises(ProviderError):
        OpenAICompatProvider().generate(
            "x", style="pixel-art", width=16, height=16)


def test_generate_short_data_list(store, monkeypatch):
    secrets.set_secret("openai_compat_api_key", TEST_KEY)
    install_fake(monkeypatch, lambda req: FakeResponse(
        b64_images_body(make_png_bytes())))
    with pytest.raises(ProviderError, match="asked for 2"):
        OpenAICompatProvider().generate(
            "x", style="pixel-art", width=16, height=16, n_images=2)


def test_constructor_rejects_bad_timeout():
    with pytest.raises(ValueError):
        OpenAICompatProvider(timeout_s=0)
