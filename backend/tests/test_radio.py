from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import importer
from app.config import get_settings
from app.models import (
    Artist,
    DiscoveryLevel,
    Listen,
    RadioFeedbackVerdict,
    RipJob,
    RipJobStatus,
    Track,
    TrackSource,
    User,
)
from app.radio import (
    PROFILES,
    active_feedback,
    build_radio_batch,
    get_or_create_session,
    record_listen,
    select_batch,
    select_seeds,
    set_feedback,
)
from app.recommendations import SimilarArtist, SimilarTrack, TrackInfo, song_identity
from app.routers.radio import get_lastfm_client
from app.text import normalize_text

from .test_f4_worker import (
    configure_settings,
    fake_convert,
    fake_download,
    make_job,
)
from .utils import auth_headers, login


def admin(db_session) -> User:
    user = db_session.scalar(select(User).where(User.email == "admin@example.com"))
    assert user is not None
    return user


def make_track(
    db_session,
    title: str,
    artist_name: str = "Test Artist",
    *,
    duration_seconds: int = 180,
) -> Track:
    normalized_artist = normalize_text(artist_name)
    artist = db_session.scalar(
        select(Artist).where(Artist.normalized_name == normalized_artist)
    )
    if artist is None:
        artist = Artist(name=artist_name, normalized_name=normalized_artist)
        db_session.add(artist)
        db_session.flush()
    track = Track(
        artist_id=artist.id,
        album_id=None,
        title=title,
        normalized_title=normalize_text(title),
        canonical_artist=artist_name,
        canonical_title=title,
        recording_key=song_identity(artist_name, title),
        duration_seconds=duration_seconds,
        file_path=f"/tmp/{uuid4().hex}.mp3",
        mime_type="audio/mpeg",
        source_type=TrackSource.upload,
        audio_sha256=uuid4().hex,
        is_available=True,
    )
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


def add_listen(
    db_session,
    track: Track,
    completion: float,
    *,
    minutes_ago: int = 0,
    source: str = "manual",
) -> Listen:
    user = admin(db_session)
    duration = track.duration_seconds
    listen = Listen(
        user_id=user.id,
        track_id=track.id,
        recording_key=track.recording_key,
        title=track.canonical_title or track.title,
        artist=track.artist.name,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        ended_at=datetime.now(timezone.utc),
        played_seconds=int(duration * completion),
        duration_seconds=duration,
        completion_ratio=completion,
        skipped=completion < 0.9,
        source=source,
    )
    db_session.add(listen)
    db_session.commit()
    return listen


class FakeLastfm:
    def __init__(
        self,
        *,
        similar: dict[tuple[str, str], list[SimilarTrack]] | None = None,
        similar_artists: dict[str, list[SimilarArtist]] | None = None,
        artist_tracks: dict[str, list[SimilarTrack]] | None = None,
        tag_tracks: dict[str, list[SimilarTrack]] | None = None,
        tags: dict[str, tuple[str, ...]] | None = None,
    ):
        self.similar = similar or {}
        self.similar_artists = similar_artists or {}
        self.artist_tracks = artist_tracks or {}
        self.tag_tracks = tag_tracks or {}
        self.tags = tags or {}

    def get_similar(self, artist: str, title: str, limit: int = 20):
        return self.similar.get((artist, title), [])

    def get_similar_artists(self, artist: str, limit: int = 5):
        return self.similar_artists.get(artist, [])

    def get_artist_top_tracks(self, artist: str, limit: int = 10):
        return self.artist_tracks.get(artist, [])

    def get_tag_top_tracks(self, tag: str, limit: int = 20):
        return self.tag_tracks.get(tag, [])

    def get_info(self, artist: str, title: str):
        return TrackInfo(
            duration_seconds=180,
            listeners=None,
            playcount=None,
            tags=self.tags.get(artist, ()),
        )


def test_seed_selection_uses_only_qualified_tracks_and_anchor(db_session):
    user = admin(db_session)
    seed_tracks = [
        make_track(db_session, f"Qualified {index}", "Seed Artist")
        for index in range(12)
    ]
    low_tracks = [
        make_track(db_session, f"Low {index}", "Low Artist")
        for index in range(2)
    ]
    for index, track in enumerate(seed_tracks):
        add_listen(db_session, track, 0.95, minutes_ago=20 - index)
    for index, track in enumerate(low_tracks):
        add_listen(db_session, track, 0.2, minutes_ago=5 + index)

    session = get_or_create_session(db_session, user.id)
    session.seed_track_id = seed_tracks[-1].id
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    seeds = select_seeds(
        db_session,
        user.id,
        session,
        PROFILES[DiscoveryLevel.balanced],
        rng=random.Random(7),
    )

    assert len(seeds) == 10
    assert seeds[0].recording_key == seed_tracks[-1].recording_key
    seed_keys = {seed.recording_key for seed in seeds}
    assert all(track.recording_key in seed_keys for track in low_tracks) is False
    assert all(
        seed.recording_key in {track.recording_key for track in seed_tracks}
        for seed in seeds
    )
    assert db_session.scalar(select(Listen).where(Listen.user_id == user.id))


def test_seed_selection_does_not_fall_back_to_original_forever(db_session):
    user = admin(db_session)
    original = make_track(db_session, "Original Song", "Original Artist")
    partial = make_track(db_session, "Partial Song", "Partial Artist")
    add_listen(db_session, partial, 0.65, minutes_ago=1)
    session = get_or_create_session(db_session, user.id)
    session.seed_track_id = original.id
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    from app.radio import PROFILES

    seeds = select_seeds(
        db_session,
        user.id,
        session,
        PROFILES[DiscoveryLevel.balanced],
        rng=random.Random(1),
    )

    keys = {seed.recording_key for seed in seeds}
    assert original.recording_key in keys
    assert partial.recording_key in keys


def test_radio_batch_filters_rejections_recent_and_attaches_local(db_session):
    user = admin(db_session)
    seed = make_track(db_session, "Seed Song", "Seed Artist")
    recent = make_track(db_session, "Recent Song", "Recent Artist")
    rejected = make_track(db_session, "Rejected Song", "Rejected Artist")
    local = make_track(db_session, "Local Song", "Local Artist")
    add_listen(db_session, seed, 0.95, minutes_ago=60)
    add_listen(db_session, recent, 0.95, minutes_ago=1)
    set_feedback(
        db_session,
        user.id,
        recording_key=rejected.recording_key,
        artist="Rejected Artist",
        title="Rejected Song",
        verdict="reject",
        reason="skip",
    )

    client = FakeLastfm(
        similar={
            ("Seed Artist", "Seed Song"): [
                SimilarTrack("Recent Song", "Recent Artist", 0.95),
                SimilarTrack("Rejected Song", "Rejected Artist", 0.95),
                SimilarTrack("Local Song", "Local Artist", 0.9),
                SimilarTrack("Other Song", "Other Artist", 0.8),
            ]
        }
    )
    session = get_or_create_session(db_session, user.id)
    session.seed_track_id = seed.id
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    selected, seed_count = build_radio_batch(
        db_session,
        client,
        user.id,
        session,
        limit=10,
        rng=random.Random(3),
    )
    selected_keys = {candidate.recording_key for candidate in selected}

    assert seed_count >= 1
    assert recent.recording_key not in selected_keys
    assert rejected.recording_key not in selected_keys
    assert local.recording_key in selected_keys
    local_candidate = next(
        item for item in selected if item.recording_key == local.recording_key
    )
    assert local_candidate.local_track is not None
    assert local_candidate.local_track.id == local.id


def test_artist_cap_keeps_at_most_two_per_ten(db_session):
    from app.radio import PROFILES, RadioCandidate, rank_candidates

    candidates = {
        f"key-{index}": RadioCandidate(
            title=f"Song {index}",
            artist="Same Artist",
            recording_key=f"key-{index}",
            score=10 - index / 10,
            sources={"similar"},
            best_match=0.9,
        )
        for index in range(12)
    }
    profile = PROFILES[DiscoveryLevel.balanced]
    ranked = rank_candidates(candidates, profile, rng=random.Random(2))
    selected = select_batch(ranked, 10, profile)

    assert len(selected) == 2
    assert {candidate.artist for candidate in selected} == {"Same Artist"}


def test_feedback_blocks_artist_after_two_rejections(db_session):
    user = admin(db_session)
    for index in range(2):
        set_feedback(
            db_session,
            user.id,
            recording_key=f"reject-{index}",
            artist="Blocked Artist",
            title=f"Rejected {index}",
            verdict="reject",
            reason="skip",
        )
    rejected_keys, blocked_artists = active_feedback(db_session, user.id)
    assert len(rejected_keys) == 2
    assert normalize_text("Blocked Artist") in blocked_artists

    set_feedback(
        db_session,
        user.id,
        recording_key="reject-0",
        artist="Blocked Artist",
        title="Rejected 0",
        verdict="clear",
    )
    rejected_keys, _ = active_feedback(db_session, user.id)
    assert "reject-0" not in rejected_keys


def test_record_listen_clears_rejection_after_completion(db_session):
    user = admin(db_session)
    track = make_track(db_session, "Liked After All", "Artist")
    set_feedback(
        db_session,
        user.id,
        recording_key=track.recording_key,
        artist="Artist",
        title="Liked After All",
        verdict="reject",
        reason="skip",
    )

    listen = record_listen(
        db_session,
        user.id,
        track=track,
        played_seconds=track.duration_seconds,
        duration_seconds=track.duration_seconds,
        skipped=False,
        source="manual",
    )

    assert listen.completion_ratio == 1.0
    rejected_keys, _ = active_feedback(db_session, user.id)
    assert track.recording_key not in rejected_keys


def test_import_rejects_wrong_version_and_uses_canonical_metadata(
    db_session, tmp_path, monkeypatch
):
    configure_settings(db_session)
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    job = make_job(
        db_session,
        query_text="Kylie Minogue Aphrodite",
        normalized_query="kylie minogue aphrodite",
        source_artist="Kylie Minogue",
        source_title="Aphrodite",
        expected_duration_seconds=233,
    )
    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            importer.Candidate(
                url="https://example.com/live",
                title="Kylie Minogue - Aphrodite live - BLURAY",
                artist="Kylie Minogue",
                duration_seconds=446,
            )
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 446)

    from app.importer import process_next_job

    process_next_job(db_session, settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.failed
    assert "No suitable version" in (job.error_message or "")


def test_import_publishes_canonical_title_and_recording_key(
    db_session, tmp_path, monkeypatch
):
    configure_settings(db_session)
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    job = make_job(
        db_session,
        query_text="Kylie Minogue Aphrodite",
        normalized_query="kylie minogue aphrodite",
        source_artist="Kylie Minogue",
        source_title="Aphrodite",
        expected_duration_seconds=233,
    )
    monkeypatch.setattr(
        importer,
        "search_candidates",
        lambda query: [
            importer.Candidate(
                url="https://example.com/studio",
                title="Kylie Minogue - Aphrodite (Official Audio)",
                artist="Kylie Minogue",
                duration_seconds=233,
            )
        ],
    )
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 233)

    from app.importer import process_next_job

    process_next_job(db_session, settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    track = db_session.get(Track, job.track_id)
    assert track is not None
    assert track.title == "Aphrodite"
    assert track.artist.name == "Kylie Minogue"
    assert track.recording_key == song_identity("Kylie Minogue", "Aphrodite")


def make_authed_client(client: TestClient) -> tuple[TestClient, dict[str, str]]:
    response = login(client)
    assert response.status_code == 200
    return client, auth_headers(response.json()["csrf_token"])


def test_radio_endpoints_record_listen_and_feedback(client, db_session):
    authed, headers = make_authed_client(client)
    track = make_track(db_session, "Endpoint Song", "Endpoint Artist")

    response = authed.post(
        "/api/radio/listen",
        json={
            "track_id": str(track.id),
            "played_seconds": track.duration_seconds,
            "duration_seconds": track.duration_seconds,
            "skipped": False,
            "source": "radio",
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["completion_ratio"] == 1.0
    assert response.json()["qualified"] is True

    response = authed.post(
        "/api/radio/feedback",
        json={
            "track_id": str(track.id),
            "verdict": "reject",
            "reason": "skip",
        },
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["verdict"] == "reject"

    response = authed.get("/api/radio/session")
    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert response.json()["qualified_seed_count"] >= 1

    response = authed.put(
        "/api/radio/session",
        json={"discovery_level": "adventurous", "seed_track_id": str(track.id)},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["discovery_level"] == "adventurous"
    assert response.json()["seed_track"]["id"] == str(track.id)


def test_radio_next_endpoint_uses_fake_lastfm(client, db_session):
    authed, headers = make_authed_client(client)
    seed = make_track(db_session, "Next Seed", "Next Artist")
    add_listen(db_session, seed, 0.95)
    session = get_or_create_session(db_session, admin(db_session).id)
    session.seed_track_id = seed.id
    db_session.add(session)
    db_session.commit()

    fake = FakeLastfm(
        similar={
            ("Next Artist", "Next Seed"): [
                SimilarTrack("Candidate", "Other Artist", 0.9)
            ]
        }
    )
    from app.main import app

    app.dependency_overrides[get_lastfm_client] = lambda: fake
    try:
        response = authed.post(
            "/api/radio/next",
            json={"limit": 10, "exclude": []},
            headers=headers,
        )
    finally:
        app.dependency_overrides.pop(get_lastfm_client, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["seed_count"] >= 1
    assert payload["recommendations"]
    assert payload["recommendations"][0]["title"] == "Candidate"
    assert payload["recommendations"][0]["recording_key"]


def test_cancel_import_job_endpoint(client, db_session):
    authed, headers = make_authed_client(client)
    configure_settings(db_session)
    job = make_job(db_session)

    response = authed.post(
        f"/api/import-jobs/{job.id}/cancel", headers=headers
    )
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    db_session.refresh(job)
    assert job.status is RipJobStatus.cancelled
