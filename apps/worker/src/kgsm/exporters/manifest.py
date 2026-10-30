"""Neutral export manifest (FR-018) with provenance and secret guards."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .. import secrets as secrets_mod
from ..validation import validate_manifest


class ManifestError(Exception):
    pass


def canonical_json(obj: object) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def assert_no_secrets(obj: object) -> None:
    """NFR-002: fail the export if a stored secret value appears in it."""
    values = [v for v in secrets_mod._load().values() if len(v) >= 4]
    if not values:
        return
    blob = canonical_json(obj)
    for v in values:
        if v in blob:
            raise ManifestError("export contains a stored secret value")


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
