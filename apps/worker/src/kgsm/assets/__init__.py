"""Asset pipeline (SDD FR-010..FR-013, FR-024..FR-026 partial)."""

from .inspect import inspect_image, palette_report
from .pipeline import (
    AssetError,
    import_asset,
    save_frames,
    save_generated,
    slice_sheet,
)

__all__ = [
    "AssetError",
    "import_asset",
    "inspect_image",
    "palette_report",
    "save_frames",
    "save_generated",
    "slice_sheet",
]
