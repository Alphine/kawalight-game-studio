"""REAL-game playtest staging + file serving (stdlib only).

POST staging reuses the exporter's :func:`stage_export` — the staged bytes
are identical to a playable export — into ``<project>/builds/playtest/``.
GET serving reads staged files back through a strict containment guard.

Serve replies are the one non-JSON exception in the API: RAW BYTES
with the staged file's MIME type (``api.RawBody``), so a Playtest
iframe can load the staged game directly. Serve failures stay JSON.
Serve contract: ``docs/playtest.md``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .exporters import stage_export
from .exporters.manifest import assert_no_secrets_in_dir

PLAYTEST_DIRNAME = "playtest"

FALLBACK_CONTENT_TYPE = "application/octet-stream"

# Explicit table (deterministic on every OS; ``mimetypes`` varies by
# platform/registry). Text types carry an explicit charset.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
}


class PlaytestError(Exception):
    """A playtest failure. Serve failures are always 404 (never 400/500),
    so escapes, symlinks, and genuinely missing files are
    indistinguishable."""

    def __init__(self, message: str, *, code: str = "playtest-not-found",
                 status: int = 404) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def staged_dir(project_dir: str | Path) -> Path:
    return Path(project_dir) / "builds" / PLAYTEST_DIRNAME


def content_type_for(filename: str) -> str:
    return MIME_TYPES.get(Path(filename).suffix.lower(),
                          FALLBACK_CONTENT_TYPE)


def stage_playtest(
    *, project_name: str, genre: str, config: dict,
    project_dir: str | Path,
    template_dir: str | Path | None = None,
    runtime_dir: str | Path | None = None,
) -> dict:
    """Stage the stored config into ``builds/playtest/`` (fresh each time).

    ``stage_export`` removes the output dir first, so a rebuild overwrites
    cleanly and can never leave stale files behind. The staged tree is
    secret-scanned exactly like an export (NFR-002): a stored secret
    value anywhere in the staged bytes fails staging with
    ``ManifestError`` (the route renders it as 502 ``export-error``)
    instead of serving the secret over localhost.
    """
    project_dir = Path(project_dir)
    staged = stage_export(
        project_name=project_name, genre=genre, config=config,
        project_dir=project_dir, template_dir=template_dir,
        runtime_dir=runtime_dir, out_dir=staged_dir(project_dir),
        variant="playable")
    assert_no_secrets_in_dir(staged["dir"])
    staged["stagedAt"] = datetime.now(timezone.utc).isoformat()
    return staged


def resolve_staged_file(staged: Path, rel: str) -> Path:
    """Resolve a playtest-relative path inside the staged dir.

    Strict guard (all failures raise 404 ``PlaytestError``):
    no ``..``/``.``/empty segments, no absolute paths, no backslashes,
    no NUL, every path component symlink-free, and the resolved target
    must be a regular file inside the staged dir (no directory listing).

    This intentionally does NOT reuse ``api.resolve_inside``: that helper
    reports escapes as 400 ``path-escape``, while the playtest serve
    contract answers every serve failure with 404.
    """
    if not isinstance(rel, str) or not rel or "\x00" in rel:
        raise PlaytestError(f"playtest file not found: {rel!r}")
    if "\\" in rel or rel.startswith("/"):
        raise PlaytestError(f"playtest file not found: {rel!r}")
    if len(rel) >= 2 and rel[1] == ":":
        raise PlaytestError(f"playtest file not found: {rel!r}")
    parts = rel.split("/")
    for segment in parts:
        if not segment or segment in (".", ".."):
            raise PlaytestError(f"playtest file not found: {rel!r}")

    staged = Path(staged)
    if staged.is_symlink():
        raise PlaytestError(f"playtest file not found: {rel!r}")
    full = staged
    for segment in parts:
        full = full / segment
        # Never follow a planted symlink: check each level lexically.
        if full.is_symlink():
            raise PlaytestError(f"playtest file not found: {rel!r}")
        if not full.exists():
            raise PlaytestError(f"playtest file not found: {rel!r}")
    if not full.is_file():
        raise PlaytestError(f"playtest file not found: {rel!r}")
    # Defense in depth: the resolved target must stay inside the staged
    # dir even if the filesystem surprises the lexical walk above.
    resolved = full.resolve()
    staged_resolved = staged.resolve()
    if resolved != staged_resolved and \
            staged_resolved not in resolved.parents:
        raise PlaytestError(f"playtest file not found: {rel!r}")
    return full


def read_staged_file(staged: Path, rel: str) -> tuple[bytes, str]:
    """Read a staged file, returning ``(bytes, content_type)``."""
    path = resolve_staged_file(staged, rel)
    try:
        data = path.read_bytes()
    except OSError:
        raise PlaytestError(f"playtest file not found: {rel!r}") from None
    return data, content_type_for(path.name)
