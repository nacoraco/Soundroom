from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import User, UserRole, UserSession
from app.security import hash_password, hash_session_token

from .utils import ADMIN_EMAIL, ADMIN_PASSWORD, auth_headers, login


def test_login_success_sets_cookie_and_returns_csrf(client: TestClient):
    response = login(client)

    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == ADMIN_EMAIL
    assert data["user"]["role"] == "admin"
    assert len(data["csrf_token"]) == 64
    assert "password" not in response.text
    assert "password_hash" not in response.text

    set_cookie = response.headers["set-cookie"].lower()
    assert "soundroom_session=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "secure" not in set_cookie


def test_login_invalid_credentials_returns_generic_error(client: TestClient):
    wrong_password = login(client, password="wrong-password")
    unknown_user = login(client, email="nobody@example.com", password="whatever123")

    assert wrong_password.status_code == 401
    assert unknown_user.status_code == 401
    assert wrong_password.json()["detail"] == "Invalid email or password."
    assert unknown_user.json()["detail"] == "Invalid email or password."


def test_disabled_account_cannot_login(client: TestClient, db_session):
    user = User(
        email="disabled@example.com",
        display_name="Disabled",
        password_hash=hash_password("password123"),
        role=UserRole.listener,
        is_active=False,
    )
    db_session.add(user)
    db_session.commit()

    response = login(client, email="disabled@example.com", password="password123")

    assert response.status_code == 403
    assert response.json()["detail"] == "Account is disabled."


def test_me_requires_session_and_returns_same_csrf(client: TestClient):
    assert client.get("/api/auth/me").status_code == 401

    login_response = login(client)
    csrf_token = login_response.json()["csrf_token"]

    me_response = client.get("/api/auth/me")

    assert me_response.status_code == 200
    assert me_response.json()["csrf_token"] == csrf_token
    assert me_response.json()["user"]["email"] == ADMIN_EMAIL


def test_logout_requires_csrf_and_revokes_session(client: TestClient):
    csrf_token = login(client).json()["csrf_token"]

    without_csrf = client.post("/api/auth/logout")
    assert without_csrf.status_code == 403
    assert client.get("/api/auth/me").status_code == 200

    logout = client.post("/api/auth/logout", headers=auth_headers(csrf_token))
    assert logout.status_code == 204
    assert "soundroom_session=" in logout.headers["set-cookie"].lower()
    assert "max-age=0" in logout.headers["set-cookie"].lower()

    assert client.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected(client: TestClient, db_session):
    login(client)
    token = client.cookies.get("soundroom_session")
    assert token

    session = db_session.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )
    assert session is not None
    session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.add(session)
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401


def test_revoked_session_is_rejected(client: TestClient, db_session):
    login(client)
    token = client.cookies.get("soundroom_session")
    assert token

    session = db_session.scalar(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )
    assert session is not None
    session.revoked_at = datetime.now(timezone.utc)
    db_session.add(session)
    db_session.commit()

    assert client.get("/api/auth/me").status_code == 401
