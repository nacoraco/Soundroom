from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import importer
from app.config import get_settings
from app.importer import Candidate, is_live_performance, process_next_job
from app.llm_review import LlmDecision
from app.models import AppSettings, RipJob, RipJobStatus, Track, User


def admin_id(db_session) -> str:
    user = db_session.scalar(
        select(User).where(User.email == "admin@example.com")
    )
    assert user is not None
    return user.id


def configure_settings(db_session, *, enabled=True, max_minutes=5, llm=False):
    settings = AppSettings(
        id=1,
        auto_rip_on_miss=enabled,
        llm_auto_approve=llm,
        max_track_minutes=max_minutes,
    )
    db_session.add(settings)
    db_session.commit()
    db_session.refresh(settings)
    return settings


def make_job(db_session, *, status=RipJobStatus.queued, **values):
    job = RipJob(
        requested_by_user_id=admin_id(db_session),
        query_text=values.pop("query_text", "Test Song"),
        normalized_query=values.pop("normalized_query", "test song"),
        status=status,
        **values,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


@pytest.fixture
def media_settings(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    return settings


def fake_download(candidate, workdir):
    source = Path(workdir) / "source.webm"
    source.write_bytes(b"fake source audio")
    return source


def fake_convert(source, destination):
    destination.write_bytes(b"fake mp3 audio")
    return destination


def test_worker_completes_import_and_creates_track(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session)
    job = make_job(db_session)

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate(
                url="https://example.com/video",
                title="Test Song",
                artist="Test Artist",
                duration_seconds=120,
            )
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 120)

    result = process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert result is not None
    assert job.status is RipJobStatus.completed
    assert job.track_id is not None
    assert job.candidate_title == "Test Song"
    assert job.candidate_artist == "Test Artist"
    assert job.error_message is None

    track = db_session.get(Track, job.track_id)
    assert track is not None
    assert track.title == "Test Song"
    assert track.duration_seconds == 120
    assert track.source_type.value == "youtube"
    assert track.source_url == "https://example.com/video"
    assert (Path(media_settings.media_storage_path) / track.file_path).is_file()


def test_worker_marks_ambiguous_candidate_for_review(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session)
    job = make_job(db_session)
    download_called = False

    def download_should_not_run(candidate, workdir):
        nonlocal download_called
        download_called = True
        raise AssertionError("ambiguous candidate must not download")

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/a", "Test Song", "Artist A", 120),
            Candidate("https://example.com/b", "Test Song", "Artist B", 130),
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", download_should_not_run)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.needs_review
    assert job.candidate_title == "Test Song"
    assert job.candidate_url
    assert "review" in job.error_message.lower()
    assert download_called is False
    assert db_session.scalar(select(Track)) is None


def test_worker_rejects_candidates_over_duration_limit(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session, max_minutes=1)
    job = make_job(db_session)
    download_called = False

    def download_should_not_run(candidate, workdir):
        nonlocal download_called
        download_called = True
        raise AssertionError("overlong candidate must not download")

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/long", "Test Song", "Artist", 120)
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", download_should_not_run)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.failed
    assert "duration" in job.error_message.lower()
    assert download_called is False
    assert db_session.scalar(select(Track)) is None


def test_worker_failure_leaves_no_track_or_file(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session)
    job = make_job(db_session)

    def failing_download(candidate, workdir):
        raise RuntimeError("download failed")

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/fail", "Test Song", "Artist", 120)
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", failing_download)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.failed
    assert "download failed" in job.error_message
    assert db_session.scalar(select(Track)) is None
    assert list(
        (Path(media_settings.media_storage_path) / "tracks").glob("*")
    ) == []


def test_approved_job_skips_search_and_downloads(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session)
    job = make_job(
        db_session,
        status=RipJobStatus.queued,
        candidate_url="https://example.com/approved",
        candidate_title="Approved Song",
        candidate_artist="Approved Artist",
        candidate_duration_seconds=100,
    )
    search_called = False

    def search_should_not_run(query):
        nonlocal search_called
        search_called = True
        return []

    monkeypatch.setattr(importer, "search_candidates", search_should_not_run)
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 100)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    assert search_called is False
    track = db_session.get(Track, job.track_id)
    assert track is not None
    assert track.title == "Approved Song"

def test_worker_auto_approves_clear_winner(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session)
    job = make_job(db_session)

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate(
                "https://example.com/studio",
                "Test Song",
                "Test Artist",
                120,
                "Test Artist - Topic",
                250_000,
            ),
            Candidate(
                "https://example.com/cover",
                "Test Song (Cover)",
                "Cover Band",
                125,
                "Cover Band",
                1_000,
            ),
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 120)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    assert job.candidate_url == "https://example.com/studio"
    assert job.candidate_artist == "Test Artist"


def test_worker_uses_llm_for_ambiguous_candidate(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session, llm=True)
    job = make_job(db_session)

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/a", "Test Song", "Artist A", 120),
            Candidate("https://example.com/b", "Test Song", "Artist B", 130),
        ],
    )
    monkeypatch.setattr(
        importer,
        "review_candidates_with_llm",
        lambda query, candidates, config: LlmDecision(1, 0.94, "best match"),
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 130)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    assert job.candidate_url == "https://example.com/b"
    assert job.candidate_artist == "Artist B"


def test_worker_keeps_live_versions_from_llm_when_studio_exists(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session, llm=True)
    job = make_job(db_session)
    reviewed = []

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/a", "Test Song", "Artist A", 120),
            Candidate("https://example.com/b", "Test Song", "Artist B", 120),
            Candidate(
                "https://example.com/live",
                "Test Song (Live at Wembley)",
                "Artist C",
                120,
                "Artist C",
                9_000_000,
            ),
        ],
    )

    def fake_llm(query, candidates, config):
        reviewed.extend(candidates)
        return LlmDecision(1, 0.94, "best studio match")

    monkeypatch.setattr(importer, "review_candidates_with_llm", fake_llm)
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 120)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert reviewed
    assert all(not is_live_performance(item) for item in reviewed)
    assert job.status is RipJobStatus.completed
    assert job.candidate_url == "https://example.com/b"


def test_worker_llm_failure_falls_back_to_review(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session, llm=True)
    job = make_job(db_session)
    download_called = False

    def download_should_not_run(candidate, workdir):
        nonlocal download_called
        download_called = True
        raise AssertionError("low-confidence candidate must not download")

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/a", "Test Song", "Artist A", 120),
            Candidate("https://example.com/b", "Test Song", "Artist B", 130),
        ],
    )
    monkeypatch.setattr(
        importer,
        "review_candidates_with_llm",
        lambda query, candidates, config: None,
    )
    monkeypatch.setattr(importer, "download_candidate", download_should_not_run)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.needs_review
    assert job.error_message
    assert download_called is False

def test_worker_force_llm_approval_overrides_disabled_setting(
    db_session, media_settings, monkeypatch
):
    configure_settings(db_session, llm=False)
    job = make_job(db_session, force_llm_approval=True)

    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            Candidate("https://example.com/a", "Test Song", "Artist A", 120),
            Candidate("https://example.com/b", "Test Song", "Artist B", 130),
        ],
    )
    monkeypatch.setattr(
        importer,
        "review_candidates_with_llm",
        lambda query, candidates, config: LlmDecision(1, 0.91, "best match"),
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 130)

    process_next_job(db_session, media_settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    assert job.candidate_url == "https://example.com/b"
    assert job.candidate_artist == "Artist B"
