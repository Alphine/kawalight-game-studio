"""Validation layer (SDD §5.3, NFR-009, FR-016)."""

from .config_validator import (
    load_schema,
    validate_battle_2d_config,
    validate_blueprint,
    validate_endless_runner_config,
    validate_farming_config,
    validate_manifest,
    validate_puzzle_match_config,
    validate_side_scroller_config,
    validate_space_shooter_config,
)
from .reports import Issue, Report

__all__ = [
    "Issue",
    "Report",
    "load_schema",
    "validate_battle_2d_config",
    "validate_blueprint",
    "validate_endless_runner_config",
    "validate_farming_config",
    "validate_puzzle_match_config",
    "validate_manifest",
    "validate_side_scroller_config",
    "validate_space_shooter_config",
]
