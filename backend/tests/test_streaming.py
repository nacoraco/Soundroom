from pathlib import Path
from uuid import UUID, uuid4

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


@pytest.fixture
def uploaded_track(client: TestClient, media_settings, db_session):
    response = login(client)
    assert response.status_code == 200
    headers = auth_headers(response.json()["csrf_token"])
    content = make_mp3(Path(media_settings.media_storage_path) / "source.mp3")

    uploaded = client.post(
        "/api/tracks",
        files={"file": ("track.mp3", content, "audio/mpeg")},
        headers=headers,
    )
    assert uploaded.status_code == 201
    track = db_session.scalar(
        select(Track).where(Track.id == UUID(uploaded.json()["id"]))
    )
    assert track is not None
    return track, content


def stream(client: TestClient, track_id, range_header: str | None = None):
    headers = {"Range": range_header} if range_header is not None else None
    return client.get(f"/api/tracks/{track_id}/stream", headers=headers)


def test_stream_requires_authentication(client: TestClient):
    response = client.get(f"/api/tracks/{uuid4()}/stream")

    assert response.status_code == 401


def test_stream_missing_track_returns_404(client: TestClient):
    login(client)

    response = stream(client, uuid4())

    assert response.status_code == 404


def test_full_stream_returns_file(client: TestClient, uploaded_track):
    track, content = uploaded_track

    response = stream(client, track.id)

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == str(len(content))
    assert "content-range" not in response.headers


def test_partial_stream_returns_206(client: TestClient, uploaded_track):
    track, content = uploaded_track
    size = len(content)

    response = stream(client, track.id, "bytes=10-29")

    assert response.status_code == 206
    assert response.content == content[10:30]
    assert response.headers["content-range"] == f"bytes 10-29/{size}"
    assert response.headers["content-length"] == "20"
    assert response.headers["accept-ranges"] == "bytes"


def test_open_ended_and_suffix_ranges(client: TestClient, uploaded_track):
    track, content = uploaded_track
    size = len(content)

    open_ended = stream(client, track.id, "bytes=12-")
    assert open_ended.status_code == 206
    assert open_ended.content == content[12:]

    suffix = stream(client, track.id, "bytes=-16")
    assert suffix.status_code == 206
    assert suffix.content == content[-16:]
    assert suffix.headers["content-range"] == f"bytes {size - 16}-{size - 1}/{size}"


@pytest.mark.parametrize(
    "range_header",
    [
        "bytes=999999-",
        "bytes=20-10",
        "bytes=abc-def",
        "bytes=0-1,4-5",
        "items=0-1",
    ],
)
def test_invalid_ranges_return_416(
    client: TestClient, uploaded_track, range_header: str
):
    track, content = uploaded_track

    response = stream(client, track.id, range_header)

    assert response.status_code == 416
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-range"] == f"bytes */{len(content)}"


def test_missing_file_returns_404(client: TestClient, uploaded_track, media_settings):
    track, _ = uploaded_track
    (Path(media_settings.media_storage_path) / track.file_path).unlink()

    response = stream(client, track.id)

    assert response.status_code == 404


def test_unavailable_track_returns_404(
    client: TestClient, uploaded_track, db_session
):
    track, _ = uploaded_track
    track.is_available = False
    db_session.commit()

    response = stream(client, track.id)

    assert response.status_code == 404


def test_get_track_returns_metadata(client: TestClient, uploaded_track):
    track, _ = uploaded_track

    response = client.get(f"/api/tracks/{track.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(track.id)
    assert response.json()["title"] == track.title


def test_get_track_requires_authentication(client: TestClient):
    response = client.get(f"/api/tracks/{uuid4()}")

    assert response.status_code == 401


def test_get_missing_track_returns_404(client: TestClient):
    login(client)

    response = client.get(f"/api/tracks/{uuid4()}")

    assert response.status_code == 404
