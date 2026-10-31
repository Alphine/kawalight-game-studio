"""Regression tests for worker audit findings (critical/high + mediums).

Dispatch-based (no sockets) so they stay green where listen() is blocked.
"""

import json
import re
import zipfile

import pytest
from PIL import Image

from kgsm import audio as audio_mod
from kgsm import backup as backup_mod
from kgsm import costs as costs_mod
from kgsm import projects as projects_mod
from kgsm import secrets as secrets_mod
from kgsm.api import Request, check_segment
from kgsm.api.server import _allowed_origin, dispatch
from kgsm.api.server import main as api_main
from kgsm.assets import import_asset
from kgsm.assets.pipeline import save_frames
from kgsm.exporters.manifest import ManifestError
from kgsm.exporters.phaser import export_zip
from kgsm.providers import ProviderError
from kgsm.providers.mock import MockProvider
from kgsm.providers.openai_compat import OpenAICompatProvider
from test_config_validator import make_blueprint, make_farm_config


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


def make_png(path, size=(16, 16)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, (10, 120, 200)).save(path)
    return path


# --------------------------------------------------------------------------
# backup: traversal id, tamper check, no-orphan-dir
# --------------------------------------------------------------------------

def _craft_zip(folder, stem, record, extra=None):
    target = folder / f"{stem}.zip"
    with zipfile.ZipFile(target, "w") as zf:
        zf.writestr("project.json", json.dumps(record))
        for name, data in (extra or {}).items():
            zf.writestr(name, data)
    return stem


def _record(pid, **overrides):
    base = {"id": pid, "name": "R", "genre": "space-shooter",
            "state": "draft", "stateReason": "", "archived": False}
    base.update(overrides)
    return base


def test_restore_malicious_id_mints_safe_id(store):
    stem = _craft_zip(backup_mod.backups_dir(), "evil-20260101T000000Z",
                      _record("../../evil"))
    before = set(store["projects_dir"].iterdir()) \
        if store["projects_dir"].exists() else set()
    result = backup_mod.restore_backup(stem)
    assert result["reassignedId"] is True
    assert re.match(r"^[0-9a-f]{12}$", result["project"].id)
    assert result["project"].dir.parent == store["projects_dir"].resolve() \
        or result["project"].dir.parent == store["projects_dir"]
    assert set(store["projects_dir"].iterdir()) - before == \
        {result["project"].dir}
    assert not (store["projects_dir"].parent / "evil").exists()


def test_restore_tampered_zip_fails_closed(store):
    project = projects_mod.create("Tamper", "space-shooter")
    made = backup_mod.create_backup(project.id)
    zip_path = backup_mod.backups_dir() / f"{made['backupId']}.zip"
    blob = bytearray(zip_path.read_bytes())
    blob[len(blob) // 2] ^= 0xFF
    zip_path.write_bytes(bytes(blob))
    with pytest.raises(backup_mod.BackupError, match="[Ss]ha256|tamper|corrupt"):
        backup_mod.restore_backup(made["backupId"])


def test_restore_unsafe_zip_leaves_no_orphan_dir(store):
    stem = _craft_zip(backup_mod.backups_dir(), "slip-20260101T000000Z",
                      _record("ab12cd34ef56"),
                      {"../../evil.txt": "pwned"})
    before = set(store["projects_dir"].iterdir()) \
        if store["projects_dir"].exists() else set()
    with pytest.raises(backup_mod.BackupError):
        backup_mod.restore_backup(stem)
    after = set(store["projects_dir"].iterdir()) \
        if store["projects_dir"].exists() else set()
    assert after == before


# --------------------------------------------------------------------------
# export routes: genre match, non-object config, secret scan
# --------------------------------------------------------------------------

def test_export_genre_mismatch_is_422(store):
    pid = projects_mod.create("Demo", "space-shooter").id
    status, body = call("POST", f"/projects/{pid}/exports",
                        {"config": make_farm_config()})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


def test_export_non_object_stored_config_is_coded_500(store):
    pid = projects_mod.create("Demo", "space-shooter").id
    project = projects_mod.get(pid)
    (project.dir / "config.json").write_text("[1, 2]", encoding="utf-8")
    status, body = call("POST", f"/projects/{pid}/exports", {})
    assert status == 500
    assert body["error"]["code"] == "internal"


def test_export_zip_scans_full_staged_plaintext(store, tmp_path):
    secrets_mod.set_secret("k", "[SEVERE_LEAK_MARKER_9f8e]")
    staged = tmp_path / "staged"
    (staged / "assets").mkdir(parents=True)
    (staged / "config.json").write_text("{}", encoding="utf-8")
    (staged / "assets" / "note.txt").write_text(
        "prefix [SEVERE_LEAK_MARKER_9f8e] suffix", encoding="utf-8")
    with pytest.raises(ManifestError, match="secret"):
        export_zip(staged, tmp_path / "builds" / "out.zip")
    assert not (tmp_path / "builds" / "out.zip").exists()


def test_export_zip_clean_staged_dir_publishes(store, tmp_path):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "index.html").write_text("game", encoding="utf-8")
    out = export_zip(staged, tmp_path / "builds" / "out.zip")
    assert out.is_file()


def test_put_blueprint_genre_mismatch_is_422(store):
    pid = projects_mod.create("Farm", "farming").id
    status, body = call("PUT", f"/projects/{pid}/blueprint",
                        {"blueprint": make_blueprint()})
    assert status == 422
    assert body["error"]["code"] == "validation-failed"


# --------------------------------------------------------------------------
# costs: structured block flag (no substring matching)
# --------------------------------------------------------------------------

def test_quote_block_flag_and_authorize(store):
    secrets_mod.set_secret("openai_compat_price_cents_per_image", "10")
    costs_mod.set_limit("global", 5)
    quote = costs_mod.quote("openai-compat", 2, project_id="p1")
    assert quote.cents == 20
    assert quote.blocked is True
    with pytest.raises(costs_mod.CostError):
        costs_mod.authorize(quote, confirmed=True)  # blocked beats confirm
    status, body = call("POST", "/costs/authorize",
                        {"providerId": "openai-compat", "nImages": 2,
                         "projectId": "p1", "confirmed": True})
    assert status == 402
    assert body["error"]["code"] == "cost-blocked"


def test_quote_not_blocked_without_limits(store):
    quote = costs_mod.quote("mock", 2, project_id="p1")
    assert quote.blocked is False


# --------------------------------------------------------------------------
# segments + secrets
# --------------------------------------------------------------------------

def test_check_segment_rejects_metachars(store):
    from kgsm.api import ApiError

    assert check_segment("Abc-123_x", "role") == "Abc-123_x"
    for bad in ("a:b", "a*b", "a?b", "has space", ".hidden", "-lead",
                "x" * 65, "semi;colon", "quo'te", 'dq"ot'):
        with pytest.raises(ApiError) as excinfo:
            check_segment(bad, "role")
        assert excinfo.value.code == "path-escape"


def test_secret_names_validated_and_stripped(store):
    with pytest.raises(ValueError):
        secrets_mod.set_secret("bad name!", "v")
    with pytest.raises(ValueError):
        secrets_mod.set_secret("", "v")
    secrets_mod.set_secret("  spaced  ", "v")
    assert secrets_mod.get_secret("spaced") == "v"
    assert secrets_mod.delete_secret("  spaced  ") is True
    status, body = call("PUT", "/secrets/bad name", {"value": "v"})
    assert status == 400
    status, body = call("DELETE", "/secrets/bad name", {})
    assert status == 400


def test_corrupt_secrets_store_quarantined(store):
    secrets_mod.set_secret("k", "v")
    path = store["data_dir"] / "secrets.json"
    path.write_text("{oops", encoding="utf-8")
    with pytest.raises(secrets_mod.SecretError):
        secrets_mod.get_secret("k")
    quarantined = list(store["data_dir"].glob("secrets.json.corrupt-*"))
    assert len(quarantined) == 1
    # redact() stays total even with a corrupt store.
    assert secrets_mod.redact("abc") == "abc"


def test_redact_masks_percent_encoded(store):
    secrets_mod.set_secret("k", "a/b c")
    assert secrets_mod.redact("next=a%2Fb%20c") == "next=***"


# --------------------------------------------------------------------------
# imports: symlink + data-dir guard, no overwrite, stale frames
# --------------------------------------------------------------------------

def test_import_rejects_symlink(store, tmp_path):
    real = make_png(tmp_path / "real.png")
    link = tmp_path / "link.png"
    try:
        link.symlink_to(real)
    except OSError:
        pytest.skip("symlinks unavailable here")
    project_dir = store["projects_dir"] / "p1"
    with pytest.raises(Exception, match="[Ss]ymlink"):
        import_asset(project_dir, link, entity="e", role="r")


def test_import_rejects_worker_data_dir(store):
    src = make_png(store["data_dir"] / "evil.png")
    project_dir = store["projects_dir"] / "p1"
    with pytest.raises(Exception, match="[Dd]ata dir"):
        import_asset(project_dir, src, entity="e", role="r")
    with pytest.raises(audio_mod.AudioError, match="[Dd]ata dir"):
        audio_mod.import_audio(project_dir, src, role="r")


def test_import_twice_keeps_both(store, tmp_path):
    src = make_png(tmp_path / "ship.png")
    project_dir = store["projects_dir"] / "p1"
    first = import_asset(project_dir, src, entity="ship", role="body")
    second = import_asset(project_dir, src, entity="ship", role="body")
    assert first["path"].replace("\\", "/") == "assets/ship/body-ship.png"
    assert second["path"] != first["path"]
    assert (project_dir / first["path"]).exists()
    assert (project_dir / second["path"]).exists()


def test_reslice_clears_stale_frames(store, tmp_path):
    from kgsm.assets.pipeline import slice_sheet  # noqa: F401 (doc anchor)

    project_dir = store["projects_dir"] / "p1"
    sheet = make_png(tmp_path / "sheet.png", size=(64, 32))
    save_frames(project_dir, sheet, entity="ship", animation="fly",
                frame_rate=10, frame_width=16, frame_height=16)
    folder = project_dir / "assets" / "ship" / "fly"
    assert len(list(folder.glob("frame-*.png"))) == 8
    save_frames(project_dir, sheet, entity="ship", animation="fly",
                frame_rate=10, frame_width=32, frame_height=32)
    assert sorted(p.name for p in folder.glob("frame-*.png")) == \
        ["frame-000.png", "frame-001.png"]


# --------------------------------------------------------------------------
# providers: mock dims, openai https + SSRF
# --------------------------------------------------------------------------

def test_mock_validates_dimensions(store):
    provider = MockProvider()
    with pytest.raises(ProviderError):
        provider.generate("x", style="pixel-art", width=0, height=16)
    with pytest.raises(ProviderError):
        provider.generate("x", style="pixel-art", width=16, height=5000)


def test_openai_base_url_requires_tls_off_loopback(store):
    provider = OpenAICompatProvider(api_key="k",
                                    base_url="http://example.com/v1")
    with pytest.raises(ProviderError, match="https"):
        provider.generate("x", style="pixel-art", width=16, height=16)


def test_openai_fetch_blocks_private_hosts(store):
    provider = OpenAICompatProvider(api_key="k")
    for url in ("http://127.0.0.1/x.png",
                "http://169.254.169.254/latest",
                "http://10.0.0.5/x.png",
                "http://localhost/x.png"):
        with pytest.raises(ProviderError, match="not allowed|invalid"):
            provider._fetch_url(url, 0)


# --------------------------------------------------------------------------
# server: null origin, host allowlist; CLI: clean input errors
# --------------------------------------------------------------------------

def test_null_origin_never_allowed():
    assert _allowed_origin("null") is None
    assert _allowed_origin(None) is None
    assert _allowed_origin("http://127.0.0.1:3000") == \
        "http://127.0.0.1:3000"


def test_api_host_guard_rejects_lan():
    with pytest.raises(SystemExit):
        api_main(["--host", "192.168.1.2"])
    with pytest.raises(SystemExit):
        api_main(["--host", "0.0.0.0"])


def test_cli_reports_bad_input_cleanly(store, tmp_path, capsys):
    from kgsm.__main__ import main

    assert main(["validate", "config",
                 str(tmp_path / "missing.json")]) == 1
    err = capsys.readouterr().err
    assert "error:" in err and "Traceback" not in err
    bad = tmp_path / "bad.json"
    bad.write_text("{oops", encoding="utf-8")
    assert main(["assemble", str(bad), "-o", str(tmp_path / "o.json")]) == 1
    assert main(["validate", "config", str(bad)]) == 1
