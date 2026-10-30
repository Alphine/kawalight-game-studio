"""Ops API tests (contract §8 backup/restore + §9 audio import).

Exercises the real route handlers through ``server.dispatch`` (no sockets),
mirroring test_api_providers.py.
"""

import json
import wave
import zipfile
from pathlib import Path

from kgsm import backup as backup_mod
from kgsm import projects as projects_mod
from kgsm.api import Request
from kgsm.api.server import dispatch


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


def make_project_id(name="Ops Demo", genre="space-shooter"):
    return projects_mod.create(name, genre).id


def make_wav(path, *, seconds=0.5, rate=8000):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(b"\x00\x00" * int(seconds * rate))
    return path


# --------------------------------------------------------------------------
# §8 backup / restore
# --------------------------------------------------------------------------

def test_backup_create_and_list(store):
    pid = make_project_id()
    status, body = call("POST", f"/projects/{pid}/backup")
    assert status == 201, body
    assert set(body) == {"backupId", "projectId", "file", "sha256", "bytes",
                         "createdAt"}
    assert body["projectId"] == pid
    assert Path(body["file"]).is_file()

    status, body = call("GET", "/backups")
    assert status == 200, body
    assert len(body["backups"]) == 1
    assert body["backups"][0]["projectId"] == pid


def test_backup_unknown_project_is_404(store):
    status, body = call("POST", "/projects/nope/backup")
    assert status == 404
    assert body["error"]["code"] == "project-not-found"


def test_restore_roundtrip_after_delete(store):
    pid = make_project_id()
    _, made = call("POST", f"/projects/{pid}/backup")
    status, _ = call("DELETE", f"/projects/{pid}")
    assert status == 200

    status, body = call("POST", "/projects/restore",
                        {"backupId": made["backupId"]})
    assert status == 201, body
    assert body["project"]["id"] == pid
    assert body["reassignedId"] is False
    status, body = call("GET", f"/projects/{pid}")
    assert status == 200 and body["name"] == "Ops Demo"


def test_restore_collision_reassigns_id(store):
    pid = make_project_id()
    _, made = call("POST", f"/projects/{pid}/backup")
    status, body = call("POST", "/projects/restore",
                        {"backupId": made["backupId"]})
    assert status == 201, body
    assert body["project"]["id"] != pid
    assert body["reassignedId"] is True


def test_restore_errors(store):
    status, body = call("POST", "/projects/restore",
                        {"backupId": "missing-20260101T000000Z"})
    assert status == 404
    assert body["error"]["code"] == "backup-not-found"

    status, body = call("POST", "/projects/restore", {})
    assert status == 400 and body["error"]["code"] == "bad-request"

    corrupt = backup_mod.backups_dir() / "bad-20260101T000000Z.zip"
    corrupt.write_bytes(b"not a zip")
    status, body = call("POST", "/projects/restore",
                        {"backupId": "bad-20260101T000000Z"})
    assert status == 422
    assert body["error"]["code"] == "backup-error"

    no_record = backup_mod.backups_dir() / "norec-20260101T000000Z.zip"
    with zipfile.ZipFile(no_record, "w") as zf:
        zf.writestr("blueprint.json", "{}")
    status, body = call("POST", "/projects/restore",
                        {"backupId": "norec-20260101T000000Z"})
    assert status == 422
    assert body["error"]["code"] == "backup-error"


# --------------------------------------------------------------------------
# §9 audio import
# --------------------------------------------------------------------------

def test_audio_import_and_list(store, tmp_path):
    pid = make_project_id()
    src = make_wav(tmp_path / "src" / "laser.wav")

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(src), "role": "laser",
                         "entity": "player"})
    assert status == 201, body
    assert body["path"] == "audio/player/laser-laser.wav"
    assert body["meta"]["source"] == "imported"
    assert body["meta"]["role"] == "laser"
    assert body["meta"]["entity"] == "player"
    assert body["meta"]["sha256"] and body["meta"]["bytes"] > 0

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(src), "role": "theme"})
    assert status == 201, body
    assert body["path"] == "audio/theme-laser.wav"
    assert body["meta"]["entity"] is None

    status, body = call("GET", f"/projects/{pid}/audio")
    assert status == 200, body
    assert [a["path"] for a in body["audio"]] == [
        "audio/player/laser-laser.wav", "audio/theme-laser.wav"]
    assert body["audio"][0]["meta"]["format"] == "wav"


def test_audio_list_empty(store):
    pid = make_project_id()
    status, body = call("GET", f"/projects/{pid}/audio")
    assert status == 200 and body == {"audio": []}


def test_audio_import_errors(store, tmp_path):
    pid = make_project_id()
    src = make_wav(tmp_path / "src" / "ok.wav")

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(src), "role": "../x"})
    assert status == 400 and body["error"]["code"] == "path-escape"

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": "relative/path.wav", "role": "x"})
    assert status == 400 and body["error"]["code"] == "bad-request"

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(tmp_path / "missing.wav"), "role": "x"})
    assert status == 400 and body["error"]["code"] == "audio-error"

    bad = tmp_path / "note.txt"
    bad.write_text("nope", encoding="utf-8")
    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(bad), "role": "x"})
    assert status == 400 and body["error"]["code"] == "audio-error"

    status, body = call("POST", f"/projects/{pid}/audio/import",
                        {"src": str(src)})
    assert status == 400 and body["error"]["code"] == "bad-request"

    status, body = call("POST", "/projects/nope/audio/import",
                        {"src": str(src), "role": "x"})
    assert status == 404 and body["error"]["code"] == "project-not-found"


def test_routes_registered_on_server():
    from kgsm.api import server

    patterns = {(method, rx.pattern) for method, rx, _ in server.ROUTES}
    assert ("POST", r"/projects/(?P<id>[^/]+)/backup") in patterns
    assert ("GET", r"/backups") in patterns
    assert ("POST", r"/projects/restore") in patterns
    assert ("POST", r"/projects/(?P<id>[^/]+)/audio/import") in patterns
    assert ("GET", r"/projects/(?P<id>[^/]+)/audio") in patterns


# --------------------------------------------------------------------------
# CLI (backup/restore/audio-import)
# --------------------------------------------------------------------------

def test_cli_backup_restore_audio_roundtrip(store, tmp_path, capsys):
    from kgsm.__main__ import main

    pid = make_project_id("CLI Game")
    src = make_wav(tmp_path / "src" / "hit.wav")

    assert main(["audio-import", pid, str(src), "--role", "hit",
                 "--entity", "sfx"]) == 0
    imported = json.loads(capsys.readouterr().out)
    assert imported["path"] == "audio/sfx/hit-hit.wav"

    assert main(["audio-list", pid]) == 0
    listed = json.loads(capsys.readouterr().out)
    assert [a["path"] for a in listed["audio"]] == ["audio/sfx/hit-hit.wav"]

    assert main(["backup", pid]) == 0
    made = json.loads(capsys.readouterr().out)
    assert made["projectId"] == pid

    assert main(["backups"]) == 0
    assert len(json.loads(capsys.readouterr().out)["backups"]) == 1
    assert main(["backups", "--project-id", "other"]) == 0
    assert json.loads(capsys.readouterr().out)["backups"] == []

    assert main(["restore", made["backupId"]]) == 0
    restored = json.loads(capsys.readouterr().out)
    assert restored["reassignedId"] is True  # original still exists
    assert restored["project"]["name"] == "CLI Game"

    assert main(["backup-delete", made["backupId"]]) == 0
    assert main(["backup-delete", made["backupId"]]) == 1  # already gone
    assert main(["backup", "nope"]) == 1
    assert main(["restore", "nope-20260101T000000Z"]) == 1
    assert main(["audio-import", pid, str(tmp_path / "gone.wav"),
                 "--role", "x"]) == 1
