"""Secret routes (contract §10; FR-008, NFR-002).

Values are write-only: no endpoint ever returns one. Names only are listed,
sorted, for UI display.
"""

from __future__ import annotations

from .. import secrets as secrets_mod
from . import Request, bad_request, need_str


def put_secret(req: Request) -> tuple[int, dict]:
    name = req.group("name")
    value = need_str(req.body, "value")
    if not value:
        raise bad_request("value must not be empty")
    try:
        secrets_mod.set_secret(name, value)
    except ValueError as exc:
        raise bad_request(str(exc)) from None
    return 200, {"name": name.strip(), "stored": True}


def delete_secret(req: Request) -> tuple[int, dict]:
    name = req.group("name")
    return 200, {"name": name, "deleted": secrets_mod.delete_secret(name)}


def list_secrets(req: Request) -> tuple[int, dict]:
    return 200, {"names": secrets_mod.list_secret_names()}


ROUTES = [
    ("PUT", r"/secrets/(?P<name>[^/]+)", put_secret),
    ("DELETE", r"/secrets/(?P<name>[^/]+)", delete_secret),
    ("GET", r"/secrets", list_secrets),
]
