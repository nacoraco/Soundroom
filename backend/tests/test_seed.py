from fastapi.testclient import TestClient

from app.seed import seed_initial_listener

from .utils import login


def test_default_listener_is_seeded_and_can_log_in(
    client: TestClient, db_session
):
    seed_initial_listener(db_session)

    response = login(
        client,
        email="listener@example.com",
        password="listener-password",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == "listener@example.com"
    assert data["user"]["role"] == "listener"
    assert data["csrf_token"]
