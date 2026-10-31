"""Story generation tests (contract §13; NEW).

Exercises the story route handler directly (mirroring ``server.dispatch``
semantics: ``ApiError`` → ``(status, envelope)``) so the suite stays green
before/after the one-line server wiring (``routes_story.ROUTES`` into
``server._collect_routes``). No sockets, no network.
"""

import pytest

from kgsm import costs as costs_mod
from kgsm import projects as projects_mod
from kgsm import story as story_mod
from kgsm.api import ApiError, Request
from kgsm.api.routes_story import ROUTES, generate_story
from kgsm.providers import ProviderError, register_provider


def call(body):
    try:
        return generate_story(Request(method="POST",
                                      path="/stories/generate",
                                      body=body))
    except ApiError as exc:
        return exc.status, exc.to_body()


def make_project_id(name="Story Demo", genre="space-shooter"):
    return projects_mod.create(name, genre).id


class PaidTextProvider:
    """Deterministic paid text backend (str return shape)."""

    id = "test-story-paid"
    display_name = "Test story paid"
    model = "story-paid-1"

    def estimate_cents(self, n_images):
        return 100 * n_images

    def generate_text(self, prompt, genre=None):
        tag = genre or "untold"
        return f"A paid {tag} tale of {prompt.strip()}."


class UnknownCostTextProvider:
    """Unknown-cost text backend (dict return shape with usage)."""

    id = "test-story-unknown"
    display_name = "Test story unknown-cost"
    model = "story-unknown-1"

    def estimate_cents(self, n_images):
        return None

    def generate_text(self, prompt, genre=None):
        return {"text": f"An {genre or 'untold'} mystery: {prompt.strip()}.",
                "usage": {"promptTokens": 7, "completionTokens": 12}}


class TupleTextProvider:
    """Text backend using the (text, usage) tuple shape."""

    id = "test-story-tuple"
    display_name = "Test story tuple"
    model = "story-tuple-1"

    def estimate_cents(self, n_images):
        return 0

    def generate_text(self, prompt, genre=None):
        return "Tuple tale.", {"backend": "tuple"}


class ImageOnlyProvider:
    """Registered provider with no text capability (no generate_text)."""

    id = "test-story-image-only"
    display_name = "Test image only"
    model = "img-1"

    def estimate_cents(self, n_images):
        return 0


class OutageTextProvider:
    """Text backend that always fails (NFR-003 path)."""

    id = "test-story-outage"
    display_name = "Test story outage"
    model = "none"

    def estimate_cents(self, n_images):
        return 0

    def generate_text(self, prompt, genre=None):
        raise ProviderError("simulated text outage")


@pytest.fixture(scope="module", autouse=True)
def _story_providers():
    register_provider(PaidTextProvider())
    register_provider(UnknownCostTextProvider())
    register_provider(TupleTextProvider())
    register_provider(ImageOnlyProvider())
    register_provider(OutageTextProvider())


# --------------------------------------------------------------------------
# Route table
# --------------------------------------------------------------------------

def test_routes_table_shape():
    assert ROUTES == [("POST", r"/stories/generate", generate_story)]


def test_story_route_mounted_in_server_dispatch(store):
    from kgsm.api.server import dispatch
    status, body = dispatch(Request(method="POST", path="/stories/generate",
                                    body={"prompt": "a brave pilot"}))
    assert status == 201, body
    assert body["text"]
    assert body["provider"] == "mock"


# --------------------------------------------------------------------------
# Mock offline path (default providerId)
# --------------------------------------------------------------------------

def test_mock_story_default_provider(store):
    status, body = call({"prompt": "a lost starship"})
    assert status == 201, body
    assert set(body) == {"text", "provider", "model", "usage", "quote",
                         "spentCents"}
    assert body["provider"] == "mock"
    assert body["model"] == "mock-1"
    assert "a lost starship" in body["text"]
    assert body["usage"]["textChars"] == len(body["text"])
    assert body["usage"]["promptChars"] == len("a lost starship")
    assert body["spentCents"] == 0
    assert body["quote"]["cents"] == 0
    assert body["quote"]["needsConfirmation"] is False


def test_mock_story_explicit_provider_and_genre(store):
    pid = make_project_id()
    status, body = call({"providerId": "mock", "prompt": "a dragon baker",
                         "genre": "comedy", "projectId": pid})
    assert status == 201, body
    assert "comedy" in body["text"]
    assert "a dragon baker" in body["text"]
    assert body["quote"]["projectId"] == pid


def test_mock_placeholder_is_deterministic():
    first = story_mod.placeholder_story("a lost starship", "noir")
    second = story_mod.placeholder_story("a lost starship", "noir")
    assert first == second
    assert "noir" in first and "a lost starship" in first
    other = story_mod.placeholder_story("a found starship", "noir")
    assert other != first


def test_mock_spend_scoped_to_project(store):
    pid = make_project_id()
    status, _ = call({"prompt": "scoped tale", "projectId": pid})
    assert status == 201
    conn_entries = costs_mod.spent_this_month(pid)
    assert conn_entries == 0  # free mock records 0 actual
    # ... but the ledger row exists and is project-scoped.
    from kgsm import db as db_mod
    conn = db_mod.connect()
    try:
        rows = conn.execute(
            "SELECT project_id, amount_cents FROM spend_ledger").fetchall()
    finally:
        conn.close()
    assert [(r["project_id"], r["amount_cents"]) for r in rows] == [(pid, 0)]


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def test_missing_or_empty_prompt_is_400(store):
    status, body = call({})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": "   "})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": 123})
    assert status == 400 and body["error"]["code"] == "bad-request"


def test_bad_genre_project_and_provider_ids(store):
    status, body = call({"prompt": "x", "genre": ""})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": "x", "genre": 7})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": "x", "genre": "g" * 65})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": "x", "projectId": "nope"})
    assert status == 404 and body["error"]["code"] == "project-not-found"
    status, body = call({"prompt": "x", "projectId": 5})
    assert status == 400 and body["error"]["code"] == "bad-request"
    status, body = call({"prompt": "x", "providerId": "no-such"})
    assert status == 404 and body["error"]["code"] == "unknown-provider"
    status, body = call({"prompt": "y" * 8001})
    assert status == 400 and body["error"]["code"] == "bad-request"


def test_unknown_fields_ignored(store):
    status, body = call({"prompt": "tolerated", "future": 1})
    assert status == 201, body
    assert "tolerated" in body["text"]


# --------------------------------------------------------------------------
# Cost gates (quote → authorize → 409/402 with quote attached)
# --------------------------------------------------------------------------

def test_paid_unconfirmed_needs_confirmation(store):
    status, body = call({"providerId": "test-story-paid",
                         "prompt": "a toll bridge"})
    assert status == 409, body
    assert body["error"]["code"] == "needs-confirmation"
    assert body["quote"]["cents"] == 100
    assert body["quote"]["providerId"] == "test-story-paid"


def test_paid_confirmed_spends_and_returns_text(store):
    pid = make_project_id()
    status, body = call({"providerId": "test-story-paid",
                         "prompt": "a toll bridge", "genre": "fable",
                         "projectId": pid, "confirmed": True})
    assert status == 201, body
    assert body["text"] == "A paid fable tale of a toll bridge."
    assert body["provider"] == "test-story-paid"
    assert body["model"] == "story-paid-1"
    assert body["spentCents"] == 100
    assert costs_mod.spent_this_month(pid) == 100


def test_global_limit_blocks_even_when_confirmed(store):
    costs_mod.set_limit("global", 50)
    status, body = call({"providerId": "test-story-paid",
                         "prompt": "too rich", "confirmed": True})
    assert status == 402, body
    assert body["error"]["code"] == "cost-blocked"
    assert body["quote"]["cents"] == 100


def test_unknown_cost_needs_confirmation_then_records_zero(store):
    status, body = call({"providerId": "test-story-unknown",
                         "prompt": "a locked door"})
    assert status == 409, body
    assert body["error"]["code"] == "needs-confirmation"
    assert body["quote"]["cents"] is None
    status, body = call({"providerId": "test-story-unknown",
                         "prompt": "a locked door", "confirmed": True})
    assert status == 201, body
    assert body["spentCents"] == 0
    assert body["usage"]["promptTokens"] == 7
    assert body["usage"]["completionTokens"] == 12
    assert body["usage"]["textChars"] == len(body["text"])


def test_tuple_shape_usage_merged(store):
    status, body = call({"providerId": "test-story-tuple",
                         "prompt": "shapes"})
    assert status == 201, body
    assert body["text"] == "Tuple tale."
    assert body["usage"]["backend"] == "tuple"


# --------------------------------------------------------------------------
# Failure mapping (NFR-003: failure writes nothing)
# --------------------------------------------------------------------------

def test_image_only_provider_is_502(store):
    status, body = call({"providerId": "test-story-image-only",
                         "prompt": "no words"})
    assert status == 502, body
    assert body["error"]["code"] == "provider-error"
    assert "does not support text generation" in body["error"]["message"]


def test_provider_outage_is_502_with_no_spend(store):
    status, body = call({"providerId": "test-story-outage",
                         "prompt": "doomed"})
    assert status == 502, body
    assert body["error"]["code"] == "provider-error"
    from kgsm import db as db_mod
    conn = db_mod.connect()
    try:
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM spend_ledger").fetchone()["n"]
    finally:
        conn.close()
    assert count == 0


# --------------------------------------------------------------------------
# story.generate_text unit checks
# --------------------------------------------------------------------------

def test_generate_text_rejects_garbage_shapes():
    from kgsm.providers import get_provider

    mock = get_provider("mock")

    class Bad:
        id = "bad"

        def generate_text(self, prompt, genre=None):
            return 42

    with pytest.raises(story_mod.StoryError):
        story_mod.generate_text(Bad(), "x")
    text, usage = story_mod.generate_text(mock, "  padded  ", None)
    assert "padded" in text
    assert usage["promptChars"] == len("  padded  ")


def test_generate_text_wraps_unexpected_errors():
    class Boom:
        id = "boom"

        def generate_text(self, prompt, genre=None):
            raise ValueError("kaboom")

    with pytest.raises(story_mod.StoryError, match="kaboom"):
        story_mod.generate_text(Boom(), "x")
