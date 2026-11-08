from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import importer
from app.config import get_settings
from app.importer import Candidate, process_next_job
from app.models import RipJob, Track
from app.routers import import_jobs

from .utils import auth_headers, login


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def enable_import(client: TestClient, headers: dict[str, str], max_minutes: int = 5):
    response = client.put(
        "/api/admin/settings",
        json={
            "auto_rip_on_miss": True,
            "llm_auto_approve": True,
            "max_track_minutes": max_minutes,
        },
        headers=headers,
    )
    assert response.status_code == 200


def sample_candidate(
    video_id: str,
    title: str,
    *,
    duration: int | None = 120,
    artist: str = "Test Artist",
    uploader: str = "Test Artist - Topic",
    views: int = 100_000,
) -> Candidate:
    return Candidate(
        url=f"https://www.youtube.com/watch?v={video_id}",
        title=title,
        artist=artist,
        duration_seconds=duration,
        uploader=uploader,
        view_count=views,
        video_id=video_id,
        thumbnail_url=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    )


def test_preview_requires_authentication(client: TestClient):
    response = client.get("/api/import-jobs/preview?q=test")

    assert response.status_code == 401


def test_preview_requires_enabled_import(client: TestClient):
    headers = admin_headers(client)

    response = client.get("/api/import-jobs/preview?q=test", headers=headers)

    assert response.status_code == 403


def test_preview_lists_ranked_releases_without_creating_a_job(
    client: TestClient, db_session, monkeypatch
):
    headers = admin_headers(client)
    enable_import(client, headers, max_minutes=5)
    seen: dict[str, object] = {}

    def fake_search(query: str, limit: int = 5):
        seen["query"] = query
        seen["limit"] = limit
        return [
            sample_candidate("abcdefghijk", "Test Song", duration=120),
            sample_candidate(
                "lmnopqrstuv",
                "Test Song (Live)",
                duration=900,
                artist="Other Artist",
                uploader="Other Artist",
            ),
            sample_candidate(
                "zyxwvutsrqp",
                "Test Song (Live Stream)",
                duration=None,
                artist="Stream Artist",
                uploader="Stream Artist",
            ),
        ]

    monkeypatch.setattr(import_jobs, "search_candidates", fake_search)

    response = client.get(
        "/api/import-jobs/preview?q=Test%20Song",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert seen == {"query": "Test Song", "limit": 8}
    assert payload["max_track_minutes"] == 5
    assert [item["video_id"] for item in payload["candidates"]] == [
        "abcdefghijk",
        "lmnopqrstuv",
        "zyxwvutsrqp",
    ]
    assert payload["candidates"][0]["thumbnail_url"].startswith(
        "https://i.ytimg.com/"
    )
    assert payload["candidates"][0]["within_duration_limit"] is True
    assert payload["candidates"][1]["within_duration_limit"] is False
    assert payload["candidates"][2]["within_duration_limit"] is False
    assert db_session.scalar(select(func.count(RipJob.id))) == 0


def test_preview_reports_external_search_failure(
    client: TestClient, monkeypatch
):
    headers = admin_headers(client)
    enable_import(client, headers)

    def failing_search(query: str, limit: int = 5):
        raise RuntimeError("yt-dlp unavailable")

    monkeypatch.setattr(import_jobs, "search_candidates", failing_search)

    response = client.get("/api/import-jobs/preview?q=test", headers=headers)

    assert response.status_code == 502


def test_selected_import_requires_valid_video_id(client: TestClient):
    headers = admin_headers(client)
    enable_import(client, headers)

    response = client.post(
        "/api/import-jobs",
        json={
            "query": "Test Song",
            "candidate": {
                "video_id": "too-short",
                "title": "Test Song",
                "artist": "Test Artist",
                "duration_seconds": 120,
            },
        },
        headers=headers,
    )

    assert response.status_code == 422


def test_selected_import_rejects_overlong_release(client: TestClient):
    headers = admin_headers(client)
    enable_import(client, headers, max_minutes=1)

    response = client.post(
        "/api/import-jobs",
        json={
            "query": "Test Song",
            "candidate": {
                "video_id": "abcdefghijk",
                "title": "Test Song",
                "artist": "Test Artist",
                "duration_seconds": 120,
            },
        },
        headers=headers,
    )

    assert response.status_code == 422


def test_selected_import_skips_search_and_llm(
    client: TestClient, db_session, tmp_path, monkeypatch
):
    headers = admin_headers(client)
    enable_import(client, headers)
    response = client.post(
        "/api/import-jobs",
        json={
            "query": "Test Song",
            "candidate": {
                "video_id": "abcdefghijk",
                "title": "Test Song",
                "artist": "Test Artist",
                "duration_seconds": 120,
            },
        },
        headers=headers,
    )
    assert response.status_code == 200
    job = db_session.scalar(
        select(RipJob).where(RipJob.normalized_query == "test song")
    )
    assert job is not None
    assert job.candidate_url == "https://www.youtube.com/watch?v=abcdefghijk"
    assert job.status.value == "queued"

    media_settings = get_settings()
    monkeypatch.setattr(media_settings, "media_storage_path", str(tmp_path))
    search_called = False

    def search_should_not_run(query: str, limit: int = 5):
        nonlocal search_called
        search_called = True
        raise AssertionError("selected imports must not search again")

    def fake_download(candidate: Candidate, workdir: Path):
        source = Path(workdir) / "source.webm"
        source.write_bytes(b"fake source audio")
        return source

    def fake_convert(source: Path, destination: Path):
        destination.write_bytes(b"fake mp3 audio")
        return destination

    def llm_should_not_run(query: str, candidates, config):
        raise AssertionError("selected imports must not use the LLM")

    monkeypatch.setattr(importer, "search_candidates", search_should_not_run)
    monkeypatch.setattr(importer, "review_candidates_with_llm", llm_should_not_run)
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 120)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status.value == "completed"
    assert search_called is False
    track = db_session.get(Track, job.track_id)
    assert track is not None
    assert track.title == "Test Song"
    assert track.source_url == "https://www.youtube.com/watch?v=abcdefghijk"
    assert (tmp_path / track.file_path).is_file()
