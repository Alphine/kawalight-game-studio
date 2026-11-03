"""Local SFX generation tests (stdlib only; no network, no API key)."""

import io
import json
import struct
import wave

import pytest

from kgsm import audio as audio_mod
from kgsm import projects as projects_mod
from kgsm import sfx
from kgsm.api import Request
from kgsm.api.server import dispatch


def call(method, path, body=None, query=None):
    return dispatch(Request(method=method, path=path, body=body or {},
                            query=query or {}))


def read_wav(data):
    with wave.open(io.BytesIO(data), "rb") as wf:
        frames = wf.getnframes()
        raw = wf.readframes(frames)
        return wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), raw


def peak(raw):
    values = struct.unpack("<%dh" % (len(raw) // 2), raw)
    return max(abs(v) for v in values)


@pytest.mark.parametrize("preset", sfx.PRESETS)
def test_every_preset_renders_valid_mono_16bit_wav(preset):
    channels, width, rate, raw = read_wav(sfx.render_wav(preset, seed=3))
    assert (channels, width, rate) == (1, 2, sfx.SAMPLE_RATE)
    assert len(raw) > 0
    assert peak(raw) > 0  # not silent
    assert peak(raw) <= 32767


def test_same_preset_and_seed_give_identical_bytes():
    assert sfx.render_wav("explosion", seed=7) == sfx.render_wav(
        "explosion", seed=7)


def test_seed_changes_noise_presets_but_not_tone_presets():
    assert sfx.render_wav("hit", seed=1) != sfx.render_wav("hit", seed=2)
    assert sfx.render_wav("jump", seed=1) == sfx.render_wav("jump", seed=2)


def test_unknown_preset_is_rejected():
    with pytest.raises(sfx.SfxError):
        sfx.render_wav("orchestra", seed=0)


@pytest.mark.parametrize("seed", [-1, 2**31, 1.5, "7", True])
def test_bad_seed_is_rejected(seed):
    with pytest.raises(audio_mod.AudioError):
        sfx._check_seed(seed)


def test_generate_writes_wav_and_sidecar(tmp_path):
    result = sfx.generate(tmp_path, "coin", role="pickup", entity="player",
                          seed=5)
    assert result["path"] == "audio/player/pickup-coin.wav"
    dest = tmp_path / result["path"]
    assert dest.read_bytes() == sfx.render_wav("coin", seed=5)
    meta = json.loads(
        (dest.parent / (dest.name + ".meta.json")).read_text("utf-8"))
    assert meta["source"] == "generated"
    assert meta["provider"] == sfx.PROVIDER_ID
    assert meta["preset"] == "coin" and meta["seed"] == 5
    assert meta["format"] == "wav" and meta["channels"] == 1
    assert meta["durationSeconds"] > 0


def test_generated_file_lists_with_imported_audio(tmp_path):
    sfx.generate(tmp_path, "click", role="ui")
    items = audio_mod.list_audio(tmp_path)
    assert [i["path"] for i in items] == ["audio/ui-click.wav"]
    assert items[0]["meta"]["source"] == "generated"


def test_presets_route_lists_all_presets():
    status, body = call("GET", "/audio/sfx-presets")
    assert status == 200
    assert body["presets"] == list(sfx.PRESETS)
    assert body["provider"] == sfx.PROVIDER_ID


def test_generate_route_creates_and_lists(store):
    pid = projects_mod.create("Sfx Demo", "space-shooter").id
    status, body = call("POST", f"/projects/{pid}/audio/generate",
                        {"preset": "laser", "role": "shot", "seed": 9})
    assert status == 201
    assert body["path"] == "audio/shot-laser.wav"
    status, listed = call("GET", f"/projects/{pid}/audio")
    assert status == 200
    assert [a["path"] for a in listed["audio"]] == ["audio/shot-laser.wav"]


def test_generate_route_defaults_role_to_preset(store):
    pid = projects_mod.create("Sfx Default", "farming").id
    status, body = call("POST", f"/projects/{pid}/audio/generate",
                        {"preset": "fail"})
    assert status == 201
    assert body["path"] == "audio/fail-fail.wav"


def test_generate_route_errors(store):
    pid = projects_mod.create("Sfx Errors", "battle-2d").id
    status, body = call("POST", f"/projects/{pid}/audio/generate",
                        {"preset": "nope"})
    assert status == 400
    status, body = call("POST", f"/projects/{pid}/audio/generate",
                        {"preset": "jump", "seed": -4})
    assert status == 400
    status, body = call("POST", f"/projects/{pid}/audio/generate",
                        {"preset": "jump", "role": "../evil"})
    assert status == 400
    status, body = call("POST", "/projects/nope/audio/generate",
                        {"preset": "jump"})
    assert status == 404
