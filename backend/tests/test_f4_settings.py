from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import RipJob, RipJobStatus, User

from .utils import auth_headers, login


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def create_user(
    client: TestClient,
    headers: dict[str, str],
    *,
    email: str,
    role: str = "listener",
    password: str = "password123",
) -> None:
    response = client.post(
        "/api/admin/users",
        json={
            "email": email,
            "display_name": email,
            "password": password,
            "role": role,
        },
        headers=headers,
    )
    assert response.status_code == 201


def login_headers(
    client: TestClient,
    email: str,
    password: str = "password123",
) -> dict[str, str]:
    response = login(client, email=email, password=password)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def set_settings(
    client: TestClient,
    headers: dict[str, str],
    *,
    enabled: bool,
    max_minutes: int = 15,
    llm: bool = False,
):
    return client.put(
        "/api/admin/settings",
        json={
            "auto_rip_on_miss": enabled,
            "llm_auto_approve": llm,
            "max_track_minutes": max_minutes,
        },
        headers=headers,
    )


def test_settings_defaults_and_admin_update(client: TestClient):
    headers = admin_headers(client)

    defaults = client.get("/api/admin/settings")
    assert defaults.status_code == 200
    assert defaults.json()["auto_rip_on_miss"] is False
    assert defaults.json()["llm_auto_approve"] is False
    assert defaults.json()["max_track_minutes"] == 15

    updated = set_settings(client, headers, enabled=True, max_minutes=30)
    assert updated.status_code == 200
    assert updated.json()["auto_rip_on_miss"] is True
    assert updated.json()["max_track_minutes"] == 30

    reread = client.get("/api/admin/settings")
    assert reread.status_code == 200
    assert reread.json()["max_track_minutes"] == 30


def test_llm_auto_approve_can_be_enabled(client: TestClient):
    headers = admin_headers(client)

    updated = set_settings(
        client,
        headers,
        enabled=True,
        llm=True,
        max_minutes=20,
    )

    assert updated.status_code == 200
    assert updated.json()["llm_auto_approve"] is True
    assert client.get("/api/admin/settings").json()["llm_auto_approve"] is True


def test_invalid_max_track_minutes_is_rejected(client: TestClient):
    headers = admin_headers(client)

    zero = set_settings(client, headers, enabled=True, max_minutes=0)
    negative = set_settings(client, headers, enabled=True, max_minutes=-5)
    text = client.put(
        "/api/admin/settings",
        json={"auto_rip_on_miss": True, "max_track_minutes": "many"},
        headers=headers,
    )

    assert zero.status_code == 422
    assert negative.status_code == 422
    assert text.status_code == 422


def test_non_admin_cannot_manage_settings(client: TestClient):
    headers = admin_headers(client)
    create_user(client, headers, email="editor@example.com", role="editor")
    create_user(client, headers, email="listener@example.com", role="listener")

    editor_client = TestClient(client.app)
    editor_headers = login_headers(editor_client, "editor@example.com")
    assert editor_client.get("/api/admin/settings").status_code == 403
    assert set_settings(
        editor_client, editor_headers, enabled=True
    ).status_code == 403

    listener_client = TestClient(client.app)
    listener_headers = login_headers(listener_client, "listener@example.com")
    assert listener_client.get("/api/admin/settings").status_code == 403
    assert set_settings(
        listener_client, listener_headers, enabled=True
    ).status_code == 403

    editor_client.close()
    listener_client.close()


def test_import_config_is_readable_by_authenticated_users(client: TestClient):
    headers = admin_headers(client)
    assert set_settings(client, headers, enabled=True, max_minutes=12).status_code == 200
    create_user(client, headers, email="listener@example.com")

    listener_client = TestClient(client.app)
    login(listener_client, email="listener@example.com", password="password123")
    config = listener_client.get("/api/import-jobs/config")

    assert config.status_code == 200
    assert config.json() == {
        "auto_rip_on_miss": True,
        "max_track_minutes": 12,
    }
    listener_client.close()


def test_import_job_requires_enabled_setting(client: TestClient):
    headers = admin_headers(client)
    create_user(client, headers, email="listener@example.com")

    listener_client = TestClient(client.app)
    listener_headers = login_headers(listener_client, "listener@example.com")

    disabled = listener_client.post(
        "/api/import-jobs",
        json={"query": "Missing Song"},
        headers=listener_headers,
    )
    assert disabled.status_code == 403

    assert set_settings(client, headers, enabled=True).status_code == 200
    created = listener_client.post(
        "/api/import-jobs",
        json={"query": "Missing Song"},
        headers=listener_headers,
    )
    assert created.status_code == 200
    assert created.json()["status"] == "queued"
    listener_client.close()


def test_import_jobs_are_deduplicated(
    client: TestClient, db_session
):
    headers = admin_headers(client)
    create_user(client, headers, email="one@example.com")
    create_user(client, headers, email="two@example.com")
    assert set_settings(client, headers, enabled=True).status_code == 200

    one = TestClient(client.app)
    one_headers = login_headers(one, "one@example.com")
    first = one.post(
        "/api/import-jobs",
        json={"query": "Missing Song"},
        headers=one_headers,
    )
    assert first.status_code == 200
    job_id = first.json()["id"]

    duplicate = one.post(
        "/api/import-jobs",
        json={"query": "  missing   song "},
        headers=one_headers,
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == job_id

    owner_view = one.get(f"/api/import-jobs/{job_id}")
    assert owner_view.status_code == 200

    two = TestClient(client.app)
    login(two, email="two@example.com", password="password123")
    assert two.get(f"/api/import-jobs/{job_id}").status_code == 200

    job = db_session.get(RipJob, UUID(job_id))
    assert job is not None
    assert job.normalized_query == "missing song"
    one.close()
    two.close()


def test_short_import_query_is_rejected(client: TestClient):
    headers = admin_headers(client)
    assert set_settings(client, headers, enabled=True).status_code == 200

    response = client.post(
        "/api/import-jobs",
        json={"query": "ab"},
        headers=headers,
    )
    assert response.status_code == 422


def test_editor_can_list_and_update_review_jobs(
    client: TestClient, db_session
):
    headers = admin_headers(client)
    create_user(client, headers, email="editor@example.com", role="editor")
    create_user(client, headers, email="listener@example.com", role="listener")
    admin = db_session.scalar(select(User).where(User.email == "admin@example.com"))
    job = RipJob(
        requested_by_user_id=admin.id,
        query_text="Ambiguous Song",
        normalized_query="ambiguous song",
        status=RipJobStatus.needs_review,
        candidate_url="https://example.com/watch",
        candidate_title="Wrong Title",
        candidate_artist="Wrong Artist",
        candidate_duration_seconds=180,
        error_message="Ambiguous match; editor review required.",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)

    editor = TestClient(client.app)
    editor_headers = login_headers(editor, "editor@example.com")
    listing = editor.get("/api/editor/import-jobs?status=needs_review")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [str(job.id)]

    updated = editor.patch(
        f"/api/editor/import-jobs/{job.id}",
        json={
            "candidate_title": "Right Title",
            "candidate_artist": "Right Artist",
        },
        headers=editor_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["candidate_title"] == "Right Title"
    assert updated.json()["candidate_artist"] == "Right Artist"

    approved = editor.post(
        f"/api/editor/import-jobs/{job.id}/approve",
        headers=editor_headers,
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "queued"

    listener = TestClient(client.app)
    login(listener, email="listener@example.com", password="password123")
    assert listener.get("/api/editor/import-jobs").status_code == 403
    editor.close()
    listener.close()


def test_reject_review_job_cancels_it(client: TestClient, db_session):
    headers = admin_headers(client)
    create_user(client, headers, email="editor@example.com", role="editor")
    admin = db_session.scalar(select(User).where(User.email == "admin@example.com"))
    job = RipJob(
        requested_by_user_id=admin.id,
        query_text="Rejected Song",
        normalized_query="rejected song",
        status=RipJobStatus.needs_review,
        candidate_url="https://example.com/watch",
        candidate_title="Rejected Song",
        candidate_artist="Artist",
        candidate_duration_seconds=120,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)

    editor = TestClient(client.app)
    editor_headers = login_headers(editor, "editor@example.com")
    rejected = editor.post(
        f"/api/editor/import-jobs/{job.id}/reject",
        headers=editor_headers,
    )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "cancelled"
    assert rejected.json()["error_message"] == "Rejected by editor."
    editor.close()
