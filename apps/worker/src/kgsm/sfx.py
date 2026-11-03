"""Local sound-effect synthesis (FR-029 generation slice; no network, no key).

Muse has no audio endpoint for the configured key yet, so SFX are built here
with the stdlib: a short list of tone and noise segments per preset, rendered
to mono 16-bit WAV. The same preset and seed always give the same bytes.

Output lands next to imported audio, ``audio/[<entity>/]<role>-<preset>.wav``,
with the same ``.meta.json`` sidecar shape the importer writes, so the Audio
view and the exporter treat generated and imported files alike.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import random
import struct
import wave
from pathlib import Path

from . import audio as audio_mod

PROVIDER_ID = "local-sfx"
SAMPLE_RATE = 22050
ATTACK_SECONDS = 0.003
MAX_SEED = 2**31 - 1

# (shape, f_start, f_end, seconds, decay, gain). ``noise`` ignores frequencies.
# Frequencies sweep linearly over each segment; ``decay`` is an exponential
# fade rate, so larger values die away faster.
_SEGMENTS: dict[str, list[tuple]] = {
    "jump": [("square", 280, 860, 0.16, 6, 0.45)],
    "coin": [("square", 988, 988, 0.08, 10, 0.45),
             ("square", 1319, 1319, 0.16, 7, 0.45)],
    "hit": [("noise", 0, 0, 0.12, 25, 0.7),
            ("sine", 220, 90, 0.10, 12, 0.5)],
    "explosion": [("noise", 0, 0, 0.70, 4, 0.9)],
    "laser": [("square", 1400, 200, 0.28, 3, 0.4)],
    "powerup": [("square", f, f, 0.07, 6, 0.4)
                for f in (523, 659, 784, 1047)],
    "click": [("sine", 1500, 1500, 0.03, 80, 0.5)],
    "fail": [("triangle", 440, 220, 0.35, 3, 0.5)],
}

PRESETS = tuple(sorted(_SEGMENTS))


class SfxError(audio_mod.AudioError):
    pass


def _wave_value(shape: str, phase: float) -> float:
    frac = phase % 1.0
    if shape == "square":
        return 1.0 if frac < 0.5 else -1.0
    if shape == "triangle":
        return 4.0 * abs(frac - 0.5) - 1.0
    return math.sin(2.0 * math.pi * phase)  # sine


def _render(rng: random.Random, segments: list[tuple]) -> list[float]:
    samples: list[float] = []
    attack = max(1, int(ATTACK_SECONDS * SAMPLE_RATE))
    for shape, f0, f1, seconds, decay, gain in segments:
        count = max(1, int(seconds * SAMPLE_RATE))
        phase = 0.0
        smooth = 0.0
        for i in range(count):
            t = i / count
            if shape == "noise":
                # One-pole low-pass on white noise keeps bursts from hissing.
                smooth += 0.5 * (rng.uniform(-1.0, 1.0) - smooth)
                value = smooth
            else:
                phase += (f0 + (f1 - f0) * t) / SAMPLE_RATE
                value = _wave_value(shape, phase)
            envelope = math.exp(-decay * t) * min(1.0, (i + 1) / attack)
            samples.append(gain * envelope * value)
    return samples


def render_wav(preset: str, seed: int = 0) -> bytes:
    """Return the WAV bytes for one preset. Deterministic for (preset, seed)."""
    if preset not in _SEGMENTS:
        raise SfxError(f"unknown sfx preset {preset!r}; expected one of "
                       f"{list(PRESETS)}")
    samples = _render(random.Random(seed), _SEGMENTS[preset])
    pcm = b"".join(
        struct.pack("<h", int(round(max(-1.0, min(1.0, s)) * 32767)))
        for s in samples)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm)
    return buf.getvalue()


def _check_seed(seed: object) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) \
            or not 0 <= seed <= MAX_SEED:
        raise SfxError(f"seed must be an integer 0..{MAX_SEED}")
    return seed


def generate(project_dir: str | Path, preset: str, *, role: str,
             entity: str | None = None, seed: object = 0) -> dict:
    """Render one preset and write it under ``audio/`` with a sidecar."""
    project_dir = Path(project_dir)
    role = audio_mod._check_name(role, "role", required=True)
    assert role is not None
    entity = audio_mod._check_name(entity, "entity", required=False)
    seed = _check_seed(seed)
    data = render_wav(preset, seed)

    folder = project_dir / "audio"
    if entity:
        folder /= entity
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{role}-{preset}.wav"
    dest.write_bytes(data)
    meta = {
        "source": "generated",
        "provider": PROVIDER_ID,
        "preset": preset,
        "seed": seed,
        "role": role,
        "entity": entity,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "format": "wav",
        "durationSeconds": round(_frames(data) / SAMPLE_RATE, 3),
        "sampleRate": SAMPLE_RATE,
        "channels": 1,
    }
    sidecar = dest.with_suffix(dest.suffix + ".meta.json")
    sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {"path": dest.relative_to(project_dir).as_posix(), "meta": meta}


def _frames(data: bytes) -> int:
    with wave.open(io.BytesIO(data), "rb") as wf:
        return wf.getnframes()
