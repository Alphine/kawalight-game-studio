"""Shared stdlib HTTP core for OpenAI-compatible providers (FR-006).

Both the generic ``openai-compat`` image adapter and the Meta/Llama preset
speak OpenAI-shaped JSON over HTTPS with a Bearer [REDACTED] This module holds
that machinery in one place -- timeout/base-URL validation, POST + error
mapping with key redaction, SSRF guards -- so adapters share it instead of
duplicating it. ``urllib`` only; no third-party SDK.
"""

from __future__ import annotations

import ipaddress
import json
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .base import ProviderError

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

_GUARD_INSTALLED = False


def host_is_loopback(host: str) -> bool:
    if (host or "").lower() in _LOOPBACK_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def host_is_blocked(host: str) -> bool:
    """True when *host* must never be fetched (SSRF guard).

    Literal private/loopback/link-local/reserved IPs are always blocked.
    DNS names are resolved and blocked when they settle on such an
    address; an unresolvable name is allowed through so the fetch itself
    fails naturally (and fails closed as a ProviderError).

    Residual risk (DNS TOCTOU/rebind): the name is validated at check
    time but ``urllib`` re-resolves at connect time, so a hostile DNS
    that flips between the two can bypass the guard. Pinning the
    validated IP for the fetch would need a custom connector; stdlib
    ``urllib`` offers none, so this check plus the redirect guard below
    is the mitigation, not a proof.
    """
    if not host:
        return True
    lowered = host.lower()
    if lowered == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_private or \
            ipaddress.ip_address(host).is_loopback or \
            ipaddress.ip_address(host).is_link_local or \
            ipaddress.ip_address(host).is_reserved or \
            ipaddress.ip_address(host).is_multicast
    except ValueError:
        pass  # not a literal IP: resolve below
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, OSError):
        return False
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if addr.is_private or addr.is_loopback or addr.is_link_local \
                or addr.is_reserved or addr.is_multicast:
            return True
    return False


def positive_int(value: object) -> int | None:
    """Coerce *value* to an int >= 0, else None (honest unknown)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and value.strip():
        try:
            parsed = int(value.strip())
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None


def validate_timeout(timeout_s: object, default: float) -> float:
    """Return a usable timeout, or raise ValueError (constructor misuse)."""
    if timeout_s is None:
        return default
    if (
        isinstance(timeout_s, bool)
        or not isinstance(timeout_s, (int, float))
        or timeout_s <= 0
    ):
        raise ValueError("timeout_s must be a positive number of seconds")
    return timeout_s


def require_api_key(
    api_key: str | None, provider_id: str, secret_name: str,
) -> str:
    """Return *api_key*, or raise a ProviderError naming the secret to set."""
    if not api_key:
        raise ProviderError(
            f"{provider_id}: no API key configured "
            f"(store one as secret {secret_name!r})"
        )
    return api_key


def check_request_host(url: str, provider_id: str) -> None:
    """Reject requests whose host is SSRF-blocked (shared guard).

    The Bearer [REDACTED] travels on every request, so a user-supplied base
    URL (or a provider redirect target) must never point at private,
    loopback, link-local, or reserved hosts -- with one explicit
    exception: cleartext ``http://`` loopback stays allowed for local
    gateway development (mirrors :func:`validate_base_url`).
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        raise ProviderError(
            f"{provider_id}: request URL is not parseable"
        ) from None
    host = parts.hostname or ""
    if parts.scheme == "http" and host_is_loopback(host):
        return  # explicit local-gateway exception
    if host_is_blocked(host):
        raise ProviderError(
            f"{provider_id}: request host is not allowed"
        )


def validate_base_url(base_url: str, provider_id: str) -> None:
    """Reject non-HTTP(S) roots, cleartext secrets off loopback, and
    blocked hosts (a user-supplied base URL must never receive the key
    at a private/link-local/reserved address)."""
    if not base_url.startswith(("http://", "https://")):
        raise ProviderError(
            f"{provider_id}: base URL must start with http:// or https://: "
            f"{base_url!r}"
        )
    # The Bearer [REDACTED] travels on every request: require TLS unless the
    # endpoint is explicitly loopback (local gateway development).
    scheme, _, _rest = base_url.partition("://")
    host = urlsplit(base_url).hostname or ""
    if scheme == "http" and not host_is_loopback(host):
        raise ProviderError(
            f"{provider_id}: base URL must use https:// outside "
            f"loopback: {base_url!r}"
        )
    check_request_host(base_url, provider_id)


def http_detail(exc: urllib.error.HTTPError, api_key: str) -> str:
    try:
        detail = exc.read().decode("utf-8", "replace").strip()[:500]
    except Exception:  # noqa: BLE001 - error detail is best effort
        return ""
    if not detail:
        return ""
    if api_key and api_key in detail:  # defense in depth; never leak the key
        detail = detail.replace(api_key, "***")
    return f": {detail}"


def post_json(
    url: str, payload: dict, *, api_key: str, timeout_s: float,
    provider_id: str, what: str,
) -> bytes:
    """POST *payload* as JSON with a Bearer [REDACTED] return raw bytes.

    *what* names the request in errors (e.g. ``"images request"``).
    Every transport failure becomes a ProviderError; the key is redacted
    from surfaced provider messages.
    """
    check_request_host(url, provider_id)  # defense in depth: base URLs
    # configured after validate_base_url, or passed directly, are checked
    # again at send time.
    ensure_redirect_guard()  # every redirect hop re-validated pre-fetch
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        return urllib.request.urlopen(request, timeout=timeout_s).read()
    except urllib.error.HTTPError as exc:
        raise ProviderError(
            f"{provider_id}: {what} failed with HTTP {exc.code}"
            + http_detail(exc, api_key)
        ) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(
            f"{provider_id}: request failed: {exc}"
        ) from None


class SSRFRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only to SSRF-allowed hosts.

    ``urllib`` follows 301/302/303/307/308 by default, so a provider
    redirect (e.g. a 302 to 169.254.169.254/metadata) would bypass the
    pre-fetch host check. Every hop is re-validated here, before it is
    fetched; a blocked hop fails closed as a ProviderError.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            host = urlsplit(newurl).hostname or ""
        except ValueError:
            host = ""
        if host_is_blocked(host):
            # No URL in the message: redirect targets may carry signed-URL
            # tokens that must never surface in errors or logs.
            raise ProviderError("redirect target host is not allowed")
        return super().redirect_request(
            req, fp, code, msg, headers, newurl)


def ensure_redirect_guard() -> None:
    """Install the redirect-guarding default opener (idempotent).

    The installed opener is otherwise equivalent to ``urllib``'s
    default; only redirect targets gain validation. Nothing else in
    this worker process customizes the global opener, and the guard is
    stateless, so sharing it across threads is safe.
    """
    global _GUARD_INSTALLED
    if _GUARD_INSTALLED:
        return
    urllib.request.install_opener(
        urllib.request.build_opener(SSRFRedirectHandler()))
    _GUARD_INSTALLED = True


def decode_json(raw: bytes, provider_id: str) -> object:
    """Decode *raw* as JSON, else raise ProviderError.

    Shape checks stay with the caller: a valid JSON value of the wrong
    shape is a missing-field error, not a decode error.
    """
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProviderError(
            f"{provider_id}: invalid JSON response: {exc}"
        ) from None
