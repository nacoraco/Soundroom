from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings

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
):
    return client.post(
        "/api/tracks",
        files={"file": (filename, content, "audio/mpeg")},
        headers=headers,
    )


def create_track(
    client: TestClient,
    headers: dict[str, str],
    upload_settings,
    filename: str,
    *,
    title: str,
    artist: str,
    album: str = "Test Album",
) -> dict:
    content = make_mp3(
        Path(upload_settings.media_storage_path) / filename,
        title=title,
        artist=artist,
        album=album,
    )
    response = upload(client, headers, content, filename=filename)
    assert response.status_code == 201
    return response.json()


def test_search_requires_authentication(client: TestClient):
    assert client.get("/api/tracks", params={"q": "abc"}).status_code == 401


def test_search_matches_title_and_artist_ignoring_case_and_diacritics(
    client: TestClient, upload_settings
):
    headers = admin_headers(client)
    crna = create_track(
        client,
        headers,
        upload_settings,
        "crna.mp3",
        title="Črna ovca",
        artist="Šank Rock",
        album="Noč",
    )
    midnight = create_track(
        client,
        headers,
        upload_settings,
        "midnight.mp3",
        title="Midnight Signal",
        artist="The Test Tones",
        album="Archive Sessions",
    )

    by_title = client.get("/api/tracks", params={"q": "CRNA"})
    assert by_title.status_code == 200
    data = by_title.json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == crna["id"]

    by_artist = client.get("/api/tracks", params={"q": "sank"})
    assert by_artist.status_code == 200
    assert by_artist.json()["items"][0]["id"] == crna["id"]

    partial = client.get("/api/tracks", params={"q": "mid"})
    assert partial.status_code == 200
    assert partial.json()["total"] == 1
    assert partial.json()["items"][0]["id"] == midnight["id"]

    item = partial.json()["items"][0]
    assert item["artist_name"] == "The Test Tones"
    assert item["album_title"] == "Archive Sessions"
    assert item["duration_seconds"] == 1
    assert item["mime_type"] == "audio/mpeg"
    assert item["is_available"] is True


def test_short_and_empty_search_results_are_not_errors(
    client: TestClient, upload_settings
):
    headers = admin_headers(client)
    create_track(
        client,
        headers,
        upload_settings,
        "one.mp3",
        title="One Track",
        artist="One Artist",
    )

    short = client.get("/api/tracks", params={"q": "on"})
    assert short.status_code == 200
    assert short.json() == {
        "items": [],
        "page": 1,
        "page_size": 20,
        "total": 0,
        "total_pages": 0,
    }

    no_results = client.get("/api/tracks", params={"q": "zzz"})
    assert no_results.status_code == 200
    assert no_results.json()["items"] == []
    assert no_results.json()["total"] == 0

    browse = client.get("/api/tracks")
    assert browse.status_code == 200
    assert browse.json()["total"] == 1
    assert len(browse.json()["items"]) == 1


def test_search_pagination_and_browse_pagination(
    client: TestClient, upload_settings
):
    headers = admin_headers(client)
    for index in range(25):
        create_track(
            client,
            headers,
            upload_settings,
            f"pagination-{index:02d}.mp3",
            title=f"Track {index:02d}",
            artist="Pagination Artist",
            album="Pagination Album",
        )

    first_page = client.get(
        "/api/tracks", params={"q": "pagination", "page": 1}
    )
    assert first_page.status_code == 200
    first = first_page.json()
    assert first["page"] == 1
    assert first["page_size"] == 20
    assert first["total"] == 25
    assert first["total_pages"] == 2
    assert len(first["items"]) == 20
    assert first["items"][0]["title"] == "Track 00"
    assert first["items"][-1]["title"] == "Track 19"

    second_page = client.get(
        "/api/tracks", params={"q": "pagination", "page": 2}
    )
    assert second_page.status_code == 200
    second = second_page.json()
    assert second["page"] == 2
    assert len(second["items"]) == 5
    assert [item["title"] for item in second["items"]] == [
        "Track 20",
        "Track 21",
        "Track 22",
        "Track 23",
        "Track 24",
    ]

    beyond = client.get("/api/tracks", params={"q": "pagination", "page": 3})
    assert beyond.status_code == 200
    assert beyond.json()["items"] == []
    assert beyond.json()["total"] == 25
    assert beyond.json()["total_pages"] == 2

    browse = client.get("/api/tracks", params={"page": 2})
    assert browse.status_code == 200
    assert browse.json()["page"] == 2
    assert browse.json()["total"] == 25
    assert len(browse.json()["items"]) == 5
