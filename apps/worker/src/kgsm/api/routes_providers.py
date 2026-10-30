"""Provider routes (contract §5; FR-006/FR-007).

Paid generation itself flows through ``POST /projects/{id}/assets/generate``
(contract §4), which re-quotes via ``costs`` and enforces ``authorize`` before
calling any provider registered here -- including ``openai-compat``. The
persisted generation history is the project asset list (``GET
/projects/{id}/assets``): every generated asset carries ``provider``,
``model``, and ``prompt`` provenance in its sidecar meta.
"""

from __future__ import annotations

from ..providers import list_providers
from . import Request


def list_providers_route(req: Request) -> tuple[int, dict]:
    return 200, {"providers": list_providers()}


ROUTES = [
    ("GET", r"/providers", list_providers_route),
]
