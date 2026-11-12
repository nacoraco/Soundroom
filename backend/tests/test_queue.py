from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import queue_service
from app.models import QueueItem, QueueItemStatus, RadioSession
from app.recommendations import SimilarTrack, song_identity

from .test_f4_worker import configure_settings, fake_convert, fake_download
from .test_radio import FakeLastfm, add_listen, admin, make_track
from .utils import auth_headers, login


def test_play_tracks_sets_current_and_manual_queue(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")

    state = queue_service.play_tracks(
        db_session, user.id, [first.id, second.id]
    )

    assert len(state.items) == 2
    assert state.current_index == 0
    assert state.session.current_item_id == state.items[0].id
    assert state.session.seed_track_id == first.id
    assert state.session.is_playing is True
    assert state.needs_refill is True
    assert all(item.source.value == "manual" for item in state.items)


def test_play_tracks_can_start_at_a_specific_track(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")

    state = queue_service.play_tracks(
        db_session,
        user.id,
        [first.id, second.id],
        start_track_id=second.id,
    )

    assert state.current_index == 1
    assert state.items[1].track_id == second.id


def test_refill_adds_local_radio_item(db_session):
    user = admin(db_session)
    seed = make_track(db_session, "Seed", "Seed Artist")
    candidate = make_track(db_session, "Candidate", "Other Artist")
    add_listen(db_session, seed, 0.95)
    state = queue_service.play_tracks(db_session, user.id, [seed.id])

    fake = FakeLastfm(
        similar={
            ("Seed Artist", "Seed"): [
                SimilarTrack("Candidate", "Other Artist", 0.9)
            ]
        }
    )
    state = queue_service.refill_queue(db_session, user.id, fake)

    radio_items = [
        item for item in state.items if item.source.value == "radio"
    ]
    assert len(radio_items) == 1
    assert radio_items[0].track_id == candidate.id
    assert radio_items[0].status is QueueItemStatus.ready
    assert state.needs_refill is True


def test_advance_skips_failed_items(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")
    third = make_track(db_session, "Third", "Artist")
    state = queue_service.play_tracks(
        db_session, user.id, [first.id, second.id, third.id]
    )
    failed = state.items[1]
    failed.status = QueueItemStatus.failed
    db_session.add(failed)
    db_session.commit()

    state = queue_service.advance(db_session, user.id, "next")
    assert state.items[state.current_index].track_id == third.id


def test_remove_current_item_advances(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")
    state = queue_service.play_tracks(
        db_session, user.id, [first.id, second.id]
    )
    current_item = state.items[0]

    state = queue_service.remove_item(
        db_session, user.id, current_item.id
    )

    assert len(state.items) == 1
    assert state.items[0].track_id == second.id
    assert state.current_index == 0
    assert state.session.is_playing is True


def test_remove_by_recording_key_from_feedback(db_session):
    user = admin(db_session)
    track = make_track(db_session, "Reject Me", "Artist")
    state = queue_service.play_tracks(db_session, user.id, [track.id])
    queue_service.remove_items_by_recording_key(
        db_session, user.id, track.recording_key
    )

    state = queue_service.build_state(db_session, user.id)
    assert state.items == []
    assert state.session.current_item_id is None
    assert state.session.is_playing is False


def test_import_to_queue_pending_then_ready(db_session):
    configure_settings(db_session)
    user = admin(db_session)
    recording_key = song_identity("Import Artist", "Imported Song")

    state = queue_service.import_to_queue(
        db_session,
        user.id,
        query="Imported Song Import Artist",
        candidate_url="https://www.youtube.com/watch?v=abcdefghijk",
        candidate_title="Imported Song",
        candidate_artist="Import Artist",
        candidate_duration_seconds=200,
        video_id="abcdefghijk",
        play_now=True,
        source_artist="Import Artist",
        source_title="Imported Song",
        expected_duration_seconds=200,
        recording_key=recording_key,
    )

    assert len(state.items) == 1
    pending_item = state.items[0]
    assert pending_item.status is QueueItemStatus.pending
    assert pending_item.import_job_id is not None
    assert state.current_index == 0
    assert state.session.is_playing is True

    track = make_track(db_session, "Imported Song", "Import Artist")
    queue_service.mark_job_ready(
        db_session, pending_item.import_job_id, track.id
    )
    state = queue_service.build_state(db_session, user.id)
    pending_item = state.items[0]
    assert pending_item.status is QueueItemStatus.ready
    assert pending_item.track_id == track.id
    assert state.current_index == 0


def test_queue_api_play_and_get(client: TestClient, db_session):
    response = login(client)
    assert response.status_code == 200
    headers = auth_headers(response.json()["csrf_token"])
    track = make_track(db_session, "API Song", "API Artist")

    response = client.post(
        "/api/queue/play",
        json={"track_ids": [str(track.id)], "start_track_id": str(track.id)},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["current_index"] == 0
    assert len(payload["items"]) == 1
    assert payload["items"][0]["track"]["id"] == str(track.id)
    assert payload["items"][0]["source"] == "manual"

    response = client.get("/api/queue")
    assert response.status_code == 200
    assert response.json()["revision"] == payload["revision"]


def test_new_queue_tables_are_wired(db_session):
    user = admin(db_session)
    queue_service.build_state(db_session, user.id)
    session = db_session.scalar(
        select(RadioSession).where(RadioSession.user_id == user.id)
    )
    assert session is not None
    assert session.revision == 0
    assert (
        db_session.scalar(
            select(QueueItem).where(QueueItem.user_id == user.id)
        )
        is None
    )

def test_refill_creates_pending_import_job_for_external_candidate(db_session):
    configure_settings(db_session)
    user = admin(db_session)
    seed = make_track(db_session, "Seed", "Seed Artist")
    add_listen(db_session, seed, 0.95)
    queue_service.play_tracks(db_session, user.id, [seed.id])

    fake = FakeLastfm(
        similar={
            ("Seed Artist", "Seed"): [
                SimilarTrack("Brand New Song", "Brand New Artist", 0.9)
            ]
        }
    )
    state = queue_service.refill_queue(db_session, user.id, fake)

    radio_items = [
        item for item in state.items if item.source.value == "radio"
    ]
    assert len(radio_items) == 1
    assert radio_items[0].status is QueueItemStatus.pending
    assert radio_items[0].import_job_id is not None
    assert radio_items[0].title == "Brand New Song"


def test_enqueue_inserts_before_radio_items(db_session):
    user = admin(db_session)
    seed = make_track(db_session, "Seed", "Seed Artist")
    candidate = make_track(db_session, "Candidate", "Other Artist")
    add_listen(db_session, seed, 0.95)
    queue_service.play_tracks(db_session, user.id, [seed.id])
    fake = FakeLastfm(
        similar={
            ("Seed Artist", "Seed"): [
                SimilarTrack("Candidate", "Other Artist", 0.9)
            ]
        }
    )
    state = queue_service.refill_queue(db_session, user.id, fake)
    assert any(item.source.value == "radio" for item in state.items)

    manual = make_track(db_session, "Manual Add", "Manual Artist")
    state = queue_service.enqueue_tracks(db_session, user.id, [manual.id])
    sources = [item.source.value for item in state.items]
    assert sources == ["manual", "manual", "radio"]
    assert state.items[1].track_id == manual.id

def test_worker_marks_queue_item_ready(
    db_session, tmp_path, monkeypatch
):
    from app import importer
    from app.config import get_settings
    from app.importer import process_next_job

    configure_settings(db_session)
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    monkeypatch.setattr(importer, "download_candidate", fake_download)
    monkeypatch.setattr(importer, "convert_to_mp3", fake_convert)
    monkeypatch.setattr(importer, "probe_duration", lambda path: 200)

    user = admin(db_session)
    state = queue_service.import_to_queue(
        db_session,
        user.id,
        query="Worker Song Worker Artist",
        candidate_url="https://www.youtube.com/watch?v=abcdefghijk",
        candidate_title="Worker Song",
        candidate_artist="Worker Artist",
        candidate_duration_seconds=200,
        video_id="abcdefghijk",
        play_now=True,
        source_artist="Worker Artist",
        source_title="Worker Song",
        expected_duration_seconds=200,
        recording_key=song_identity("Worker Artist", "Worker Song"),
    )
    assert state.items[0].status is QueueItemStatus.pending

    process_next_job(db_session, settings)
    state = queue_service.build_state(db_session, user.id)

    assert state.items[0].status is QueueItemStatus.ready
    assert state.items[0].track_id is not None
    assert state.current_index == 0

def test_queue_refill_endpoint_with_fake_lastfm(client, db_session):
    from app.main import app
    from app.routers.radio import get_lastfm_client

    response = login(client)
    assert response.status_code == 200
    headers = auth_headers(response.json()["csrf_token"])
    seed = make_track(db_session, "Endpoint Seed", "Endpoint Seed Artist")
    candidate = make_track(db_session, "Endpoint Candidate", "Endpoint Other")
    add_listen(db_session, seed, 0.95)

    response = client.post(
        "/api/queue/play",
        json={"track_ids": [str(seed.id)], "start_track_id": str(seed.id)},
        headers=headers,
    )
    assert response.status_code == 200

    fake = FakeLastfm(
        similar={
            ("Endpoint Seed Artist", "Endpoint Seed"): [
                SimilarTrack("Endpoint Candidate", "Endpoint Other", 0.9)
            ]
        }
    )
    app.dependency_overrides[get_lastfm_client] = lambda: fake
    try:
        response = client.post("/api/queue/refill", headers=headers)
    finally:
        app.dependency_overrides.pop(get_lastfm_client, None)

    assert response.status_code == 200
    payload = response.json()
    radio_items = [
        item for item in payload["items"] if item["source"] == "radio"
    ]
    assert len(radio_items) == 1
    assert radio_items[0]["status"] == "ready"
    assert radio_items[0]["track"]["id"] == str(candidate.id)

def test_rejecting_current_item_advances_to_next(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")
    third = make_track(db_session, "Third", "Artist")
    state = queue_service.play_tracks(
        db_session,
        user.id,
        [first.id, second.id, third.id],
        start_track_id=second.id,
    )
    assert state.current_index == 1

    state = queue_service.remove_items_by_recording_key(
        db_session, user.id, second.recording_key
    )

    assert len(state.items) == 2
    assert state.items[state.current_index].track_id == third.id
    assert state.session.is_playing is True

def test_refill_skips_failed_current_item(db_session):
    user = admin(db_session)
    first = make_track(db_session, "First", "Artist")
    second = make_track(db_session, "Second", "Artist")
    third = make_track(db_session, "Third", "Artist")
    state = queue_service.play_tracks(
        db_session,
        user.id,
        [first.id, second.id, third.id],
        start_track_id=second.id,
    )
    failed = state.items[1]
    failed.status = QueueItemStatus.failed
    failed.error_message = "failed"
    db_session.add(failed)
    db_session.commit()

    state = queue_service.refill_queue(
        db_session, user.id, FakeLastfm()
    )

    assert len(state.items) == 2
    assert state.items[state.current_index].track_id == third.id
    assert state.session.is_playing is True

def test_refill_prunes_old_played_items(db_session):
    user = admin(db_session)
    tracks = [
        make_track(db_session, f"Song {index}", "Artist")
        for index in range(15)
    ]
    state = queue_service.play_tracks(
        db_session,
        user.id,
        [track.id for track in tracks],
        start_track_id=tracks[-1].id,
    )
    assert state.current_index == 14

    state = queue_service.refill_queue(
        db_session, user.id, FakeLastfm()
    )

    assert len(state.items) == 11
    assert state.items[state.current_index].track_id == tracks[-1].id
