"""Account routes: register, confirm email, sign in/out, and password reset.

Replies that must not reveal whether an address has an account (resend,
forgot password) always look the same.

Session tokens travel only in an HttpOnly cookie (never in JSON), so page
scripts cannot read them. The cookie is SameSite=Strict, and mutating
requests still need a JSON content type and an allowed Origin.
"""

from __future__ import annotations

from .. import auth as auth_mod
from . import ApiError, Request


def _user(ctx: auth_mod.AuthContext) -> dict:
    return {"id": ctx.user_id, "email": ctx.email, "isAdmin": ctx.is_admin}


def _raise(exc: auth_mod.AuthError) -> ApiError:
    return ApiError(exc.code, exc.message, exc.status)


def register(req: Request) -> tuple[int, dict]:
    try:
        ctx = auth_mod.register(req.body.get("email"), req.body.get("password"),
                                req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    # No session yet: the address must be confirmed from the emailed link first.
    return 201, {"status": "verification-sent", "email": ctx.email}


def login(req: Request) -> tuple[int, dict]:
    try:
        token, ctx = auth_mod.login(req.body.get("email"),
                                    req.body.get("password"), req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    req.set_cookie = auth_mod.session_cookie(token)
    return 200, {"user": _user(ctx)}


def verify(req: Request) -> tuple[int, dict]:
    try:
        token, ctx = auth_mod.verify_email(req.body.get("token"))
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    req.set_cookie = auth_mod.session_cookie(token)
    return 200, {"user": _user(ctx)}


def resend_verification(req: Request) -> tuple[int, dict]:
    try:
        auth_mod.resend_verification(req.body.get("email"), req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    return 200, {"status": "sent-if-pending"}


def forgot_password(req: Request) -> tuple[int, dict]:
    try:
        auth_mod.request_password_reset(req.body.get("email"), req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    return 200, {"status": "sent-if-registered"}


def reset_password(req: Request) -> tuple[int, dict]:
    try:
        auth_mod.reset_password(req.body.get("token"), req.body.get("password"))
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    return 200, {"status": "password-updated"}


def logout(req: Request) -> tuple[int, dict]:
    auth_mod.revoke_session(req.session_token)
    req.set_cookie = auth_mod.clear_cookie()
    return 200, {"loggedOut": True}


def me(req: Request) -> tuple[int, dict]:
    if req.user is not None:
        return 200, {"authRequired": True, "user": _user(req.user)}
    if not req.enforce_auth:
        # Desktop and local dev: no sign-in, the caller is the local owner.
        return 200, {"authRequired": False,
                     "user": {"id": "local", "email": "local", "isAdmin": True}}
    raise ApiError("unauthenticated", "sign in to continue", 401)


ROUTES = [
    ("POST", r"/auth/register", register),
    ("POST", r"/auth/login", login),
    ("POST", r"/auth/verify", verify),
    ("POST", r"/auth/resend-verification", resend_verification),
    ("POST", r"/auth/forgot-password", forgot_password),
    ("POST", r"/auth/reset-password", reset_password),
    ("POST", r"/auth/logout", logout),
    ("GET", r"/auth/me", me),
]
