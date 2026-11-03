"""Accounts, sessions, and per-user quotas for the public web deployment.

Enforcement is off by default, so the desktop shell and local dev keep their
single-user behaviour. Set ``KGSM_REQUIRE_AUTH=1`` on a public server:

- every route except the health and auth endpoints needs a session cookie;
- a user sees and changes only the projects they own;
- admin-only routes (secrets, backups, path imports, the auto pipeline,
  global cost limits) need the admin account, which is the user whose email
  equals ``KGSM_ADMIN_EMAIL``;
- non-admin users get a daily quota of paid AI generations.

Passwords use stdlib ``scrypt``. Session tokens are random; only their
SHA-256 is stored. Failed logins are rate-limited in memory per email and
per client IP.
"""

from __future__ import annotations

import contextvars
import hashlib
import hmac
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import db as db_mod
from . import mailer

# __Host- prefix: browsers only accept it with Secure, Path=/, and no Domain.
SESSION_COOKIE = "__Host-kgsm_session"
SESSION_DAYS = 30
MIN_PASSWORD = 10
MAX_PASSWORD = 200
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")

# Login throttling: at most LOGIN_MAX failures per window, per email and per IP.
LOGIN_MAX = 10
LOGIN_WINDOW_S = 900
# Account creation is cheap to script, so cap sign-ups per client IP.
REGISTER_MAX = 20
REGISTER_WINDOW_S = 3600
# Confirmation and reset mail: a few per address and per client per window.
MAIL_MAX = 5
MAIL_WINDOW_S = 900

_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (user_id, day, kind)
);
"""


class AuthError(Exception):
    """Carries an HTTP-facing code, message, and status for the route layer."""

    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    email: str
    is_admin: bool


_CURRENT: contextvars.ContextVar[AuthContext | None] = contextvars.ContextVar(
    "kgsm_auth_context", default=None)


def bind(ctx: AuthContext | None) -> contextvars.Token:
    """Make ``ctx`` the request's identity; pair with :func:`unbind`."""
    return _CURRENT.set(ctx)


def unbind(token: contextvars.Token) -> None:
    _CURRENT.reset(token)


def current() -> AuthContext | None:
    return _CURRENT.get()


def scoped_owner_id() -> str | None:
    """User id that limits project visibility, or None for unscoped access.

    None means the caller is the admin, or auth is not enforced (desktop and
    tests). Only a signed-in non-admin user gets a scoped id.
    """
    ctx = _CURRENT.get()
    if ctx is None or ctx.is_admin:
        return None
    return ctx.user_id


def auth_required() -> bool:
    return os.environ.get("KGSM_REQUIRE_AUTH", "").strip().lower() in (
        "1", "true", "yes", "on")


def admin_email() -> str:
    return os.environ.get("KGSM_ADMIN_EMAIL", "").strip().lower()


def _is_admin(email: str) -> bool:
    configured = admin_email()
    return bool(configured) and email.lower() == configured


def _conn():
    conn = db_mod.connect()
    conn.executescript(_SCHEMA)
    _migrate_users(conn)
    return conn


def _migrate_users(conn) -> None:
    """Add email verification. Accounts created before it are grandfathered
    as verified. Runs once, when the column first appears."""
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    if "email_verified_at" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN email_verified_at TEXT NULL")
        conn.execute("UPDATE users SET email_verified_at = created_at")
        conn.commit()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N,
                            r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, digest_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode("utf-8"),
                                salt=bytes.fromhex(salt_hex), n=int(n),
                                r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------------------------------------------------------------------------
# Login throttling (in-memory; the worker is a single process)
# ---------------------------------------------------------------------------

_fail_lock = threading.Lock()
_failures: dict[str, list[float]] = {}


def _throttled(keys: list[str], limit: int = LOGIN_MAX,
               window: float = LOGIN_WINDOW_S) -> bool:
    cutoff = time.monotonic() - window
    with _fail_lock:
        for key in keys:
            recent = [t for t in _failures.get(key, []) if t > cutoff]
            if recent:
                _failures[key] = recent
            else:
                # Drop idle keys so the table cannot grow without bound.
                _failures.pop(key, None)
            if len(recent) >= limit:
                return True
    return False


def _record_failure(keys: list[str]) -> None:
    now = time.monotonic()
    with _fail_lock:
        for key in keys:
            _failures.setdefault(key, []).append(now)


def reset_throttle() -> None:
    """Test hook: forget recorded login failures."""
    with _fail_lock:
        _failures.clear()


# ---------------------------------------------------------------------------
# Accounts and sessions
# ---------------------------------------------------------------------------

def normalize_email(email: object) -> str:
    if not isinstance(email, str):
        raise AuthError("bad-request", "email must be a string", 400)
    cleaned = email.strip().lower()
    if len(cleaned) > 254 or not _EMAIL_RE.match(cleaned):
        raise AuthError("bad-request", "enter a valid email address", 400)
    return cleaned


def _check_password(password: object) -> str:
    if not isinstance(password, str):
        raise AuthError("bad-request", "password must be a string", 400)
    if len(password) < MIN_PASSWORD:
        raise AuthError("bad-request",
                        f"password must be at least {MIN_PASSWORD} characters",
                        400)
    if len(password) > MAX_PASSWORD:
        raise AuthError("bad-request",
                        f"password must be at most {MAX_PASSWORD} characters",
                        400)
    return password


def _open_session(conn, user_id: str) -> str:
    token = os.urandom(32).hex()
    now = _now()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)"
        " VALUES (?, ?, ?, ?)",
        (_digest(token), user_id, now.isoformat(),
         (now + timedelta(days=SESSION_DAYS)).isoformat()))
    return token


def _issue_email_token(conn, user_id: str, purpose: str, ttl: timedelta) -> str:
    """Create a single-use token and retire older unused tokens of the same purpose."""
    now = _now()
    conn.execute(
        "UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ?"
        " AND used_at IS NULL", (now.isoformat(), user_id, purpose))
    token = os.urandom(32).hex()
    conn.execute(
        "INSERT INTO email_tokens (token_hash, user_id, purpose, created_at,"
        " expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
        (_digest(token), user_id, purpose, now.isoformat(),
         (now + ttl).isoformat()))
    return token


def _take_email_token(conn, token: object, purpose: str) -> str:
    """Validate and consume a token. Returns the user id or raises AuthError."""
    if not isinstance(token, str) or len(token) != 64:
        raise AuthError("invalid-token", "this link is invalid or has expired", 400)
    row = conn.execute(
        "SELECT user_id, expires_at, used_at FROM email_tokens"
        " WHERE token_hash = ? AND purpose = ?", (_digest(token), purpose)).fetchone()
    if row is None or row["used_at"] is not None \
            or datetime.fromisoformat(row["expires_at"]) <= _now():
        raise AuthError("invalid-token", "this link is invalid or has expired", 400)
    conn.execute("UPDATE email_tokens SET used_at = ? WHERE token_hash = ?",
                 (_now().isoformat(), _digest(token)))
    return row["user_id"]


def _send_verification(conn, user_id: str, email: str) -> None:
    token = _issue_email_token(conn, user_id, "verify", timedelta(hours=24))
    subject, text = mailer.verification_message(
        f"{mailer.public_url()}/?verify={token}")
    mailer.send(email, subject, text)


def register(email: object, password: object, client_ip: str = "") -> AuthContext:
    """Create an unverified account and email a confirmation link.

    No session is issued here; the account signs in after confirming. If the
    email cannot be sent, the account is removed so the user can retry.
    """
    email_n = normalize_email(email)
    password_s = _check_password(password)
    ip_key = f"register:{client_ip}"
    if _throttled([ip_key], REGISTER_MAX, REGISTER_WINDOW_S):
        raise AuthError("too-many-attempts",
                        "too many sign-ups from this network; try again later", 429)
    _record_failure([ip_key])
    conn = _conn()
    user_id = uuid.uuid4().hex
    try:
        exists = conn.execute("SELECT 1 FROM users WHERE email = ?",
                              (email_n,)).fetchone()
        if exists:
            raise AuthError("email-taken",
                            "an account with this email already exists", 409)
        conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at,"
            " email_verified_at) VALUES (?, ?, ?, ?, NULL)",
            (user_id, email_n, hash_password(password_s), _now().isoformat()))
        conn.commit()
        try:
            _send_verification(conn, user_id, email_n)
            conn.commit()
        except mailer.MailError as exc:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            raise AuthError("mail-unavailable", str(exc), 503) from None
    finally:
        conn.close()
    return AuthContext(user_id=user_id, email=email_n,
                       is_admin=_is_admin(email_n))


def login(email: object, password: object, client_ip: str) -> tuple[str, AuthContext]:
    """Verify credentials and open a session. Returns (raw token, context)."""
    email_n = normalize_email(email)
    if not isinstance(password, str):
        raise AuthError("bad-request", "password must be a string", 400)
    # Keyed by email AND client IP: one attacker cannot lock a victim's account
    # from anywhere, and one IP cannot stall every other user.
    keys = [f"login:{email_n}|{client_ip}", f"ip:{client_ip}"]
    if _throttled(keys):
        raise AuthError("too-many-attempts",
                        "too many failed logins; wait 15 minutes", 429)
    conn = _conn()
    try:
        row = conn.execute("SELECT id, email, password_hash, email_verified_at"
                           " FROM users WHERE email = ?", (email_n,)).fetchone()
        stored = row["password_hash"] if row else _DUMMY_HASH
        ok = verify_password(password, stored)
        if row is None or not ok:
            _record_failure(keys)
            raise AuthError("invalid-credentials",
                            "email or password is incorrect", 401)
        if row["email_verified_at"] is None:
            raise AuthError("email-not-verified",
                            "confirm your email first; we sent a link to your inbox", 403)
        token = _open_session(conn, row["id"])
        conn.commit()
    finally:
        conn.close()
    return token, AuthContext(user_id=row["id"], email=row["email"],
                              is_admin=_is_admin(row["email"]))


def verify_email(token: object) -> tuple[str, AuthContext]:
    """Confirm the address from an emailed link, then sign the user in."""
    conn = _conn()
    try:
        user_id = _take_email_token(conn, token, "verify")
        conn.execute("UPDATE users SET email_verified_at = ?"
                     " WHERE id = ? AND email_verified_at IS NULL",
                     (_now().isoformat(), user_id))
        row = conn.execute("SELECT id, email FROM users WHERE id = ?",
                           (user_id,)).fetchone()
        session = _open_session(conn, user_id)
        conn.commit()
    finally:
        conn.close()
    return session, AuthContext(user_id=row["id"], email=row["email"],
                                is_admin=_is_admin(row["email"]))


def resend_verification(email: object, client_ip: str = "") -> None:
    """Send a fresh confirmation link if the account is still unverified.

    Always returns normally, so the reply never reveals whether an account exists.
    """
    email_n = normalize_email(email)
    keys = [f"mail:{email_n}", f"mailip:{client_ip}"]
    if _throttled(keys, MAIL_MAX, MAIL_WINDOW_S):
        return
    _record_failure(keys)
    conn = _conn()
    try:
        row = conn.execute("SELECT id, email, email_verified_at FROM users"
                           " WHERE email = ?", (email_n,)).fetchone()
        if row is not None and row["email_verified_at"] is None:
            try:
                _send_verification(conn, row["id"], row["email"])
                conn.commit()
            except mailer.MailError:
                conn.rollback()
    finally:
        conn.close()


def request_password_reset(email: object, client_ip: str = "") -> None:
    """Email a one-hour reset link if the account exists. Same reply either way."""
    email_n = normalize_email(email)
    keys = [f"mail:{email_n}", f"mailip:{client_ip}"]
    if _throttled(keys, MAIL_MAX, MAIL_WINDOW_S):
        return
    _record_failure(keys)
    conn = _conn()
    try:
        row = conn.execute("SELECT id, email FROM users WHERE email = ?",
                           (email_n,)).fetchone()
        if row is not None:
            token = _issue_email_token(conn, row["id"], "reset", timedelta(hours=1))
            subject, text = mailer.reset_message(
                f"{mailer.public_url()}/?reset={token}")
            try:
                mailer.send(row["email"], subject, text)
                conn.commit()
            except mailer.MailError:
                conn.rollback()
    finally:
        conn.close()


def reset_password(token: object, password: object) -> None:
    """Set a new password from a reset link and revoke every existing session."""
    password_s = _check_password(password)
    conn = _conn()
    try:
        user_id = _take_email_token(conn, token, "reset")
        # A reset link proves the inbox, so it also verifies the address.
        conn.execute("UPDATE users SET password_hash = ?,"
                     " email_verified_at = COALESCE(email_verified_at, ?)"
                     " WHERE id = ?",
                     (hash_password(password_s), _now().isoformat(), user_id))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Used when the email is unknown, so login timing does not reveal accounts.
_DUMMY_HASH = hash_password(os.urandom(12).hex())


def user_for_session(token: str | None) -> AuthContext | None:
    if not token or len(token) != 64:
        return None
    conn = _conn()
    try:
        row = conn.execute(
            "SELECT u.id, u.email, s.expires_at FROM sessions s"
            " JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
            (_digest(token),)).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    if datetime.fromisoformat(row["expires_at"]) <= _now():
        return None
    return AuthContext(user_id=row["id"], email=row["email"],
                       is_admin=_is_admin(row["email"]))


def revoke_session(token: str | None) -> None:
    if not token or len(token) != 64:
        return
    conn = _conn()
    try:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?",
                     (_digest(token),))
        conn.commit()
    finally:
        conn.close()


def token_from_cookie_header(header: str | None) -> str | None:
    """Pull the raw session token out of a ``Cookie`` header, if present."""
    if not header:
        return None
    for part in header.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE:
            return value or None
    return None


def session_cookie(token: str) -> str:
    return (f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; Secure; "
            f"SameSite=Strict; Max-Age={SESSION_DAYS * 24 * 3600}")


def clear_cookie() -> str:
    return (f"{SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; "
            "Max-Age=0")


# ---------------------------------------------------------------------------
# Daily quota for paid generation (non-admin users only)
# ---------------------------------------------------------------------------

_quota_lock = threading.Lock()


def _quota_limit(kind: str) -> int:
    env = {"story": "KGSM_QUOTA_STORY_PER_DAY",
           "image": "KGSM_QUOTA_IMAGE_PER_DAY"}[kind]
    default = {"story": 10, "image": 6}[kind]
    raw = os.environ.get(env, "").strip()
    try:
        return max(0, int(raw)) if raw else default
    except ValueError:
        return default


def consume_quota(kind: str, amount: int = 1) -> None:
    """Spend ``amount`` of today's quota for the current non-admin user.

    No-op for admins and unscoped (desktop/test) callers. Raises AuthError
    with status 429 once the daily limit is reached.
    """
    owner = scoped_owner_id()
    if owner is None:
        return
    limit = _quota_limit(kind)
    day = _now().date().isoformat()
    with _quota_lock:
        conn = _conn()
        try:
            row = conn.execute(
                "SELECT count FROM ai_usage WHERE user_id = ? AND day = ?"
                " AND kind = ?", (owner, day, kind)).fetchone()
            used = row["count"] if row else 0
            if used + amount > limit:
                raise AuthError(
                    "quota-exceeded",
                    f"daily {kind} limit reached ({limit}); try again tomorrow",
                    429)
            conn.execute(
                "INSERT INTO ai_usage (user_id, day, kind, count)"
                " VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day, kind)"
                " DO UPDATE SET count = count + excluded.count",
                (owner, day, kind, amount))
            conn.commit()
        finally:
            conn.close()
