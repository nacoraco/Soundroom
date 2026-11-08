import pytest
from fastapi.testclient import TestClient

from .utils import auth_headers, login


@pytest.fixture
def admin_session(client: TestClient):
    response = login(client)
    assert response.status_code == 200
    data = response.json()
    return data["user"], data["csrf_token"]


def create_user(
    client: TestClient,
    csrf_token: str,
    email: str = "listener@example.com",
    role: str = "listener",
    password: str = "password123",
):
    return client.post(
        "/api/admin/users",
        json={
            "email": email,
            "display_name": "Test User",
            "password": password,
            "role": role,
        },
        headers=auth_headers(csrf_token),
    )


def test_admin_can_create_and_list_users(client: TestClient, admin_session):
    _, csrf_token = admin_session

    created = create_user(client, csrf_token)

    assert created.status_code == 201
    body = created.json()
    assert body["email"] == "listener@example.com"
    assert body["role"] == "listener"
    assert body["is_active"] is True

    listing = client.get("/api/admin/users")
    assert listing.status_code == 200
    emails = [user["email"] for user in listing.json()]
    assert "admin@example.com" in emails
    assert "listener@example.com" in emails


def test_admin_cannot_create_duplicate_email(client: TestClient, admin_session):
    _, csrf_token = admin_session

    assert create_user(client, csrf_token).status_code == 201
    duplicate = create_user(client, csrf_token)

    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]


def test_admin_role_cannot_be_assigned(client: TestClient, admin_session):
    _, csrf_token = admin_session

    response = create_user(client, csrf_token, role="admin")

    assert response.status_code == 422


def test_non_admin_cannot_manage_users(client: TestClient, admin_session):
    _, csrf_token = admin_session
    create_user(client, csrf_token)

    other_client = TestClient(client.app)
    listener_login = login(
        other_client, email="listener@example.com", password="password123"
    )
    assert listener_login.status_code == 200
    listener_csrf = listener_login.json()["csrf_token"]

    assert other_client.get("/api/admin/users").status_code == 403
    forbidden = other_client.post(
        "/api/admin/users",
        json={
            "email": "another@example.com",
            "display_name": "Another",
            "password": "password123",
            "role": "listener",
        },
        headers=auth_headers(listener_csrf),
    )
    assert forbidden.status_code == 403

    other_client.close()


def test_deactivation_revokes_sessions_and_blocks_login(
    client: TestClient, admin_session
):
    _, csrf_token = admin_session
    created = create_user(client, csrf_token)
    listener_id = created.json()["id"]

    listener_client = TestClient(client.app)
    listener_login = login(
        listener_client, email="listener@example.com", password="password123"
    )
    assert listener_login.status_code == 200

    deactivated = client.patch(
        f"/api/admin/users/{listener_id}",
        json={"is_active": False},
        headers=auth_headers(csrf_token),
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    assert listener_client.get("/api/auth/me").status_code == 401
    assert (
        login(
            listener_client,
            email="listener@example.com",
            password="password123",
        ).status_code
        == 403
    )

    listener_client.close()


def test_admin_can_change_user_role(client: TestClient, admin_session):
    _, csrf_token = admin_session
    created = create_user(client, csrf_token)

    updated = client.patch(
        f"/api/admin/users/{created.json()['id']}",
        json={"role": "editor"},
        headers=auth_headers(csrf_token),
    )

    assert updated.status_code == 200
    assert updated.json()["role"] == "editor"


def test_admin_cannot_deactivate_self(client: TestClient, admin_session):
    admin, csrf_token = admin_session

    response = client.patch(
        f"/api/admin/users/{admin['id']}",
        json={"is_active": False},
        headers=auth_headers(csrf_token),
    )

    assert response.status_code == 400


def test_admin_list_does_not_expose_password_hash(client: TestClient, admin_session):
    _ = admin_session

    response = client.get("/api/admin/users")

    assert response.status_code == 200
    assert "password_hash" not in response.text
    assert "password" not in response.text


def test_new_user_can_login_with_temporary_password(
    client: TestClient, admin_session
):
    _, csrf_token = admin_session
    create_user(client, csrf_token, password="temporary-123")

    other_client = TestClient(client.app)
    response = login(other_client, email="listener@example.com", password="temporary-123")
    assert response.status_code == 200
    other_client.close()


def test_weak_password_is_rejected(client: TestClient, admin_session):
    _, csrf_token = admin_session

    response = create_user(client, csrf_token, password="short")

    assert response.status_code == 422
