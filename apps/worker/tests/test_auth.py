"""Accounts, session cookies, project isolation, admin gates, and quotas.

Runs the real HTTP server with ``KGSM_REQUIRE_AUTH`` on, so the cookie,
enforcement, and ownership paths are exercised end to end.
"""

import json
import threading
import urllib.error
import urllib.request

import pytest

from kgsm import auth
from kgsm.api.server import create_server

ADMIN = "admin@example.com"
ALICE = "alice@example.com"
BOB = "bob@example.com"
PASSWORD = "correct-horse-battery"


@pytest.fixture()
def live(store, monkeypatch):
    monkeypatch.setenv("KGSM_REQUIRE_AUTH", "1")
    monkeypatch.setenv("KGSM_ADMIN_EMAIL", ADMIN)
    auth.reset_throttle()
    server = create_server("127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever,
                              kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/api/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)


def request(base, method, path, body=None, cookie=None):
    """Return (status, json_body, set_cookie_header)."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if cookie:
        headers["Cookie"] = f"kgsm_session={cookie}"
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"null"), \
                resp.headers.get("Set-Cookie")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"null"), \
            exc.headers.get("Set-Cookie")


def session_token(set_cookie):
    assert set_cookie and set_cookie.startswith("kgsm_session=")
    return set_cookie.split(";", 1)[0].split("=", 1)[1]


def signup(base, email):
    status, body, cookie = request(base, "POST", "/auth/register",
                                   {"email": email, "password": PASSWORD})
    assert status == 201, body
    return session_token(cookie)


# ---------------------------------------------------------------------------
# Enforcement and sessions
# ---------------------------------------------------------------------------

def test_protected_routes_need_a_session(live):
    status, body, _ = request(live, "GET", "/projects")
    assert status == 401
    assert body["error"]["code"] == "unauthenticated"


def test_health_and_auth_probe_stay_public(live):
    assert request(live, "GET", "/health")[0] == 200
    status, body, _ = request(live, "GET", "/auth/me")
    assert status == 401 and body["error"]["code"] == "unauthenticated"


def test_register_sets_hardened_cookie_and_signs_in(live):
    status, body, cookie = request(live, "POST", "/auth/register",
                                   {"email": ALICE, "password": PASSWORD})
    assert status == 201
    assert body["user"] == {"id": body["user"]["id"], "email": ALICE,
                            "isAdmin": False}
    for flag in ("HttpOnly", "Secure", "SameSite=Strict"):
        assert flag in cookie
    # The raw token must never appear in the JSON body.
    assert session_token(cookie) not in json.dumps(body)
    status, me, _ = request(live, "GET", "/auth/me", cookie=session_token(cookie))
    assert status == 200 and me["user"]["email"] == ALICE


def test_register_rejects_duplicates_and_bad_input(live):
    signup(live, ALICE)
    status, body, _ = request(live, "POST", "/auth/register",
                              {"email": ALICE, "password": PASSWORD})
    assert status == 409 and body["error"]["code"] == "email-taken"
    status, body, _ = request(live, "POST", "/auth/register",
                              {"email": BOB, "password": "short"})
    assert status == 400
    status, body, _ = request(live, "POST", "/auth/register",
                              {"email": "not-an-email", "password": PASSWORD})
    assert status == 400


def test_login_rejects_wrong_password_and_accepts_right_one(live):
    signup(live, ALICE)
    status, body, _ = request(live, "POST", "/auth/login",
                              {"email": ALICE, "password": "wrong-password-1"})
    assert status == 401 and body["error"]["code"] == "invalid-credentials"
    status, body, cookie = request(live, "POST", "/auth/login",
                                   {"email": "ALICE@example.com ",
                                    "password": PASSWORD})
    assert status == 200 and session_token(cookie)


def test_login_is_throttled_after_repeated_failures(live):
    signup(live, ALICE)
    for _ in range(auth.LOGIN_MAX):
        request(live, "POST", "/auth/login",
                {"email": ALICE, "password": "wrong-password-1"})
    status, body, _ = request(live, "POST", "/auth/login",
                              {"email": ALICE, "password": PASSWORD})
    assert status == 429 and body["error"]["code"] == "too-many-attempts"


def test_logout_revokes_the_session(live):
    token = signup(live, ALICE)
    assert request(live, "GET", "/projects", cookie=token)[0] == 200
    status, _, cookie = request(live, "POST", "/auth/logout", {}, cookie=token)
    assert status == 200 and "Max-Age=0" in cookie
    assert request(live, "GET", "/projects", cookie=token)[0] == 401


def test_password_hash_roundtrip_and_salting():
    first = auth.hash_password(PASSWORD)
    second = auth.hash_password(PASSWORD)
    assert first != second  # fresh salt each time
    assert auth.verify_password(PASSWORD, first)
    assert not auth.verify_password("nope-nope-nope", first)
    assert not auth.verify_password(PASSWORD, "garbage")


# ---------------------------------------------------------------------------
# Project isolation
# ---------------------------------------------------------------------------

def test_users_only_see_and_touch_their_own_projects(live):
    alice = signup(live, ALICE)
    bob = signup(live, BOB)
    status, body, _ = request(live, "POST", "/projects",
                              {"name": "Alice Game", "genre": "space-shooter"},
                              cookie=alice)
    assert status == 201
    pid = body["id"]

    status, listing, _ = request(live, "GET", "/projects", cookie=bob)
    assert status == 200 and listing["projects"] == []
    status, listing, _ = request(live, "GET", "/projects", cookie=alice)
    assert [p["id"] for p in listing["projects"]] == [pid]

    # A foreign project answers exactly like a missing one.
    assert request(live, "GET", f"/projects/{pid}", cookie=bob)[0] == 404
    assert request(live, "DELETE", f"/projects/{pid}", cookie=bob)[0] == 404
    assert request(live, "GET", f"/projects/{pid}", cookie=alice)[0] == 200


def test_story_cannot_spend_against_a_foreign_project(live):
    alice = signup(live, ALICE)
    bob = signup(live, BOB)
    _, body, _ = request(live, "POST", "/projects",
                         {"name": "Mine", "genre": "farming"}, cookie=alice)
    status, body, _ = request(live, "POST", "/stories/generate",
                              {"providerId": "mock", "prompt": "a tale",
                               "projectId": body["id"]}, cookie=bob)
    assert status == 404 and body["error"]["code"] == "project-not-found"


# ---------------------------------------------------------------------------
# Admin gates
# ---------------------------------------------------------------------------

def test_admin_only_routes_refuse_regular_users(live):
    alice = signup(live, ALICE)
    status, body, _ = request(live, "GET", "/secrets", cookie=alice)
    assert status == 403 and body["error"]["code"] == "forbidden"
    status, _, _ = request(live, "GET", "/backups", cookie=alice)
    assert status == 403


def test_admin_account_reaches_admin_routes(live):
    admin = signup(live, ADMIN)
    status, body, _ = request(live, "GET", "/secrets", cookie=admin)
    assert status == 200 and "names" in body
    status, me, _ = request(live, "GET", "/auth/me", cookie=admin)
    assert me["user"]["isAdmin"] is True


def test_admin_sees_every_project(live):
    alice = signup(live, ALICE)
    admin = signup(live, ADMIN)
    _, body, _ = request(live, "POST", "/projects",
                         {"name": "Alice Only", "genre": "endless-runner"},
                         cookie=alice)
    status, listing, _ = request(live, "GET", "/projects", cookie=admin)
    assert status == 200
    assert body["id"] in [p["id"] for p in listing["projects"]]


# ---------------------------------------------------------------------------
# Daily quota for paid generation
# ---------------------------------------------------------------------------

def test_quota_limits_each_user_per_day(store, monkeypatch):
    monkeypatch.setenv("KGSM_REQUIRE_AUTH", "1")
    monkeypatch.setenv("KGSM_QUOTA_STORY_PER_DAY", "2")
    ctx = auth.AuthContext(user_id="u1", email=ALICE, is_admin=False)
    token = auth.bind(ctx)
    try:
        auth.consume_quota("story")
        auth.consume_quota("story")
        with pytest.raises(auth.AuthError) as exc:
            auth.consume_quota("story")
        assert exc.value.status == 429 and exc.value.code == "quota-exceeded"
    finally:
        auth.unbind(token)


def test_quota_is_separate_per_user_and_skipped_for_admin(store, monkeypatch):
    monkeypatch.setenv("KGSM_QUOTA_STORY_PER_DAY", "1")
    alice = auth.AuthContext(user_id="u1", email=ALICE, is_admin=False)
    bob = auth.AuthContext(user_id="u2", email=BOB, is_admin=False)
    admin = auth.AuthContext(user_id="u0", email=ADMIN, is_admin=True)
    for ctx in (alice, bob, admin):
        token = auth.bind(ctx)
        try:
            auth.consume_quota("story")
            if ctx is admin:
                auth.consume_quota("story")  # admin is never capped
        finally:
            auth.unbind(token)
    token = auth.bind(alice)
    try:
        with pytest.raises(auth.AuthError):
            auth.consume_quota("story")
    finally:
        auth.unbind(token)


def test_quota_does_nothing_without_enforcement(store, monkeypatch):
    monkeypatch.delenv("KGSM_REQUIRE_AUTH", raising=False)
    monkeypatch.setenv("KGSM_QUOTA_STORY_PER_DAY", "0")
    auth.consume_quota("story")  # desktop/tests: unscoped, never blocked
