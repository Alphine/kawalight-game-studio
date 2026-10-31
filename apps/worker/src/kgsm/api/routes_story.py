"""Story routes (contract §13; NEW).

``POST /stories/generate`` produces lore/story/dialogue text via a
text-capable provider. Cost-guarded exactly like asset generation (§4):
the handler re-quotes (one story = one billable unit), enforces
``authorize`` (unconfirmed paid/unknown cost → ``409 needs-confirmation``
or ``402 cost-blocked`` with the quote attached), then generates and
``record_spend``s actuals. ``providerId`` defaults to ``mock`` for
deterministic offline placeholders; any registered provider exposing
``generate_text`` works as a real backend (see ``story.py``).
"""

from __future__ import annotations

import threading

from .. import costs as costs_mod
from .. import projects as projects_mod
from .. import story as story_mod
from ..providers import ProviderError, get_provider
from . import (
    ApiError,
    Request,
    bad_request,
    need_str,
    opt_bool,
    quote_to_dict,
)

# Serializes generate_story's quote→authorize→generate→record_spend flow so
# concurrent ThreadingHTTPServer requests cannot both pass limits and both
# spend (TOCTOU overspend). Mirrors routes_assets._GENERATE_LOCK.
_GENERATE_LOCK = threading.Lock()


def generate_story(req: Request) -> tuple[int, dict]:
    body = req.body
    provider_id = body.get("providerId", "mock")
    if not isinstance(provider_id, str) or not provider_id:
        raise bad_request("providerId must be a non-empty string")
    prompt = need_str(body, "prompt")
    if not prompt.strip():
        raise bad_request("prompt must not be empty")
    if len(prompt) > story_mod.MAX_PROMPT_CHARS:
        raise bad_request(
            f"prompt must be <= {story_mod.MAX_PROMPT_CHARS} characters")
    genre = body.get("genre")
    if genre is not None:
        if not isinstance(genre, str) or not genre.strip():
            raise bad_request("genre must be a non-empty string")
        if len(genre) > story_mod.MAX_GENRE_CHARS:
            raise bad_request(
                f"genre must be <= {story_mod.MAX_GENRE_CHARS} characters")
        genre = genre.strip()
    project_id = body.get("projectId")
    if project_id is not None:
        if not isinstance(project_id, str) or not project_id:
            raise bad_request("projectId must be a non-empty string")
        try:
            projects_mod.get(project_id)
        except projects_mod.ProjectError:
            raise ApiError("project-not-found",
                           f"project {project_id!r} not found", 404) from None
    confirmed = opt_bool(body, "confirmed", False)

    with _GENERATE_LOCK:
        try:
            quote = costs_mod.quote(provider_id, 1,
                                    project_id=project_id)
        except ProviderError as exc:
            raise ApiError("unknown-provider", str(exc), 404) from None
        except costs_mod.CostError as exc:
            raise ApiError("bad-request", str(exc), 400) from None
        try:
            costs_mod.authorize(quote, confirmed)
        except costs_mod.CostError as exc:
            message = str(exc)
            quoted = {"quote": quote_to_dict(quote)}
            if quote.blocked:
                raise ApiError("cost-blocked", message, 402, quoted) from None
            raise ApiError("needs-confirmation", message, 409,
                           quoted) from None

        provider = get_provider(provider_id)
        try:
            text, usage = story_mod.generate_text(
                provider, prompt, genre)
        except ProviderError as exc:
            raise ApiError("provider-error", str(exc), 502) from None
        except story_mod.StoryError as exc:
            raise ApiError("provider-error", str(exc), 502) from None
        spent = quote.cents if quote.cents is not None else 0
        costs_mod.record_spend(
            spent, f"generate story via {provider_id}",
            project_id=project_id)
        return 201, {"text": text, "provider": provider_id,
                     "model": provider.model, "usage": usage,
                     "quote": quote_to_dict(quote), "spentCents": spent}


ROUTES = [
    ("POST", r"/stories/generate", generate_story),
]
