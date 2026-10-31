"""Modular audio import (FR-029 wave-1 slice: import only; contract §9).

Stdlib-only: WAV structure via :mod:`wave`, MP3/OGG via header sniffing
plus lightweight frame/page parsing for metadata. Files land under
``audio/[<entity>/]<role>-<stem>.<ext>`` with a manifest-ready
``.meta.json`` sidecar. Generation/SFX-synth is out of scope (P2).
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import wave
from pathlib import Path

from . import paths as paths_mod

AUDIO_EXTS = {".wav", ".mp3", ".ogg"}

# A single obviously-wrong 500 MB drop must fail fast, not fill the disk.
MAX_AUDIO_BYTES = 32 * 1024 * 1024
# SFX/music loops longer than 10 minutes are almost certainly a wrong file.
MAX_DURATION_SECONDS = 600.0


class AudioError(Exception):
    pass


_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def _check_name(value: str | None, field_name: str,
                required: bool) -> str | None:
    if value is None:
        if required:
            raise AudioError(f"{field_name} must be a non-empty string")
        return None
    if (not isinstance(value, str) or not value or value in (".", "..")
            or "/" in value or "\\" in value or "\x00" in value
            or not _NAME_RE.match(value)):
        raise AudioError(f"{field_name} must be a plain name "
                         f"(^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$)")
    return value


def _check_import_src(src: Path) -> None:
    """Reject symlink escapes and worker-store reads for audio imports."""
    if src.is_symlink():
        raise AudioError(f"import source must not be a symlink: {src}")
    real = src.resolve()
    try:
        data_root = paths_mod.data_dir().resolve()
    except OSError:
        data_root = None
    if data_root is not None and (
            real == data_root or data_root in real.parents):
        raise AudioError("import source must not live under the worker "
                         "data dir")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------
# Format sniffing + metadata probes
# --------------------------------------------------------------------------

def sniff_format(path: str | Path) -> str:
    """Return ``wav``/``mp3``/``ogg`` from magic bytes; raise otherwise."""
    with Path(path).open("rb") as fh:
        head = fh.read(16)
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:3] == b"ID3":
        return "mp3"
    if len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0:
        return "mp3"
    raise AudioError("unrecognized audio data: expected WAV (RIFF/WAVE), "
                     "MP3 (ID3/frame sync) or OGG (OggS) magic")


def probe_wav(path: str | Path) -> dict:
    """Exact WAV metadata via stdlib :mod:`wave`."""
    try:
        with wave.open(str(path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            duration = frames / rate if rate else None
            return {
                "durationSeconds": duration,
                "sampleRate": rate or None,
                "channels": wf.getnchannels(),
                "sampleWidth": wf.getsampwidth(),
            }
    except (wave.Error, EOFError, OSError) as exc:
        raise AudioError(f"invalid WAV file: {exc}") from None


# MPEG audio header tables (version id -> layer bits -> bitrate table).
# Version bits: 0=MPEG2.5, 2=MPEG2, 3=MPEG1. Layer bits (NOT layer
# number): 3=Layer I, 2=Layer II, 1=Layer III, 0=reserved.
_MPEG_BITRATES = {
    3: {1: (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256,
            320, None),
        2: (0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
            384, None),
        3: (0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416,
            448, None)},
    2: {1: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
            None),
        2: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
            None),
        3: (0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224,
            256, None)},
    0: {1: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
            None),
        2: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
            None),
        3: (0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224,
            256, None)},
}
_MPEG_SAMPLERATES = {
    3: (44100, 48000, 32000, None),
    2: (22050, 24000, 16000, None),
    0: (11025, 12000, 8000, None),
}


def _parse_mpeg_header(word: bytes) -> tuple[int, int, int] | None:
    """Parse 4 sync bytes → (bitrate_kbps, sample_rate, channels) or None."""
    if len(word) < 4 or word[0] != 0xFF or word[1] & 0xE0 != 0xE0:
        return None
    version = (word[1] >> 3) & 0x03
    layer = (word[1] >> 1) & 0x03
    bitrate_idx = (word[2] >> 4) & 0x0F
    rate_idx = (word[2] >> 2) & 0x03
    if version == 1 or layer == 0 or bitrate_idx in (0, 15) or rate_idx == 3:
        return None
    bitrate = _MPEG_BITRATES[version][layer][bitrate_idx]
    rate = _MPEG_SAMPLERATES[version][rate_idx]
    if bitrate is None or rate is None:
        return None
    channels = 1 if (word[3] >> 6) == 3 else 2
    return bitrate, rate, channels


def probe_mp3(path: str | Path) -> dict:
    """Best-effort MP3 metadata (CBR duration estimate; VBR is approximate).

    Skips an ID3v2 tag, then scans for the first valid MPEG frame header.
    Duration is ``None`` when no header is found (still a valid MP3 by
    magic, e.g. free-format); callers must not gate on it.
    """
    raw = Path(path)
    with raw.open("rb") as fh:
        head = fh.read(10)
        offset = 0
        if head[:3] == b"ID3" and len(head) == 10:
            size = 0
            for byte in head[6:10]:
                if byte & 0x80:
                    break
                size = (size << 7) | byte
            else:
                offset = 10 + size
        fh.seek(offset)
        window = fh.read(65536)
    channels: int | None = None
    rate: int | None = None
    duration: float | None = None
    for i in range(len(window) - 4):
        parsed = _parse_mpeg_header(window[i:i + 4])
        if parsed is None:
            continue
        bitrate, rate, channels = parsed
        audio_bytes = raw.stat().st_size - offset
        if audio_bytes > 0:
            duration = audio_bytes / (bitrate * 1000 / 8)
        break
    return {"durationSeconds": duration, "sampleRate": rate,
            "channels": channels, "sampleWidth": None}


def probe_ogg(path: str | Path) -> dict:
    """OGG metadata: vorbis stream info + duration from the last page.

    Duration needs a sample rate (vorbis identification header in the
    first page) and a final granule position (last OggS page); either
    missing → ``durationSeconds`` is ``None``.
    """
    raw = Path(path)
    rate: int | None = None
    channels: int | None = None
    with raw.open("rb") as fh:
        first = fh.read(256)
    if first[:4] == b"OggS" and len(first) > 27:
        seg_count = first[26]
        header_end = 27 + seg_count
        packet = first[header_end:header_end + 30]
        # Vorbis id header: 0x01 + "vorbis" + version(4) + channels(1)
        # + sample rate(4 LE).
        if packet[:7] == b"\x01vorbis" and len(packet) >= 16:
            channels = packet[11] or None
            rate = int.from_bytes(packet[12:16], "little") or None
    duration: float | None = None
    size = raw.stat().st_size
    with raw.open("rb") as fh:
        fh.seek(max(0, size - 65558))
        tail = fh.read()
    idx = tail.rfind(b"OggS")
    if idx >= 0 and len(tail) - idx >= 14 and rate:
        granule = int.from_bytes(tail[idx + 6:idx + 14], "little", signed=True)
        if granule > 0:
            duration = granule / rate
    return {"durationSeconds": duration, "sampleRate": rate,
            "channels": channels, "sampleWidth": None}


_PROBES = {"wav": probe_wav, "mp3": probe_mp3, "ogg": probe_ogg}


# --------------------------------------------------------------------------
# Import + listing
# --------------------------------------------------------------------------

def import_audio(project_dir: str | Path, src: str | Path, *,
                role: str, entity: str | None = None) -> dict:
    """Validate and copy a local audio file into ``audio/`` (FR-029)."""
    project_dir, src = Path(project_dir), Path(src)
    role = _check_name(role, "role", required=True)
    assert role is not None
    entity = _check_name(entity, "entity", required=False)
    _check_import_src(src)
    if src.suffix.lower() not in AUDIO_EXTS:
        raise AudioError(f"unsupported audio {src.suffix!r}; expected one of"
                         f" {sorted(AUDIO_EXTS)}")
    if not src.is_file():
        raise AudioError(f"audio source not found: {src}")
    size = src.stat().st_size
    if size > MAX_AUDIO_BYTES:
        raise AudioError(f"audio exceeds size limit: {size} bytes "
                         f"(max {MAX_AUDIO_BYTES})")
    if size == 0:
        raise AudioError("audio source is empty")
    detected = sniff_format(src)
    if detected != src.suffix.lower().lstrip("."):
        raise AudioError(f"audio content is {detected!r} but extension is "
                         f"{src.suffix.lower()!r}")
    info = _PROBES[detected](src)
    duration = info["durationSeconds"]
    if duration is not None and duration > MAX_DURATION_SECONDS:
        raise AudioError(f"audio exceeds duration limit: {duration:.1f}s "
                         f"(max {MAX_DURATION_SECONDS:.0f}s)")
    folder = project_dir / "audio"
    if entity:
        folder /= entity
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{role}-{src.stem}{src.suffix.lower()}"
    shutil.copy2(src, dest)
    meta = {
        "source": "imported",
        "role": role,
        "entity": entity,
        "sha256": _sha256_file(dest),
        "bytes": dest.stat().st_size,
        "format": detected,
        "durationSeconds": duration,
        "sampleRate": info["sampleRate"],
        "channels": info["channels"],
    }
    sidecar = dest.with_suffix(dest.suffix + ".meta.json")
    sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"path": dest.relative_to(project_dir).as_posix(), "meta": meta}


def list_audio(project_dir: str | Path) -> list[dict]:
    """List imported audio files with sidecar metadata when present."""
    base = Path(project_dir) / "audio"
    items = []
    if base.is_dir():
        for path in sorted(p for p in base.rglob("*") if p.is_file()):
            if path.name.endswith(".meta.json"):
                continue
            item: dict = {"path": path.relative_to(project_dir).as_posix()}
            sidecar = path.parent / (path.name + ".meta.json")
            if sidecar.is_file():
                try:
                    item["meta"] = json.loads(
                        sidecar.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    pass
            items.append(item)
    return items
