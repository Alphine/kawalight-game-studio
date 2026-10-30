"""Audio import tests (FR-029 wave-1 slice; contract §9). Stdlib only."""

import json
import wave

import pytest

from kgsm import audio


def make_wav(path, *, seconds=1.0, rate=8000, channels=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(b"\x00\x00" * frames * channels)
    return path


def make_mp3(path):
    """Minimal MP3: empty ID3v2 tag + one valid MPEG-1 Layer III header."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tag = b"ID3\x04\x00\x00\x00\x00\x00\x00"  # size 0
    # 0xFF 0xFB: MPEG-1, Layer III; 0x90: 128 kbps, 44.1 kHz; 0x00: stereo.
    header = bytes([0xFF, 0xFB, 0x90, 0x00])
    frame_len = 144 * 128000 // 44100  # 417 bytes incl. header
    path.write_bytes(tag + header + bytes(frame_len - 4) + bytes(417 * 9))
    return path


def make_ogg(path, *, rate=44100, channels=2):
    """Minimal OGG: one OggS page carrying a vorbis identification header."""
    path.parent.mkdir(parents=True, exist_ok=True)
    packet = (b"\x01vorbis" + (0).to_bytes(4, "little")
              + bytes([channels]) + rate.to_bytes(4, "little")
              + bytes(18))
    assert len(packet) < 255
    page = (b"OggS\x00\x02" + (0).to_bytes(8, "little")
            + (1234).to_bytes(4, "little") + (0).to_bytes(4, "little")
            + (0).to_bytes(4, "little") + bytes([1, len(packet)]) + packet)
    path.write_bytes(page)
    return path


def test_import_wav_with_entity(store, tmp_path):
    from kgsm import projects

    project = projects.create("Audio Demo", "space-shooter")
    src = make_wav(tmp_path / "src" / "laser.wav")

    result = audio.import_audio(project.dir, src, role="laser",
                                entity="player")

    assert result["path"] == "audio/player/laser-laser.wav"
    assert (project.dir / result["path"]).is_file()
    meta = result["meta"]
    assert meta["source"] == "imported"
    assert meta["role"] == "laser" and meta["entity"] == "player"
    assert meta["format"] == "wav"
    assert meta["sampleRate"] == 8000 and meta["channels"] == 1
    assert meta["durationSeconds"] == pytest.approx(1.0)
    assert meta["bytes"] == src.stat().st_size and meta["sha256"]
    sidecar = project.dir / "audio" / "player" / "laser-laser.wav.meta.json"
    assert json.loads(sidecar.read_text(encoding="utf-8")) == meta


def test_import_wav_without_entity(store, tmp_path):
    from kgsm import projects

    project = projects.create("Music", "space-shooter")
    src = make_wav(tmp_path / "src" / "theme.wav", seconds=0.5)
    result = audio.import_audio(project.dir, src, role="theme")
    assert result["path"] == "audio/theme-theme.wav"
    assert result["meta"]["entity"] is None
    assert result["meta"]["durationSeconds"] == pytest.approx(0.5)


def test_import_mp3_sniffs_id3_and_estimates_duration(store, tmp_path):
    from kgsm import projects

    project = projects.create("MP3", "space-shooter")
    src = make_mp3(tmp_path / "src" / "boom.mp3")
    assert audio.sniff_format(src) == "mp3"
    result = audio.import_audio(project.dir, src, role="boom", entity="sfx")
    assert result["path"] == "audio/sfx/boom-boom.mp3"
    assert result["meta"]["format"] == "mp3"
    assert result["meta"]["sampleRate"] == 44100
    assert result["meta"]["channels"] == 2
    # 10 frames * 417 bytes at 128 kbps ≈ 0.26 s.
    assert result["meta"]["durationSeconds"] == pytest.approx(4170 / 16000)


def test_import_ogg_reads_vorbis_stream_info(store, tmp_path):
    from kgsm import projects

    project = projects.create("OGG", "space-shooter")
    src = make_ogg(tmp_path / "src" / "pad.ogg")
    assert audio.sniff_format(src) == "ogg"
    result = audio.import_audio(project.dir, src, role="pad")
    assert result["meta"]["format"] == "ogg"
    assert result["meta"]["sampleRate"] == 44100
    assert result["meta"]["channels"] == 2
    assert result["meta"]["durationSeconds"] is None  # single empty page


def test_import_rejects_bad_extension(store, tmp_path):
    from kgsm import projects

    project = projects.create("Bad Ext", "space-shooter")
    src = tmp_path / "src" / "note.txt"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text("nope", encoding="utf-8")
    with pytest.raises(audio.AudioError, match="unsupported audio"):
        audio.import_audio(project.dir, src, role="note")


def test_import_rejects_missing_and_empty_sources(store, tmp_path):
    from kgsm import projects

    project = projects.create("Missing", "space-shooter")
    with pytest.raises(audio.AudioError, match="not found"):
        audio.import_audio(project.dir, tmp_path / "gone.wav", role="x")
    empty = tmp_path / "empty.wav"
    empty.write_bytes(b"")
    with pytest.raises(audio.AudioError, match="empty"):
        audio.import_audio(project.dir, empty, role="x")


def test_import_rejects_content_extension_mismatch(store, tmp_path):
    from kgsm import projects

    project = projects.create("Mismatch", "space-shooter")
    src = make_wav(tmp_path / "src" / "real.wav")
    renamed = tmp_path / "src" / "real.mp3"
    renamed.write_bytes(src.read_bytes())
    with pytest.raises(audio.AudioError, match="content is 'wav'"):
        audio.import_audio(project.dir, renamed, role="x")


def test_import_rejects_garbage_with_audio_extension(store, tmp_path):
    from kgsm import projects

    project = projects.create("Garbage", "space-shooter")
    src = tmp_path / "src" / "junk.wav"
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(b"\x00\x01\x02\x03" * 64)
    with pytest.raises(audio.AudioError, match="unrecognized audio"):
        audio.import_audio(project.dir, src, role="x")


def test_import_rejects_bad_names(store, tmp_path):
    from kgsm import projects

    project = projects.create("Names", "space-shooter")
    src = make_wav(tmp_path / "src" / "ok.wav")
    with pytest.raises(audio.AudioError):
        audio.import_audio(project.dir, src, role="")
    with pytest.raises(audio.AudioError):
        audio.import_audio(project.dir, src, role="../x")
    with pytest.raises(audio.AudioError):
        audio.import_audio(project.dir, src, role="x", entity="a/b")


def test_import_enforces_size_and_duration_limits(store, tmp_path,
                                                  monkeypatch):
    from kgsm import projects

    project = projects.create("Limits", "space-shooter")
    src = make_wav(tmp_path / "src" / "big.wav", seconds=2.0)
    monkeypatch.setattr(audio, "MAX_AUDIO_BYTES", 100)
    with pytest.raises(audio.AudioError, match="size limit"):
        audio.import_audio(project.dir, src, role="x")
    monkeypatch.setattr(audio, "MAX_AUDIO_BYTES", 32 * 1024 * 1024)
    monkeypatch.setattr(audio, "MAX_DURATION_SECONDS", 0.5)
    with pytest.raises(audio.AudioError, match="duration limit"):
        audio.import_audio(project.dir, src, role="x")


def test_list_audio_walks_tree_with_meta(store, tmp_path):
    from kgsm import projects

    project = projects.create("Library", "space-shooter")
    assert audio.list_audio(project.dir) == []
    audio.import_audio(project.dir, make_wav(tmp_path / "a.wav"), role="sfx1")
    audio.import_audio(project.dir, make_wav(tmp_path / "b.wav"), role="sfx2",
                       entity="enemy")
    items = audio.list_audio(project.dir)
    assert [i["path"] for i in items] == ["audio/enemy/sfx2-b.wav",
                                          "audio/sfx1-a.wav"]
    assert all(i["meta"]["source"] == "imported" for i in items)
