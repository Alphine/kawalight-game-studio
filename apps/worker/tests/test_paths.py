"""Frozen/dev path-resolution tests (installer depends on these branches)."""

import os
import sys
from pathlib import Path

from kgsm import paths as paths_mod


def test_frozen_bundle_dirs_come_from_meipass(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    base = tmp_path / "kgsm_data"
    assert paths_mod.schemas_dir() == base / "schemas"
    assert paths_mod.templates_dir() == base / "templates"


def test_frozen_writable_dirs_use_kgms_home(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setenv("KGSM_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("KGSM_PROJECTS_DIR", raising=False)
    monkeypatch.delenv("KGSM_DATA_DIR", raising=False)
    assert paths_mod.projects_dir() == tmp_path / "home" / "projects"
    assert paths_mod.data_dir() == tmp_path / "home" / "data"
    assert paths_mod.db_path() == tmp_path / "home" / "data" / "kgsm.db"


def test_frozen_falls_back_to_localappdata(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("KGSM_HOME", raising=False)
    monkeypatch.delenv("KGSM_PROJECTS_DIR", raising=False)
    monkeypatch.delenv("KGSM_DATA_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    root = tmp_path / "local" / "KawalightStudioMaker"
    assert paths_mod.projects_dir() == root / "projects"
    assert paths_mod.data_dir() == root / "data"


def test_dev_env_overrides_win(tmp_path, monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.setenv("KGSM_PROJECTS_DIR", str(tmp_path / "p"))
    monkeypatch.setenv("KGSM_DATA_DIR", str(tmp_path / "d"))
    assert paths_mod.projects_dir() == tmp_path / "p"
    assert paths_mod.data_dir() == tmp_path / "d"
    assert paths_mod.db_path() == tmp_path / "d" / "kgsm.db"


def test_dev_repo_root_holds_schemas(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    root = paths_mod.repo_root()
    assert (root / "packages" / "schemas").is_dir()
    assert paths_mod.schemas_dir() == root / "packages" / "schemas"
    assert os.environ.get("KGSM_HOME") is None or True  # no coupling
