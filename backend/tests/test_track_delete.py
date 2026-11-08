from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.models import Track

from .utils import auth_headers, login, make_mp3


@pytest.fixture
def media_settings(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    return settings


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def upload_track(
    client: TestClient,
    media_settings,
    headers: dict[str, str],
) -> UUID:
    content = make_mp3(Path(media_settings.media_storage_path) / "source.mp3")
    response = client.post(
        "/api/tracks",
        files={"file": ("track.mp3", content, "audio/mpeg")},
        headers=headers,
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


def get_track(db_session, track_id: UUID) -> Track:
    track = db_session.scalar(select(Track).where(Track.id == track_id))
    assert track is not None
    return track


def test_admin_can_delete_track_and_file(
    client: TestClient, db_session, media_settings
):
    headers = admin_headers(client)
    track_id = upload_track(client, media_settings, headers)
    track = get_track(db_session, track_id)
    file_path = Path(media_settings.media_storage_path) / track.file_path
    assert file_path.is_file()

    response = client.delete(f"/api/tracks/{track_id}", headers=headers)

    assert response.status_code == 204
    assert not file_path.exists()
    assert db_session.scalar(select(Track).where(Track.id == track_id)) is None
    assert client.get(f"/api/tracks/{track_id}/stream").status_code == 404


def test_non_admin_cannot_delete_track(
    client: TestClient, db_session, media_settings
):
    headers = admin_headers(client)
    created = client.post(
        "/api/admin/users",
        json={
            "email": "listener@example.com",
            "display_name": "Listener",
            "password": "listener-password",
            "role": "listener",
        },
        headers=headers,
    )
    assert created.status_code == 201

    track_id = upload_track(client, media_settings, headers)
    track = get_track(db_session, track_id)
    file_path = Path(media_settings.media_storage_path) / track.file_path

    listener_client = TestClient(client.app)
    response = login(
        listener_client,
        email="listener@example.com",
        password="listener-password",
    )
    assert response.status_code == 200
    listener_headers = auth_headers(response.json()["csrf_token"])

    denied = listener_client.delete(
        f"/api/tracks/{track_id}",
        headers=listener_headers,
    )

    assert denied.status_code == 403
    assert file_path.is_file()
    assert db_session.scalar(select(Track).where(Track.id == track_id)) is not None
    listener_client.close()


def test_delete_missing_track_returns_404(client: TestClient):
    headers = admin_headers(client)

    response = client.delete(
        "/api/tracks/00000000-0000-0000-0000-000000000000",
        headers=headers,
    )

    assert response.status_code == 404


def test_delete_does_not_remove_file_outside_media_root(
    client: TestClient, db_session, media_settings
):
    headers = admin_headers(client)
    track_id = upload_track(client, media_settings, headers)
    track = get_track(db_session, track_id)
    outside = Path(media_settings.media_storage_path).parent / "outside.mp3"
    outside.write_bytes(b"outside")
    track.file_path = "../outside.mp3"
    db_session.commit()

    response = client.delete(f"/api/tracks/{track_id}", headers=headers)

    assert response.status_code == 404
    assert outside.is_file()
    assert db_session.scalar(select(Track).where(Track.id == track_id)) is not None
    outside.unlink()
