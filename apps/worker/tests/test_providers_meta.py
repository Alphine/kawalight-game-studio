"""Meta AI (Muse) default providers: registration, defaults, and wire shape.

HTTP is faked through the shared ``install_fake`` helper, so no test ever
touches the network or spends money.
"""

import json

import pytest

from kgsm import secrets
from kgsm.providers import get_provider, list_providers
from kgsm.providers.base import ProviderError
from kgsm.providers.meta import (
    DEFAULT_BASE_URL,
    DEFAULT_IMAGE_MODEL,
    DEFAULT_TEXT_MODEL,
    MetaImageProvider,
    MetaTextProvider,
)
from test_openai_provider import TEST_KEY, FakeResponse, install_fake, request_json


def chat_body(content):
    return json.dumps({
        "id": "chatcmpl-meta",
        "choices": [{"message": {"role": "assistant", "content": content}}],
    }).encode("utf-8")


def test_meta_providers_are_registered():
    ids = {p["id"] for p in list_providers()}
    assert {"meta-text", "meta-image"} <= ids
    assert isinstance(get_provider("meta-text"), MetaTextProvider)
    assert isinstance(get_provider("meta-image"), MetaImageProvider)


def test_meta_defaults_point_at_meta_api_and_muse_models(store):
    assert DEFAULT_BASE_URL == "https://api.meta.ai/v1"
    assert MetaTextProvider().model == DEFAULT_TEXT_MODEL == "muse-spark-1.3"
    assert get_provider("meta-image").model == DEFAULT_IMAGE_MODEL == "muse-image-1.0"


def test_meta_uses_its_own_secret_names(store):
    # The Meta key must not reuse the Llama/Together secret.
    assert MetaTextProvider.secret_api_key == "meta_api_key"
    assert MetaImageProvider.secret_api_key == "meta_api_key"
    assert MetaImageProvider.secret_model == "meta_image_model"
    secrets.set_secret("llama_api_key", "other-key")
    assert MetaTextProvider()._api_key() is None


def test_meta_text_posts_to_meta_chat_endpoint(store, monkeypatch):
    secrets.set_secret("meta_api_key", TEST_KEY)
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        seen["auth"] = req.get_header("Authorization")
        seen["payload"] = request_json(req)
        return FakeResponse(chat_body("Ada kapal kecil di tepi galaksi."))

    install_fake(monkeypatch, handler)
    result = MetaTextProvider().generate_text("Tulis pembuka cerita.")
    assert seen["url"] == DEFAULT_BASE_URL + "/chat/completions"
    assert seen["auth"] == f"Bearer {TEST_KEY}"
    assert seen["payload"]["model"] == DEFAULT_TEXT_MODEL
    assert seen["payload"]["reasoning_effort"] == "minimal"
    assert result["text"] == "Ada kapal kecil di tepi galaksi."


def test_meta_text_without_key_fails_clean(store, monkeypatch):
    install_fake(monkeypatch, lambda req: FakeResponse(chat_body("unused")))
    with pytest.raises(ProviderError):
        MetaTextProvider().generate_text("halo")


