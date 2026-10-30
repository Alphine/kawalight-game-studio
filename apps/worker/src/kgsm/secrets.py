"""Local credential store (FR-008, NFR-002).

Keys live in one file under the worker data dir with owner-only permissions.
Values are never listed, logged, or copied into builds — use list_secret_names()
for UI display and redact() before writing any text to logs.
"""

from __future__ import annotations

import json
import os

from . import paths

_FILE = "secrets.json"


def _path():
    p = paths.data_dir() / _FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load() -> dict[str, str]:
    p = _path()
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _save(data: dict[str, str]) -> None:
    p = _path()
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass  # best effort on filesystems without posix perms


def set_secret(name: str, value: str) -> None:
    name = name.strip()
    if not name:
        raise ValueError("secret name must not be empty")
    data = _load()
    data[name] = value
    _save(data)


def get_secret(name: str) -> str | None:
    return _load().get(name)


def delete_secret(name: str) -> bool:
    data = _load()
    if name not in data:
        return False
    del data[name]
    _save(data)
    return True


def list_secret_names() -> list[str]:
    return sorted(_load())


def redact(text: str, values: list[str] | None = None) -> str:
    secrets = values if values is not None else list(_load().values())
    for v in secrets:
        if v:
            text = text.replace(v, "***")
    return text
