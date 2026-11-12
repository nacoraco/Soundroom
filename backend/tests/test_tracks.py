from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.models import Album, Artist, Track

from .utils import auth_headers, login, make_mp3


@pytest.fixture
def upload_settings(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    return settings


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def upload(
    client: TestClient,
    headers: dict[str, str],
    content: bytes,
    *,
    filename: str = "track.mp3",
    content_type: str = "audio/mpeg",
    data: dict[str, str] | None = None,
):
    return client.post(
        "/api/tracks",
        files={"file": (filename, content, content_type)},
        data=data or {},
        headers=headers,
    )


def test_track_list_requires_authentication(client: TestClient):
    assert client.get("/api/tracks").status_code == 401


def test_upload_mp3_with_tags_creates_track(
    client: TestClient, upload_settings, db_session
):
    headers = admin_headers(client)
    content = make_mp3(Path(upload_settings.media_storage_path) / "source.mp3")

    response = upload(client, headers, content)

    assert response.status_code == 201
    track = response.json()
    assert track["title"] == "Test Title"
    assert track["artist_name"] == "Test Artist"
    assert track["album_title"] == "Test Album"
    assert track["release_year"] == 2026
    assert track["duration_seconds"] == 1
    assert track["source_type"] == "upload"

    listing = client.get("/api/tracks")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()["items"]] == [track["id"]]

    stored = db_session.scalar(select(Track))
    assert stored is not None
    assert stored.audio_sha256
    assert len(stored.audio_sha256) == 64
    assert (Path(upload_settings.media_storage_path) / stored.file_path).is_file()
    assert stored.artist.normalized_name == "test artist"
    assert stored.album is not None
    assert stored.album.title == "Test Album"


def test_missing_metadata_requires_manual_title_and_artist(
    client: TestClient, upload_settings
):
    headers = admin_headers(client)
    content = make_mp3(
        Path(upload_settings.media_storage_path) / "untagged.mp3",
        with_tags=False,
    )

    response = upload(client, headers, content)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "missing_metadata"
    assert set(detail["missing"]) == {"title", "artist"}

    retry = upload(
        client,
        headers,
        content,
        data={
            "title": "Manual Title",
            "artist": "Manual Artist",
            "album": "Manual Album",
        },
    )

    assert retry.status_code == 201
    assert retry.json()["title"] == "Manual Title"
    assert retry.json()["artist_name"] == "Manual Artist"
    assert retry.json()["album_title"] == "Manual Album"


def test_wrong_extension_is_rejected(client: TestClient, upload_settings):
    headers = admin_headers(client)
    content = make_mp3(Path(upload_settings.media_storage_path) / "source.mp3")

    response = upload(client, headers, content, filename="track.wav")

    assert response.status_code == 415
    assert "Only MP3" in response.json()["detail"]


def test_invalid_mp3_content_is_rejected(client: TestClient):
    headers = admin_headers(client)

    response = upload(client, headers, b"this is not an mp3")

    assert response.status_code == 422
    assert "valid MP3" in response.json()["detail"]


def test_oversized_file_is_rejected(
    client: TestClient, upload_settings, monkeypatch
):
    headers = admin_headers(client)
    monkeypatch.setattr(upload_settings, "max_upload_mb", 0)
    content = make_mp3(Path(upload_settings.media_storage_path) / "source.mp3")

    response = upload(client, headers, content)

    assert response.status_code == 413
    assert "Maximum allowed size" in response.json()["detail"]


def test_duplicate_audio_is_rejected(client: TestClient, upload_settings):
    headers = admin_headers(client)
    content = make_mp3(Path(upload_settings.media_storage_path) / "source.mp3")

    assert upload(client, headers, content).status_code == 201
    duplicate = upload(client, headers, content, filename="copy.mp3")

    assert duplicate.status_code == 409
    assert "already in the library" in duplicate.json()["detail"]


def test_upload_requires_csrf(client: TestClient):
    login(client)

    response = client.post(
        "/api/tracks",
        files={"file": ("track.mp3", b"not an mp3", "audio/mpeg")},
    )

    assert response.status_code == 403


def test_listener_cannot_upload(client: TestClient):
    headers = admin_headers(client)
    created = client.post(
        "/api/admin/users",
        json={
            "email": "listener@example.com",
            "display_name": "Listener",
            "password": "password123",
            "role": "listener",
        },
        headers=headers,
    )
    assert created.status_code == 201

    listener_client = TestClient(client.app)
    listener_login = login(listener_client, email="listener@example.com", password="password123")
    assert listener_login.status_code == 200
    listener_headers = auth_headers(listener_login.json()["csrf_token"])

    response = upload(listener_client, listener_headers, b"not an mp3")

    assert response.status_code == 403
    listener_client.close()


def test_artist_and_album_are_reused(client: TestClient, upload_settings, db_session):
    headers = admin_headers(client)
    first = make_mp3(Path(upload_settings.media_storage_path) / "first.mp3")
    second = first + b"\x00"

    assert upload(client, headers, first).status_code == 201
    second_response = upload(
        client,
        headers,
        second,
        data={
            "title": "Second Track",
            "artist": "test artist",
            "album": "Test Album",
        },
    )

    assert second_response.status_code == 201
    artists = db_session.scalars(select(Artist)).all()
    albums = db_session.scalars(select(Album)).all()
    tracks = db_session.scalars(select(Track)).all()
    assert len(artists) == 1
    assert len(albums) == 1
    assert len(tracks) == 2

def test_track_list_sorts_by_user_play_count(
    client: TestClient, upload_settings, db_session
):
    headers = admin_headers(client)
    track_ids = []
    for index in range(3):
        path = (
            Path(upload_settings.media_storage_path)
            / f"source-{index}.mp3"
        )
        content = make_mp3(
            path,
            title=f"Song {index}",
            artist="Play Count Artist",
        )
        response = upload(
            client,
            headers,
            content,
            filename=f"track-{index}.mp3",
        )
        assert response.status_code == 201
        track_ids.append(response.json()["id"])

    for _ in range(2):
        response = client.post(
            "/api/radio/listen",
            json={
                "track_id": track_ids[0],
                "played_seconds": 1,
                "duration_seconds": 1,
                "skipped": False,
                "source": "manual",
            },
            headers=headers,
        )
        assert response.status_code == 200
    response = client.post(
        "/api/radio/listen",
        json={
            "track_id": track_ids[1],
            "played_seconds": 1,
            "duration_seconds": 1,
            "skipped": False,
            "source": "manual",
        },
        headers=headers,
    )
    assert response.status_code == 200

    listing = client.get("/api/tracks", params={"sort": "most_played"})
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert [item["id"] for item in items] == track_ids
    assert items[0]["play_count"] == 2
    assert items[1]["play_count"] == 1
    assert items[2]["play_count"] == 0
    assert items[0]["last_played_at"] is not None
