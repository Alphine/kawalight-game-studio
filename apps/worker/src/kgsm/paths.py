"""Filesystem layout resolution. Env vars are read on every call so tests can
redirect storage with monkeypatch without reimporting.

Frozen builds (PyInstaller sidecar) carry schemas/templates inside the bundle
(``sys._MEIPASS/kgsm_data``) and keep writable data under a per-user folder,
since the install location is not writable.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _frozen_base() -> Path | None:
    base = getattr(sys, "_MEIPASS", None)
    return Path(base) / "kgsm_data" if base else None


def repo_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    here = Path(__file__).resolve()
    for parent in (here, *here.parents):
        if (parent / "packages" / "schemas").is_dir():
            return parent
    raise RuntimeError("KGSM repo root not found above " + str(here))


def _user_data_root() -> Path:
    override = os.environ.get("KGSM_HOME")
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(local) / "KawalightStudioMaker"


def schemas_dir() -> Path:
    frozen = _frozen_base()
    if frozen is not None:
        return frozen / "schemas"
    return repo_root() / "packages" / "schemas"


def templates_dir() -> Path:
    frozen = _frozen_base()
    if frozen is not None:
        return frozen / "templates"
    return repo_root() / "packages" / "templates"


def projects_dir() -> Path:
    override = os.environ.get("KGSM_PROJECTS_DIR")
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        return _user_data_root() / "projects"
    return repo_root() / "projects"


def data_dir() -> Path:
    override = os.environ.get("KGSM_DATA_DIR")
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        return _user_data_root() / "data"
    return repo_root() / ".kgsm"


def db_path() -> Path:
    return data_dir() / "kgsm.db"
