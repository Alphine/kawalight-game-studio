"""Story/text generation: lore, stories, and dialogue drafts (NEW).

Cost-guarded exactly like asset generation: callers must ``costs.quote`` and
``costs.authorize`` before :func:`generate_text`, then ``costs.record_spend``
actuals (one story counts as a single billable unit). Stdlib only.

Provider dispatch is duck-typed so ``providers/`` needs no changes: any
registered provider exposing ``generate_text(prompt, genre=...)`` is used as
a real text backend; the ``mock`` provider falls back to a deterministic
offline placeholder; anything else raises :class:`StoryError`.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .providers.base import ProviderError

MAX_PROMPT_CHARS = 8000
MAX_GENRE_CHARS = 64
MAX_TEXT_CHARS = 65536  # provider-returned text is truncated past this


class StoryError(Exception):
    pass


_TEMPLATES = (
    "Once upon a {genre} quest, it is told that {prompt}. "
    "The heroes pressed on through peril and wonder, "
    "and the realm remembered their names.",
    "In a land of {genre} wonders, the old tales speak of {prompt}. "
    "What happened next became the adventure the bards still sing of.",
    "Chronicle of the {genre} age: {prompt}. "
    "Few believed it at first, yet the story outlived them all.",
)


def placeholder_story(prompt: str, genre: str | None = None) -> str:
    """Deterministic offline placeholder text (mock provider).

    Same ``(prompt, genre)`` always yields the same text; no network, no
    randomness beyond a sha256-derived template pick.
    """
    label = genre.strip() if genre and genre.strip() else "faraway"
    digest = hashlib.sha256(
        f"{label}\0{prompt}".encode("utf-8")).digest()
    template = _TEMPLATES[digest[0] % len(_TEMPLATES)]
    return template.format(genre=label, prompt=prompt.strip())


def _coerce_result(result: Any) -> tuple[str, dict]:
    """Normalize a text provider's return value to ``(text, usage)``."""
    usage: Any = {}
    if isinstance(result, str):
        text = result
    elif isinstance(result, dict):
        text = result.get("text")
        usage = result.get("usage", {})
    elif isinstance(result, (tuple, list)) and len(result) == 2:
        text, usage = result
    else:
        raise StoryError(
            "text provider returned an unsupported shape "
            f"(want str, dict, or (text, usage); got "
            f"{type(result).__name__})")
    if not isinstance(text, str) or not text.strip():
        raise StoryError("text provider returned empty text")
    if not isinstance(usage, dict):
        raise StoryError("text provider returned a non-object usage")
    for key, value in usage.items():
        if not isinstance(key, str):
            raise StoryError("text provider usage keys must be strings")
        if value is not None and not isinstance(
                value, (str, int, float, bool)):
            raise StoryError(
                f"text provider usage[{key!r}] is not JSON-serializable")
    return text, dict(usage)


def generate_text(
    provider: Any, prompt: str, genre: str | None = None,
) -> tuple[str, dict]:
    """Generate story text via *provider*.

    Returns ``(text, usage)`` where ``usage`` always carries
    ``promptChars``/``textChars`` plus any provider-supplied keys.
    Raises :class:`StoryError` when the provider has no text capability
    (other than ``mock``) or returns garbage; lets :class:`ProviderError`
    from the backend propagate untouched.
    """
    generate = getattr(provider, "generate_text", None)
    if callable(generate):
        try:
            result = generate(prompt, genre=genre)
        except (ProviderError, StoryError):
            raise
        except Exception as exc:  # noqa: BLE001 - mapped below
            raise StoryError(f"text generation failed: {exc}") from None
        text, usage = _coerce_result(result)
    elif getattr(provider, "id", None) == "mock":
        text, usage = placeholder_story(prompt, genre), {}
    else:
        raise StoryError(
            f"provider {getattr(provider, 'id', provider)!r} "
            "does not support text generation")
    if len(text) > MAX_TEXT_CHARS:
        # A runaway provider must not bloat the blueprint past its
        # maxLength (or the response past reason): truncate visibly.
        text = text[:MAX_TEXT_CHARS] + "\n\n[truncated: provider text " \
            f"exceeded {MAX_TEXT_CHARS} characters]"
    usage = dict(usage)
    usage["promptChars"] = len(prompt)
    usage["textChars"] = len(text)
    return text, usage
