"""Cost control: quotes, confirmations, spend limits (FR-009, FR-022, NFR-011).

Unknown cost always requires explicit confirmation. No unbounded retries or
batch generation: n_images is capped per quote and every billable call passes
through authorize() first.
"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone

from . import db as dbmod

MAX_IMAGES_PER_QUOTE = 16

# One shared lock for every quote→authorize→generate→record_spend flow
# (asset AND story routes). Per-module locks let a concurrent asset+story
# pair both pass limits and both spend (TOCTOU overspend), and let
# generated-file numbering collide. The lock is intentionally held across
# the provider network call: narrowing it to quote→authorize would reopen
# the overspend window (authorize-then-generate races) and the numbering
# race, trading correctness for throughput on a localhost single-user box.
spend_lock = threading.Lock()


class CostError(Exception):
    pass


@dataclass(frozen=True)
class Quote:
    provider_id: str
    project_id: str | None
    n_images: int
    cents: int | None  # None = unknown cost
    needs_confirmation: bool
    reason: str
    blocked: bool = False  # True when a spend limit is exceeded (never confirmable)


def _month_prefix() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def set_limit(scope: str, cents: int | None, conn: sqlite3.Connection | None = None) -> None:
    """scope: 'global' or 'project:<id>'. None clears the limit."""
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        if cents is None:
            conn.execute("DELETE FROM settings WHERE key = ?", (f"limit.{scope}",))
        else:
            if cents < 0:
                raise CostError("limit must be >= 0")
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (f"limit.{scope}", str(cents)),
            )
        conn.commit()
    finally:
        if own:
            conn.close()


def get_limit(scope: str, conn: sqlite3.Connection | None = None) -> int | None:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (f"limit.{scope}",)
        ).fetchone()
        return int(row["value"]) if row else None
    finally:
        if own:
            conn.close()


def record_spend(
    cents: int, label: str, project_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> None:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        scope = f"project:{project_id}" if project_id else "global"
        conn.execute(
            "INSERT INTO spend_ledger (scope, project_id, amount_cents, label, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (scope, project_id, cents, label,
             datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        if own:
            conn.close()


def spent_this_month(
    project_id: str | None = None, conn: sqlite3.Connection | None = None
) -> int:
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        if project_id is None:
            row = conn.execute(
                "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM spend_ledger"
                " WHERE substr(created_at, 1, 7) = ?",
                (_month_prefix(),),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM spend_ledger"
                " WHERE project_id = ? AND substr(created_at, 1, 7) = ?",
                (project_id, _month_prefix()),
            ).fetchone()
        return int(row["total"])
    finally:
        if own:
            conn.close()


def _limit_reasons(
    cents: int | None, project_id: str | None,
    conn: sqlite3.Connection,
) -> list[str]:
    """Spend-limit violations for a quote (shared priced/unknown path).

    Priced quotes block when the new spend would exceed a limit; unknown
    quotes (``cents`` None) block when spend is already at/over a limit,
    so limits still engage on unpriced providers.
    """
    reasons = []
    if project_id:
        limit = get_limit(f"project:{project_id}", conn)
        if limit is not None:
            spent = spent_this_month(project_id, conn)
            if (spent >= limit if cents is None
                    else spent + cents > limit):
                reasons.append("exceeds project monthly limit")
    glimit = get_limit("global", conn)
    if glimit is not None:
        gspent = spent_this_month(None, conn)
        if (gspent >= glimit if cents is None
                else gspent + cents > glimit):
            reasons.append("exceeds global monthly limit")
    return reasons


def quote(
    provider_id: str, n_images: int, project_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> Quote:
    from .providers import get_provider  # deferred: registry import cost is trivial

    if n_images < 1 or n_images > MAX_IMAGES_PER_QUOTE:
        raise CostError(f"n_images must be 1..{MAX_IMAGES_PER_QUOTE}")
    provider = get_provider(provider_id)
    cents = provider.estimate_cents(n_images)
    if cents is None:
        own = conn is None
        conn = conn or dbmod.connect()
        try:
            reasons = _limit_reasons(None, project_id, conn)
        finally:
            if own:
                conn.close()
        if reasons:
            return Quote(provider_id, project_id, n_images, None, True,
                         "; ".join(reasons), blocked=True)
        return Quote(provider_id, project_id, n_images, None, True,
                     "cost unknown: confirmation required")
    if cents == 0:
        return Quote(provider_id, project_id, n_images, 0, False, "free")
    own = conn is None
    conn = conn or dbmod.connect()
    try:
        reasons = _limit_reasons(cents, project_id, conn)
    finally:
        if own:
            conn.close()
    if reasons:
        return Quote(provider_id, project_id, n_images, cents, True,
                     "; ".join(reasons), blocked=True)
    return Quote(provider_id, project_id, n_images, cents, True,
                 "paid generation: confirmation required")


def authorize(quote_: Quote, confirmed: bool) -> None:
    if quote_.blocked:
        raise CostError(f"generation blocked: {quote_.reason}")
    if quote_.needs_confirmation and not confirmed:
        raise CostError(f"generation blocked: {quote_.reason}")
