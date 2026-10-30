import os
import sys
from pathlib import Path

import pytest

WORKER_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(WORKER_SRC))


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """Redirect worker storage to a temp dir for one test."""
    data_dir = tmp_path / "data"
    projects_dir = tmp_path / "projects"
    monkeypatch.setenv("KGSM_DATA_DIR", str(data_dir))
    monkeypatch.setenv("KGSM_PROJECTS_DIR", str(projects_dir))
    assert os.environ["KGSM_DATA_DIR"] == str(data_dir)
    return {"data_dir": data_dir, "projects_dir": projects_dir}
