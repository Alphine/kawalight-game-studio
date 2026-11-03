"""Localhost JSON HTTP API server (stdlib ``http.server`` + ``json`` only).

Binds ``127.0.0.1`` (default port 4317) and serves ``/api/v1/*`` per
``docs/api-contract.md``. All route tables are imported directly; a broken
route module must fail loudly at import, never silently disable endpoints.
Health and cost endpoints (§0, §6) are core routes implemented here.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from kgsm import __version__

from .. import auth as auth_mod
from .. import costs as costs_mod
from .. import db as db_mod
from .. import secrets as secrets_mod
from ..providers import ProviderError
from . import (
    CONTRACT_VERSION,
    MAX_BODY_BYTES,
    ApiError,
    RawBody,
    Request,
    bad_request,
    need_bool,
    need_int,
    need_str,
    quote_to_dict,
)
from . import (routes_assets, routes_auto, routes_auth, routes_config,
                 routes_export, routes_ops, routes_playtest, routes_projects,
                 routes_providers, routes_secrets, routes_story)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4317

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# --------------------------------------------------------------------------
# Core routes: health (§0) and costs (§6)
# --------------------------------------------------------------------------

def health(_req: Request) -> tuple[int, dict]:
    return 200, {"status": "ok", "worker": "kgsm", "version": __version__,
                 "contractVersion": CONTRACT_VERSION}


def _quote_or_raise(body: dict):
    provider_id = need_str(body, "providerId")
    n_images = need_int(body, "nImages", 1, costs_mod.MAX_IMAGES_PER_QUOTE)
    project_id = body.get("projectId")
    if project_id is not None and not isinstance(project_id, str):
        raise bad_request("projectId must be a string")
    try:
        return costs_mod.quote(provider_id, n_images, project_id=project_id)
    except ProviderError as exc:
        raise ApiError("unknown-provider", str(exc), 404) from None
    except costs_mod.CostError as exc:
        raise ApiError("bad-request", str(exc), 400) from None


def costs_quote(req: Request) -> tuple[int, dict]:
    return 200, quote_to_dict(_quote_or_raise(req.body))


def costs_authorize(req: Request) -> tuple[int, dict]:
    quote = _quote_or_raise(req.body)
    confirmed = need_bool(req.body, "confirmed")
    try:
        costs_mod.authorize(quote, confirmed)
    except costs_mod.CostError as exc:
        message = str(exc)
        quoted = {"quote": quote_to_dict(quote)}
        if quote.blocked:
            raise ApiError("cost-blocked", message, 402, quoted) from None
        raise ApiError("needs-confirmation", message, 409, quoted) from None
    return 200, {"authorized": True, "quote": quote_to_dict(quote)}


def costs_ledger(req: Request) -> tuple[int, dict]:
    project_id = req.query.get("projectId")
    month = req.query.get("month") or \
        datetime.now(timezone.utc).strftime("%Y-%m")
    if not _MONTH_RE.match(month):
        raise bad_request("month must be YYYY-MM")
    conn = db_mod.connect()
    try:
        if project_id:
            rows = conn.execute(
                "SELECT id, scope, project_id, amount_cents, label, created_at"
                " FROM spend_ledger WHERE substr(created_at, 1, 7) = ?"
                " AND project_id = ? ORDER BY id",
                (month, project_id)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, scope, project_id, amount_cents, label, created_at"
                " FROM spend_ledger WHERE substr(created_at, 1, 7) = ?"
                " ORDER BY id", (month,)).fetchall()
    finally:
        conn.close()
    entries = [{
        "id": row["id"], "scope": row["scope"],
        "projectId": row["project_id"], "amountCents": row["amount_cents"],
        "label": row["label"], "createdAt": row["created_at"],
    } for row in rows]
    return 200, {"entries": entries,
                 "totalCents": sum(e["amountCents"] for e in entries)}


def costs_limits_get(req: Request) -> tuple[int, dict]:
    project_id = req.query.get("projectId") or None
    return 200, {
        "global": costs_mod.get_limit("global"),
        "project": costs_mod.get_limit(f"project:{project_id}")
        if project_id else None,
        "spentThisMonth": {
            "global": costs_mod.spent_this_month(None),
            "project": costs_mod.spent_this_month(project_id)
            if project_id else 0,
        },
    }


def costs_limits_put(req: Request) -> tuple[int, dict]:
    body = req.body
    scope = need_str(body, "scope")
    if scope not in ("global", "project"):
        raise bad_request("scope must be 'global' or 'project'")
    if "cents" not in body:
        raise bad_request("cents is required (integer or null)")
    cents = body["cents"]
    if cents is not None:
        if not isinstance(cents, int) or isinstance(cents, bool):
            raise bad_request("cents must be an integer or null")
        if cents < 0:
            raise bad_request("cents must be >= 0")
    if scope == "project":
        project_id = body.get("projectId")
        if not project_id or not isinstance(project_id, str):
            raise bad_request("projectId is required for project scope")
        costs_mod.set_limit(f"project:{project_id}", cents)
    else:
        costs_mod.set_limit("global", cents)
    return 200, {"scope": scope, "cents": cents}


CORE_ROUTES = [
    ("GET", r"/health", health),
    ("POST", r"/costs/quote", costs_quote),
    ("POST", r"/costs/authorize", costs_authorize),
    ("GET", r"/costs/ledger", costs_ledger),
    ("GET", r"/costs/limits", costs_limits_get),
    ("PUT", r"/costs/limits", costs_limits_put),
]


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------

# Routes anyone may call. Everything else needs a session when auth is enforced.
PUBLIC_HANDLERS = {
    health, routes_auth.register, routes_auth.login, routes_auth.logout,
    routes_auth.me,
}

# Routes that touch shared state or read server-side paths: admin only.
ADMIN_HANDLERS = {
    routes_secrets.put_secret, routes_secrets.delete_secret,
    routes_secrets.list_secrets,
    routes_ops.create_backup, routes_ops.list_backups,
    routes_ops.restore_backup, routes_ops.import_audio,
    routes_assets.import_asset_route, routes_auto.create_auto,
    costs_limits_get, costs_limits_put, costs_ledger,
}


def _collect_routes() -> list:
    tables = [CORE_ROUTES, routes_auth.ROUTES, routes_projects.ROUTES,
              routes_auto.ROUTES,
              routes_config.ROUTES, routes_assets.ROUTES,
              routes_export.ROUTES, routes_secrets.ROUTES,
              routes_providers.ROUTES, routes_ops.ROUTES,
              routes_story.ROUTES, routes_playtest.ROUTES]
    compiled = []
    for table in tables:
        for method, pattern, handler in table:
            compiled.append((method, re.compile(pattern), handler))
    return compiled


ROUTES = _collect_routes()


def dispatch(req: Request) -> tuple[int, dict | RawBody]:
    for method, pattern, handler in ROUTES:
        if method != req.method:
            continue
        match = pattern.fullmatch(req.path)
        if match is not None:
            req.match = match
            if req.enforce_auth:
                if handler not in PUBLIC_HANDLERS and req.user is None:
                    err = ApiError("unauthenticated", "sign in to continue", 401)
                    return err.status, err.to_body()
                if handler in ADMIN_HANDLERS and not req.user.is_admin:
                    err = ApiError("forbidden", "this action is admin-only", 403)
                    return err.status, err.to_body()
            # Bind the caller's identity for project scoping. In-process
            # callers (enforce_auth False) bind None: unscoped, as before.
            token = auth_mod.bind(req.user if req.enforce_auth else None)
            try:
                return handler(req)
            except ApiError as exc:
                return exc.status, exc.to_body()
            finally:
                auth_mod.unbind(token)
    raise ApiError("not-found", f"no route for {req.method} {req.path}", 404)


# --------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------

_JSON_CONTENT = "application/json; charset=utf-8"
_MUTATING_METHODS = ("POST", "PUT", "PATCH", "DELETE")


def _is_json_content(content_type: str | None) -> bool:
    """True when the media type (ignoring parameters) is application/json."""
    media = (content_type or "").split(";", 1)[0].strip().lower()
    return media == "application/json"


def _extra_origins() -> set[str]:
    """Operator-added origins, e.g. ``https://basyid.dev`` for the web build.

    Read from ``KGSM_ALLOWED_ORIGINS`` (comma-separated, exact scheme+host
    +port match) on every request so a deploy can change it without code.
    """
    raw = os.environ.get("KGSM_ALLOWED_ORIGINS", "")
    return {item.strip().rstrip("/") for item in raw.split(",") if item.strip()}


def _allowed_origin(origin: str | None) -> str | None:
    """Echo back only localhost-class origins (contract §11) plus any
    operator-listed origin.

    The opaque Origin 'null' (sandboxed iframes, file:// pages) is never
    allowed: echoing it would grant any local file read access to the
    unauthenticated localhost API.
    """
    if not origin or origin == "null":
        return None
    try:
        parts = urlsplit(origin)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if parts.scheme in ("http", "https") and host in ("127.0.0.1",
                                                      "localhost"):
        return origin
    if parts.scheme == "tauri" or host in ("tauri.localhost",):
        return origin
    if origin.rstrip("/") in _extra_origins():
        return origin
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "KGSMWorker/" + __version__

    def log_message(self, fmt, *args) -> None:  # noqa: N802 (stdlib name)
        try:
            text = secrets_mod.redact(fmt % args)[:500]
        except Exception:  # noqa: BLE001 - logging must never crash
            text = (fmt % args)[:500]
        sys.stderr.write(f"{self.address_string()} - {text}\n")

    def send_error(self, code, message=None, explain=None) -> None:  # noqa: N802
        self._send_json(code, {"error": {"code": "http-error",
                                        "message": message or "request failed"}})

    # -- dispatch ------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        self._handle()

    def do_POST(self) -> None:  # noqa: N802
        self._handle()

    def do_PUT(self) -> None:  # noqa: N802
        self._handle()

    def do_PATCH(self) -> None:  # noqa: N802
        self._handle()

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_preflight()

    def _send_json(self, status: int, obj: dict,
                   extra: dict[str, str] | None = None) -> None:
        blob = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", _JSON_CONTENT)
        self.send_header("Content-Length", str(len(blob)))
        origin = _allowed_origin(self.headers.get("Origin"))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(blob)

    def _send_bytes(self, status: int, blob: bytes,
                    content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(blob)))
        origin = _allowed_origin(self.headers.get("Origin"))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(blob)

    def _send_preflight(self) -> None:
        self.send_response(204)
        origin = _allowed_origin(self.headers.get("Origin"))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _handle(self) -> None:
        parsed = urlsplit(self.path)
        raw_path = parsed.path or "/"
        if raw_path == "/health":
            api_path = "/health"
        elif raw_path in ("/api/v1", "/api/v1/"):
            api_path = "/"
        elif raw_path.startswith("/api/v1/"):
            api_path = raw_path[len("/api/v1"):]
        else:
            self._send_json(404, ApiError(
                "not-found", f"no route for {self.command} {raw_path}",
                404).to_body())
            return
        if len(api_path) > 1:
            api_path = api_path.rstrip("/") or "/"

        # Cross-site guard. CORS headers only stop a page from *reading* the
        # reply; a simple cross-origin POST (text/plain, no preflight) would
        # still run its side effects (spend, import, secret writes). So refuse
        # foreign browser origins outright and require JSON for mutations,
        # which a simple request cannot set without a preflight.
        origin = self.headers.get("Origin")
        if origin and _allowed_origin(origin) is None:
            self._send_json(403, ApiError(
                "forbidden-origin",
                "request origin is not allowed", 403).to_body())
            return
        if self.command in _MUTATING_METHODS and not _is_json_content(
                self.headers.get("Content-Type")):
            self._send_json(415, ApiError(
                "unsupported-media-type",
                "mutating requests must use Content-Type: application/json",
                415).to_body())
            return

        try:
            length_raw = self.headers.get("Content-Length")
            length = int(length_raw) if length_raw else 0
        except ValueError:
            self._send_json(400, bad_request(
                "Content-Length must be an integer").to_body())
            return
        if length < 0:
            self._send_json(400, bad_request("negative Content-Length")
                            .to_body())
            return
        if length > MAX_BODY_BYTES:
            self._send_json(413, ApiError(
                "body-too-large",
                f"request body exceeds {MAX_BODY_BYTES} bytes", 413).to_body())
            return
        raw = self.rfile.read(length) if length else b""
        if raw.strip():
            try:
                body = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_json(400, bad_request(
                    "request body must be JSON").to_body())
                return
            if not isinstance(body, dict):
                self._send_json(400, bad_request(
                    "request body must be a JSON object").to_body())
                return
        else:
            body = {}

        query_list = parse_qs(parsed.query, keep_blank_values=True)
        query = {key: values[0] for key, values in query_list.items()}
        req = Request(method=self.command, path=api_path, query=query,
                      query_list=query_list, body=body,
                      client_ip=self.client_address[0])
        if auth_mod.auth_required():
            req.enforce_auth = True
            req.session_token = auth_mod.token_from_cookie_header(
                self.headers.get("Cookie"))
            req.user = auth_mod.user_for_session(req.session_token)
        try:
            status, response = dispatch(req)
        except ApiError as exc:
            status, response = exc.status, exc.to_body()
        except Exception as exc:  # noqa: BLE001 - 500 envelope, never a crash
            status, response = 500, {"error": {
                "code": "internal",
                "message": secrets_mod.redact(
                    str(exc) or "internal error")[:500],
            }}
        if isinstance(response, RawBody):
            self._send_bytes(status, response.data, response.content_type)
        else:
            extra = {"Set-Cookie": req.set_cookie} if req.set_cookie else None
            self._send_json(status, response, extra)


class Server(ThreadingHTTPServer):
    daemon_threads = True


def create_server(host: str = DEFAULT_HOST,
                 port: int = DEFAULT_PORT) -> Server:
    return Server((host, port), Handler)


def run(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    with create_server(host, port) as server:
        actual = server.server_address[1]
        print(f"kgsm worker api on http://{host}:{actual}/api/v1",
              flush=True)
        server.serve_forever()


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="kgsm-api",
                                     description="KGSM worker JSON HTTP API")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args(argv)
    # Contract §11: loopback only. An allowlist (not a 0.0.0.0/:: denylist)
    # so LAN IPs can never bind beyond loopback either.
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        parser.error("refusing a non-loopback bind; use 127.0.0.1 "
                     "(contract §11)")
    run(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
