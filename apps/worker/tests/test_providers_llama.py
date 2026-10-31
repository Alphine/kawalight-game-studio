"""Meta/Llama provider preset tests (FR-006/FR-007).

Covers the ``llama-image`` preset (a subclass that must reuse the
openai-compat machinery), the ``llama-text`` chat adapter, the host preset
table, and the separate text registry. All HTTP is mocked (no network).
"""

import io
import json
import urllib.error
import urllib.request

import pytest

from kgsm import costs, secrets
from kgsm.providers import (
    get_provider,
    get_text_provider,
    list_providers,
    list_text_providers,
)
from kgsm.providers.base import ProviderError, TextProvider
from kgsm.providers.llama import (
    DEFAULT_BASE_URL,
    DEFAULT_IMAGE_MODEL,
    DEFAULT_TEXT_MODEL,
    LLAMA_PRESETS,
    LlamaImageProvider,
    LlamaTextProvider,
    get_preset,
)
from kgsm.providers.openai_compat import OpenAICompatProvider
from test_openai_provider import (
    TEST_KEY,
    FakeResponse,
    b64_images_body,
    install_fake,
    make_png_bytes,
    request_json,
)


def chat_body(content):
    return json.dumps({
        "id": "chatcmpl-test",
        "choices": [{"message": {"role": "assistant",
                                "content": content}}],
    }).encode("utf-8")


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------

def test_llama_image_registered_alongside_existing():
    ids = {p["id"] for p in list_providers()}
    assert {"mock", "openai-compat", "llama-image"} <= ids
    provider = get_provider("llama-image")
    assert isinstance(provider, LlamaImageProvider)
    assert isinstance(provider, OpenAICompatProvider)  # reuse, not a copy
    assert provider.model == DEFAULT_IMAGE_MODEL


def test_llama_text_lives_in_main_registry():
    # The story route resolves through get_provider, so llama-text must be
    # registered there (not in a side registry).
    ids = {p["id"] for p in list_providers()}
    assert "llama-text" in ids
    provider = get_provider("llama-text")
    assert isinstance(provider, LlamaTextProvider)
    assert isinstance(provider, TextProvider)
    assert provider.model == DEFAULT_TEXT_MODEL


def test_text_views_filter_by_capability():
    entries = list_text_providers()
    by_id = {p["id"]: p for p in entries}
    assert "llama-text" in by_id
    for entry in entries:
        assert set(entry) == {"id", "displayName", "model"}
    # No generate_text: mock (story layer substitutes its placeholder),
    # openai-compat, llama-image.
    for image_only in ("mock", "openai-compat", "llama-image"):
        assert image_only not in by_id
        with pytest.raises(ProviderError, match="does not support"):
            get_text_provider(image_only)
    assert get_text_provider("llama-text") is get_provider("llama-text")


def test_unknown_text_provider_raises():
    with pytest.raises(ProviderError, match="unknown provider"):
        get_text_provider("nope")


# --------------------------------------------------------------------------
# llama-image: own secrets/defaults, inherited machinery
# --------------------------------------------------------------------------

def test_llama_image_secret_resolution_order(store):
    provider = LlamaImageProvider()
    assert provider.model == DEFAULT_IMAGE_MODEL
    secrets.set_secret("llama_image_model", "secret-image-model")
    assert provider.model == "secret-image-model"
    custom = LlamaImageProvider(model="ctor-model")
    assert custom.model == "ctor-model"
    # Sibling secrets must not leak across adapters.
    secrets.set_secret("openai_compat_model", "other-adapter-model")
    secrets.set_secret("llama_text_model", "text-model")
    assert LlamaImageProvider().model == "secret-image-model"


def test_llama_image_posts_openai_shape(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    png = make_png_bytes(4, 3)
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        seen["auth"] = req.get_header("Authorization")
        seen["payload"] = request_json(req)
        return FakeResponse(b64_images_body(png))

    captured = install_fake(monkeypatch, handler)
    provider = LlamaImageProvider()
    (image,) = provider.generate(
        "a hero ship", style="pixel-art", width=64, height=64, seed=9)
    assert len(captured) == 1
    assert captured[0][1].get("timeout") == 120
    assert seen["url"] == DEFAULT_BASE_URL + "/images/generations"
    assert seen["method"] == "POST"
    assert seen["auth"] == f"Bearer {TEST_KEY}"
    assert seen["payload"] == {
        "model": DEFAULT_IMAGE_MODEL,
        "prompt": "a hero ship, pixel art",
        "n": 1,
        "size": "64x64",
    }
    assert image.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    assert (image.width, image.height) == (4, 3)
    assert image.model == DEFAULT_IMAGE_MODEL
    assert image.seed == 9
    assert provider.calls and provider.calls[0]["model"] == DEFAULT_IMAGE_MODEL


def test_llama_image_no_key_names_llama_secret(store, monkeypatch):
    called = install_fake(monkeypatch, lambda req: FakeResponse(b"{}"))
    with pytest.raises(ProviderError, match="llama_api_key"):
        LlamaImageProvider().generate(
            "x", style="pixel-art", width=16, height=16)
    assert called == []


def test_llama_image_errors_carry_preset_prefix_and_redact_key(
        store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)

    def handler(req):
        raise urllib.error.HTTPError(
            req.full_url, 401, "Unauthorized", {},
            io.BytesIO(b'{"error":{"message":"bad key"}}'))

    install_fake(monkeypatch, handler)
    with pytest.raises(ProviderError) as excinfo:
        LlamaImageProvider().generate(
            "x", style="pixel-art", width=16, height=16)
    message = str(excinfo.value)
    assert message.startswith("llama-image:")
    assert "HTTP 401" in message
    assert TEST_KEY not in message


def test_llama_image_estimate_and_quote(store):
    provider = LlamaImageProvider()
    assert provider.estimate_cents(3) is None
    secrets.set_secret("llama_price_cents_per_image", "7")
    assert LlamaImageProvider().estimate_cents(3) == 21
    for bad in ("nope", "-5", "", "  "):
        secrets.set_secret("llama_price_cents_per_image", bad)
        assert LlamaImageProvider().estimate_cents(2) is None
    quote = costs.quote("llama-image", 2, project_id="p1")
    assert quote.cents is None
    assert quote.needs_confirmation is True
    with pytest.raises(costs.CostError):
        costs.authorize(quote, confirmed=False)
    costs.authorize(quote, confirmed=True)


def test_llama_image_inherits_url_fallback_without_auth(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    png = make_png_bytes()
    gets = []

    def handler(req):
        if req.full_url.endswith("/images/generations"):
            return FakeResponse(json.dumps({"data": [
                {"url": "https://cdn.test/img-1.png"},
            ]}).encode())
        gets.append(req)
        return FakeResponse(png)

    install_fake(monkeypatch, handler)
    (image,) = LlamaImageProvider().generate(
        "x", style="pixel-art", width=4, height=3)
    assert image.png_bytes == png
    assert len(gets) == 1
    assert gets[0].get_header("Authorization") is None


def test_llama_image_validates_base_and_timeout(store):
    with pytest.raises(ValueError):
        LlamaImageProvider(timeout_s=0)
    bad_scheme = LlamaImageProvider(api_key=TEST_KEY,
                                    base_url="ftp://x.test/v1")
    with pytest.raises(ProviderError, match="base URL"):
        bad_scheme.generate("x", style="pixel-art", width=16, height=16)
    cleartext = LlamaImageProvider(api_key=TEST_KEY,
                                   base_url="http://example.com/v1")
    with pytest.raises(ProviderError, match="https"):
        cleartext.generate("x", style="pixel-art", width=16, height=16)


# --------------------------------------------------------------------------
# Host presets
# --------------------------------------------------------------------------

def test_presets_cover_documented_hosts():
    assert set(LLAMA_PRESETS) == {"groq", "huggingface", "openrouter",
                                  "together"}
    for name, preset in LLAMA_PRESETS.items():
        assert preset["display_name"], name
        assert preset["key_url"].startswith("https://"), name
        assert preset["base_url"].startswith("https://"), name
        assert isinstance(preset["text_model"], str) \
            and preset["text_model"].strip(), name
        image_model = preset["image_model"]
        assert image_model is None or (
            isinstance(image_model, str) and image_model.strip()), name
        assert preset["notes"], name
    # Together is the only preset (and the default) with both modalities.
    assert LLAMA_PRESETS["together"]["base_url"] == DEFAULT_BASE_URL
    assert LLAMA_PRESETS["together"]["text_model"] == DEFAULT_TEXT_MODEL
    assert LLAMA_PRESETS["together"]["image_model"] == DEFAULT_IMAGE_MODEL
    for name in ("groq", "openrouter", "huggingface"):
        assert LLAMA_PRESETS[name]["image_model"] is None, name


def test_get_preset_returns_a_copy():
    preset = get_preset("groq")
    assert preset["base_url"] == "https://api.groq.com/openai/v1"
    preset["base_url"] = "mutated"
    assert get_preset("groq")["base_url"] == \
        "https://api.groq.com/openai/v1"


def test_get_preset_unknown_lists_known():
    with pytest.raises(ValueError, match="groq"):
        get_preset("nope")


# --------------------------------------------------------------------------
# llama-text: request shape + parsing (mocked HTTP)
# --------------------------------------------------------------------------

def test_text_posts_chat_shape_and_parses(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        seen["auth"] = req.get_header("Authorization")
        seen["payload"] = request_json(req)
        return FakeResponse(chat_body("Once upon a time..."))

    captured = install_fake(monkeypatch, handler)
    provider = LlamaTextProvider()
    result = provider.generate_text("Tell me a story opening.")
    assert len(captured) == 1
    assert captured[0][1].get("timeout") == 120
    assert seen["url"] == DEFAULT_BASE_URL + "/chat/completions"
    assert seen["method"] == "POST"
    assert seen["auth"] == f"Bearer {TEST_KEY}"
    assert seen["payload"] == {
        "model": DEFAULT_TEXT_MODEL,
        "messages": [{"role": "user",
                      "content": "Tell me a story opening."}],
        "max_tokens": 512,
        "temperature": 0.7,
    }
    assert result == {"text": "Once upon a time...",
                      "usage": {"model": DEFAULT_TEXT_MODEL}}
    assert provider.calls and provider.calls[0]["model"] == DEFAULT_TEXT_MODEL


def test_text_system_prompt_and_options(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    payloads = []

    def handler(req):
        payloads.append(request_json(req))
        return FakeResponse(chat_body("ok"))

    install_fake(monkeypatch, handler)
    provider = LlamaTextProvider()
    provider.generate_text("Go.", system="You write space operas.",
                           max_tokens=64, temperature=0.2)
    assert payloads[0]["messages"] == [
        {"role": "system", "content": "You write space operas."},
        {"role": "user", "content": "Go."},
    ]
    assert payloads[0]["max_tokens"] == 64
    assert payloads[0]["temperature"] == 0.2
    provider.generate_text("Go.", system="   ")  # blank system omitted
    assert payloads[1]["messages"] == [{"role": "user", "content": "Go."}]


def test_text_genre_becomes_default_system_prompt(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    payloads = []

    def handler(req):
        payloads.append(request_json(req))
        return FakeResponse(chat_body("ok"))

    install_fake(monkeypatch, handler)
    provider = LlamaTextProvider()
    # Called exactly the way kgsm.story dispatches: genre as keyword.
    result = provider.generate_text("A dragon stirs.", genre="horror")
    assert result["text"] == "ok"
    assert result["usage"] == {"model": DEFAULT_TEXT_MODEL}
    assert payloads[0]["messages"] == [
        {"role": "system",
         "content": "You are writing a horror game story."},
        {"role": "user", "content": "A dragon stirs."},
    ]
    assert provider.calls[0]["genre"] == "horror"
    # An explicit system prompt always wins over the genre default.
    provider.generate_text("Go.", genre="horror", system="Custom voice.")
    assert payloads[1]["messages"][0] == {"role": "system",
                                          "content": "Custom voice."}
    # Blank genre behaves like no genre.
    provider.generate_text("Go.", genre="   ")
    assert payloads[2]["messages"] == [{"role": "user", "content": "Go."}]


def test_llama_text_quote_and_image_guard(store):
    provider = LlamaTextProvider()
    assert provider.estimate_cents(1) is None  # text cost unquoted
    quote = costs.quote("llama-text", 1, project_id="p1")
    assert quote.cents is None
    assert quote.needs_confirmation is True
    with pytest.raises(costs.CostError):
        costs.authorize(quote, confirmed=False)
    costs.authorize(quote, confirmed=True)
    # Picking the text preset for images fails cleanly (502), never 500.
    with pytest.raises(ProviderError, match="text-only"):
        provider.generate("x", style="pixel-art", width=16, height=16)


def test_story_layer_dispatch_end_to_end(store, monkeypatch):
    # story.generate_text -> llama-text over mocked HTTP, no other wiring.
    from kgsm import story as story_mod

    secrets.set_secret("llama_api_key", TEST_KEY)
    install_fake(monkeypatch,
                 lambda req: FakeResponse(chat_body("A haunted tale.")))
    text, usage = story_mod.generate_text(
        get_provider("llama-text"), "Tell me a story.", "horror")
    assert text == "A haunted tale."
    assert usage["model"] == DEFAULT_TEXT_MODEL
    assert usage["promptChars"] == len("Tell me a story.")
    assert usage["textChars"] == len("A haunted tale.")


def test_text_model_selectable(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    models = []

    def handler(req):
        models.append(request_json(req)["model"])
        return FakeResponse(chat_body("ok"))

    install_fake(monkeypatch, handler)
    LlamaTextProvider().generate_text("x")
    assert models == [DEFAULT_TEXT_MODEL]
    secrets.set_secret("llama_text_model", "secret-text-model")
    assert LlamaTextProvider().model == "secret-text-model"
    LlamaTextProvider().generate_text("x")
    assert models[1] == "secret-text-model"
    custom = LlamaTextProvider(model="ctor-model")
    custom.generate_text("x")
    assert models[2] == "ctor-model"  # constructor wins over secrets
    # Sibling secrets must not leak across adapters.
    secrets.set_secret("llama_image_model", "image-model")
    secrets.set_secret("openai_compat_model", "other-adapter-model")
    assert LlamaTextProvider().model == "secret-text-model"


def test_text_base_url_override_and_trailing_slash(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    urls = []

    def handler(req):
        urls.append(req.full_url)
        return FakeResponse(chat_body("ok"))

    install_fake(monkeypatch, handler)
    provider = LlamaTextProvider(base_url="https://gateway.test/v1/")
    provider.generate_text("x")
    assert urls == ["https://gateway.test/v1/chat/completions"]
    secrets.set_secret("llama_base_url", "http://127.0.0.1:9999")
    LlamaTextProvider().generate_text("x")
    assert urls[1] == "http://127.0.0.1:9999/chat/completions"


def test_text_joins_content_blocks(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    body = json.dumps({"choices": [{"message": {"content": [
        {"type": "text", "text": "Hello, "},
        {"type": "text", "text": "world!"},
    ]}}]}).encode()
    install_fake(monkeypatch, lambda req: FakeResponse(body))
    result = LlamaTextProvider().generate_text("x")
    assert result["text"] == "Hello, world!"


def test_text_calls_log_never_holds_the_key(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)
    install_fake(monkeypatch, lambda req: FakeResponse(chat_body("ok")))
    provider = LlamaTextProvider()
    provider.generate_text("x", system="s")
    assert TEST_KEY not in json.dumps(provider.calls)


# --------------------------------------------------------------------------
# llama-text: validation + error mapping (mocked HTTP)
# --------------------------------------------------------------------------

def test_text_without_key_fails_before_http(store, monkeypatch):
    called = install_fake(monkeypatch, lambda req: FakeResponse(b"{}"))
    with pytest.raises(ProviderError, match="llama_api_key"):
        LlamaTextProvider().generate_text("x")
    assert called == []  # no HTTP attempted


def test_text_validates_inputs(store, monkeypatch):
    install_fake(monkeypatch, lambda req: FakeResponse(b"{}"))
    provider = LlamaTextProvider(api_key=TEST_KEY)
    for bad_prompt in ("  ", "", None, 123):
        with pytest.raises(ProviderError):
            provider.generate_text(bad_prompt)
    with pytest.raises(ProviderError):
        provider.generate_text("x", genre=123)
    with pytest.raises(ProviderError):
        provider.generate_text("x", system=123)
    for bad_n in (0, 8193, True, "100"):
        with pytest.raises(ProviderError):
            provider.generate_text("x", max_tokens=bad_n)
    for bad_t in (-0.1, 2.1, True, "warm", float("nan"), float("inf")):
        with pytest.raises(ProviderError):
            provider.generate_text("x", temperature=bad_t)
    # Boundary values are accepted.
    for ok_t in (0, 2, 1):
        install_fake(monkeypatch, lambda req: FakeResponse(chat_body("ok")))
        assert LlamaTextProvider(api_key=TEST_KEY).generate_text(
            "x", temperature=ok_t)["text"] == "ok"


def test_text_validates_base_url(store, monkeypatch):
    install_fake(monkeypatch, lambda req: FakeResponse(b"{}"))
    bad_scheme = LlamaTextProvider(api_key=TEST_KEY, base_url="ftp://x/v1")
    with pytest.raises(ProviderError, match="base URL"):
        bad_scheme.generate_text("x")
    cleartext = LlamaTextProvider(api_key=TEST_KEY,
                                  base_url="http://example.com/v1")
    with pytest.raises(ProviderError, match="https"):
        cleartext.generate_text("x")


def test_text_http_error_mapping_redacts_key(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)

    def handler(req):
        raise urllib.error.HTTPError(
            req.full_url, 401, "Unauthorized", {},
            io.BytesIO(b'{"error":{"message":"bad key"}}'))

    install_fake(monkeypatch, handler)
    with pytest.raises(ProviderError) as excinfo:
        LlamaTextProvider().generate_text("x")
    message = str(excinfo.value)
    assert message.startswith("llama-text:")
    assert "chat request failed with HTTP 401" in message
    assert "bad key" in message
    assert TEST_KEY not in message


def test_text_network_error_mapping(store, monkeypatch):
    secrets.set_secret("llama_api_key", TEST_KEY)

    def handler(req):
        raise urllib.error.URLError("connection refused")

    install_fake(monkeypatch, handler)
    with pytest.raises(ProviderError, match="request failed"):
        LlamaTextProvider().generate_text("x")


@pytest.mark.parametrize("raw", [
    b"not json",
    b"{}",
    b"[]",
    b'{"choices": []}',
    b'{"choices": "nope"}',
    b'{"choices": ["nope"]}',
    b'{"choices": [{}]}',
    b'{"choices": [{"message": "nope"}]}',
    b'{"choices": [{"message": {}}]}',
    b'{"choices": [{"message": {"content": ""}}]}',
    b'{"choices": [{"message": {"content": "   "}}]}',
    b'{"choices": [{"message": {"content": 123}}]}',
    b'{"choices": [{"message": {"content": [{"type": "image"}]}}]}',
])
def test_text_malformed_responses(store, monkeypatch, raw):
    secrets.set_secret("llama_api_key", TEST_KEY)
    install_fake(monkeypatch, lambda req: FakeResponse(raw))
    with pytest.raises(ProviderError):
        LlamaTextProvider().generate_text("x")


def test_text_constructor_timeout(store, monkeypatch):
    with pytest.raises(ValueError):
        LlamaTextProvider(timeout_s=0)
    with pytest.raises(ValueError):
        LlamaTextProvider(timeout_s=-5)
    # Explicit None falls back to the documented default (no ValueError).
    captured = install_fake(
        monkeypatch, lambda req: FakeResponse(chat_body("ok")))
    LlamaTextProvider(api_key=TEST_KEY, timeout_s=None).generate_text("x")
    assert captured[0][1].get("timeout") == 120


def test_llama_module_is_stdlib_only():
    # No third-party HTTP/AI SDK may sneak into the worker path.
    import sys

    import kgsm.providers.llama  # noqa: F401 (import for side-effect check)

    assert "requests" not in sys.modules
    assert "openai" not in sys.modules
