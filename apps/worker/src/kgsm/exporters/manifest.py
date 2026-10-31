"""Neutral export manifest (FR-018) with provenance and secret guards."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .. import secrets as secrets_mod
from ..validation import validate_manifest


class ManifestError(Exception):
    pass


def canonical_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _secret_values() -> list[str]:
    # Every non-empty stored value is scanned, however short: skipping
    # short values would let PINs/keys ship undetected. A corrupt store
    # raises SecretError so exports fail closed instead of scanning
    # against an empty value set.
    return [v for v in secrets_mod._load().values()
            if isinstance(v, str) and v]


def assert_no_secrets(obj: object) -> None:
    """NFR-002: fail the export if a stored secret value appears in it."""
    values = _secret_values()
    if not values:
        return
    blob = canonical_json(obj)
    for v in values:
        if v in blob:
            raise ManifestError("export contains a stored secret value")


def assert_no_secrets_in_bytes(blob: bytes) -> None:
    """Byte-level NFR-002 probe (works for text and binary members)."""
    values = _secret_values()
    if not values:
        return
    for v in values:
        if v.encode("utf-8") in blob:
            raise ManifestError("export contains a stored secret value")


def assert_no_secrets_in_dir(staged_dir: str | Path) -> None:
    """Scan every staged file's full plaintext before zipping (NFR-002).

    Replaces the old truncated scan of the COMPRESSED zip blob, which
    could never match DEFLATEd secrets and skipped bytes past 100KB.
    """
    staged_dir = Path(staged_dir)
    values = _secret_values()
    if not values:
        return
    needles = [v.encode("utf-8") for v in values]
    for item in sorted(staged_dir.rglob("*")):
        if item.is_symlink() or not item.is_file():
            continue
        blob = item.read_bytes()
        for needle in needles:
            if needle in blob:
                raise ManifestError(
                    "export contains a stored secret value "
                    f"(in {item.relative_to(staged_dir).as_posix()})")


def build_manifest(
    *, project_name: str, genre: str, template_id: str, template_version: str,
    runtime_name: str, runtime_version: str, config: dict, assets: list[dict],
    warnings: list[str],
) -> dict:
    manifest = {
        "manifestVersion": "1.0.0",
        "projectName": project_name,
        "genre": genre,
        "template": {"id": template_id, "version": template_version},
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "configHash": "sha256:" + sha256_hex(canonical_json(config).encode()),
        "runtime": {"name": runtime_name, "version": runtime_version},
        "assets": assets,
        "warnings": warnings,
    }
    assert_no_secrets(manifest)
    report = validate_manifest(manifest)
    if not report.ok:
        raise ManifestError(f"invalid manifest: {report.summary()}")
    return manifest
