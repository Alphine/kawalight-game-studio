"""Local credential store (FR-008, NFR-002).

Keys live in one file under the worker data dir with owner-only permissions.
Values are never listed, logged, or copied into builds — use list_secret_names()
for UI display and redact() before writing any text to logs.

Storage note: values are stored plaintext in ``secrets.json``; the 0o600
chmod is best-effort and a no-op on Windows (no POSIX permission bits),
so on Windows the file relies on the user's profile ACL alone. A caller
needing stronger at-rest protection should layer OS keychain/DPAPI file
encryption on top; this module deliberately stays dependency-free.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from urllib.parse import quote

from . import paths

_FILE = "secrets.json"

# API keys are short; an unbounded value would bloat secrets.json and slow
# every redact()/secret-scan that walks all values.
MAX_VALUE_CHARS = 16 * 1024

_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class SecretError(Exception):
    """The secrets store itself is unreadable (e.g. corrupt JSON)."""


def _path():
    p = paths.data_dir() / _FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _normalize_name(name: str) -> str:
    """Strip and validate a secret name (shared by set/get/delete)."""
    if not isinstance(name, str):
        raise ValueError("secret name must be a string")
    cleaned = name.strip()
    if not cleaned or not _NAME_RE.match(cleaned):
        raise ValueError(
            f"invalid secret name {name!r}: use 1+ of A-Z a-z 0-9 _ . -")
    return cleaned


def _load() -> dict[str, str]:
    p = _path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        # Quarantine the corrupt file (kept for forensics) and fail
        # closed with a typed error instead of a bare 500/JSON traceback.
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        try:
            p.rename(p.with_name(f"{_FILE}.corrupt-{stamp}"))
        except OSError:
            pass
        raise SecretError(f"secrets store is corrupt: {exc}") from None
    if not isinstance(data, dict):
        raise SecretError("secrets store is corrupt: top level must be "
                          "an object")
    return data


def _save(data: dict[str, str]) -> None:
    p = _path()
    # Atomic write: a crash mid-save must never leave a half-written store.
    fd, tmp_name = tempfile.mkstemp(dir=str(p.parent), prefix=_FILE + ".",
                                    suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(data, indent=2))
        os.replace(tmp_name, p)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass  # best effort on filesystems without posix perms


def set_secret(name: str, value: str) -> None:
    name = _normalize_name(name)
    if not isinstance(value, str):
        raise ValueError("secret value must be a string")
    if len(value) > MAX_VALUE_CHARS:
        raise ValueError(
            f"secret value must be <= {MAX_VALUE_CHARS} characters")
    data = _load()
    data[name] = value
    _save(data)


def get_secret(name: str) -> str | None:
    return _load().get(_normalize_name(name))


def delete_secret(name: str) -> bool:
    name = _normalize_name(name)
    data = _load()
    if name not in data:
        return False
    del data[name]
    _save(data)
    return True


def list_secret_names() -> list[str]:
    return sorted(_load())


def redact(text: str, values: list[str] | None = None) -> str:
    # Total function: logging must never crash, even on a corrupt store.
    try:
        secrets = values if values is not None else list(_load().values())
    except SecretError:
        return text
    for v in secrets:
        if v:
            text = text.replace(v, "***")
            # Percent-encoded occurrences (logged paths/queries) leak too.
            text = text.replace(quote(v, safe=""), "***")
            if "/" in v:
                text = text.replace(quote(v), "***")
    return text
