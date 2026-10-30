"""Godot 4 export adapter (FR-021, P1 — scheduled for M3).

Phaser and Godot are not interchangeable (SDD §1.2.9): the Godot path needs its
own GDScript/resource templates plus a test harness. This module reserves the
adapter interface so the orchestrator and UI can target it without pretending
the exporter exists.
"""

from __future__ import annotations


class GodotExportError(Exception):
    pass


def package_all(*args, **kwargs) -> dict:
    raise GodotExportError(
        "Godot export is planned for M3: GDScript templates and a Godot test"
        " harness are required first (SDD FR-021)."
    )
