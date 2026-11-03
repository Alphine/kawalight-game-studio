"""Account routes: register, login, logout, and the current-user probe.

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
    email = req.body.get("email")
    password = req.body.get("password")
    try:
        ctx = auth_mod.register(email, password)
        token, _ = auth_mod.login(email, password, req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    req.set_cookie = auth_mod.session_cookie(token)
    return 201, {"user": _user(ctx)}


def login(req: Request) -> tuple[int, dict]:
    try:
        token, ctx = auth_mod.login(req.body.get("email"),
                                    req.body.get("password"), req.client_ip)
    except auth_mod.AuthError as exc:
        raise _raise(exc) from None
    req.set_cookie = auth_mod.session_cookie(token)
    return 200, {"user": _user(ctx)}


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
    ("POST", r"/auth/logout", logout),
    ("GET", r"/auth/me", me),
]
