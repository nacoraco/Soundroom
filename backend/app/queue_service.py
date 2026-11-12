from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from . import import_service
from .models import (
    ACTIVE_RIP_JOB_STATUSES,
    QueueItem,
    QueueItemSource,
    QueueItemStatus,
    RadioSession,
    RipJob,
    RipJobStatus,
    Track,
)
from .radio import build_radio_batch, get_or_create_session
from .recommendations import LastfmClient, song_identity

QUEUE_TARGET_AHEAD = 3
QUEUE_MAX_ITEMS = 50


class QueueValidationError(Exception):
    pass


@dataclass
class QueueState:
    session: RadioSession
    items: list[QueueItem]
    current_index: int
    needs_refill: bool


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _bump(session: RadioSession) -> None:
    session.revision = (session.revision or 0) + 1


def _load_items(db: Session, user_id: UUID) -> list[QueueItem]:
    return list(
        db.scalars(
            select(QueueItem)
            .where(QueueItem.user_id == user_id)
            .order_by(QueueItem.position.asc(), QueueItem.created_at.asc())
        ).all()
    )


def _renumber(items: list[QueueItem]) -> None:
    for index, item in enumerate(items):
        item.position = index


def _track_data(track: Track) -> dict:
    recording_key = track.recording_key or song_identity(
        track.artist.name, track.title
    )
    return {
        "title": track.canonical_title or track.title,
        "artist": track.artist.name,
        "recording_key": recording_key,
        "expected_duration_seconds": track.duration_seconds,
    }


def _cancel_item_job(db: Session, item: QueueItem) -> None:
    if item.import_job_id is None:
        return
    job = db.get(RipJob, item.import_job_id)
    if job is not None and job.status in ACTIVE_RIP_JOB_STATUSES:
        job.status = RipJobStatus.cancelled
        job.finished_at = _now()
        db.add(job)


def _current_index(session: RadioSession, items: list[QueueItem]) -> int:
    if session.current_item_id is None:
        return -1
    for index, item in enumerate(items):
        if item.id == session.current_item_id:
            return index
    return -1


def _auto_ahead(
    items: list[QueueItem], current_index: int
) -> list[QueueItem]:
    ahead = items[current_index + 1 :] if current_index >= 0 else items
    return [
        item
        for item in ahead
        if item.source == QueueItemSource.radio
        and item.status != QueueItemStatus.failed
    ]


def build_state(
    db: Session,
    user_id: UUID,
    *,
    commit: bool = False,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    current_index = _current_index(session, items)
    changed = False
    if session.current_item_id is not None and current_index == -1:
        session.current_item_id = None
        session.is_playing = False
        _bump(session)
        db.add(session)
        changed = True
    auto_ahead = _auto_ahead(items, current_index)
    needs_refill = (
        bool(items)
        and len(auto_ahead) < QUEUE_TARGET_AHEAD
        and not session.queue_exhausted
    )
    if changed or commit:
        db.commit()
    return QueueState(
        session=session,
        items=items,
        current_index=current_index,
        needs_refill=needs_refill,
    )


def _load_tracks(
    db: Session, track_ids: list[UUID]
) -> list[Track]:
    if not track_ids:
        return []
    tracks = db.scalars(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(Track.id.in_(track_ids), Track.is_available.is_(True))
    ).all()
    by_id = {track.id: track for track in tracks}
    return [by_id[track_id] for track_id in track_ids if track_id in by_id]


def play_tracks(
    db: Session,
    user_id: UUID,
    track_ids: list[UUID],
    *,
    start_track_id: UUID | None = None,
) -> QueueState:
    unique_ids: list[UUID] = []
    seen: set[UUID] = set()
    for track_id in track_ids:
        if track_id not in seen:
            seen.add(track_id)
            unique_ids.append(track_id)
    tracks = _load_tracks(db, unique_ids)
    if len(tracks) != len(unique_ids):
        raise QueueValidationError("One or more tracks are not available.")
    if not tracks:
        return clear_queue(db, user_id)

    session = get_or_create_session(db, user_id)
    session.current_item_id = None
    db.flush()
    for item in _load_items(db, user_id):
        _cancel_item_job(db, item)
        db.delete(item)
    db.flush()

    items: list[QueueItem] = []
    start_index = 0
    for index, track in enumerate(tracks):
        if start_track_id is not None and track.id == start_track_id:
            start_index = index
        data = _track_data(track)
        item = QueueItem(
            user_id=user_id,
            position=index,
            track_id=track.id,
            recording_key=data["recording_key"],
            title=data["title"],
            artist=data["artist"],
            expected_duration_seconds=data["expected_duration_seconds"],
            source=QueueItemSource.manual,
            status=QueueItemStatus.ready,
        )
        db.add(item)
        items.append(item)
    db.flush()

    current = items[start_index]
    session.current_item_id = current.id
    if current.track_id is not None:
        session.seed_track_id = current.track_id
    session.is_playing = True
    session.position_seconds = 0
    session.queue_exhausted = False
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def play_item(
    db: Session,
    user_id: UUID,
    item_id: UUID,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    item = db.scalar(
        select(QueueItem).where(
            QueueItem.id == item_id,
            QueueItem.user_id == user_id,
        )
    )
    if item is None:
        raise QueueValidationError("Queue item not found.")
    if item.status == QueueItemStatus.failed:
        raise QueueValidationError("This queue item failed to import.")
    session.current_item_id = item.id
    if item.track_id is not None:
        session.seed_track_id = item.track_id
    session.is_playing = True
    session.position_seconds = 0
    session.queue_exhausted = False
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def advance(
    db: Session,
    user_id: UUID,
    direction: str,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    current_index = _current_index(session, items)
    target_index = -1

    if direction == "previous":
        if current_index > 0:
            for index in range(current_index - 1, -1, -1):
                if items[index].status != QueueItemStatus.failed:
                    target_index = index
                    break
        if target_index == -1:
            session.position_seconds = 0
            db.add(session)
            db.commit()
            return build_state(db, user_id)
    else:
        start = current_index + 1 if current_index >= 0 else 0
        for index in range(start, len(items)):
            if items[index].status != QueueItemStatus.failed:
                target_index = index
                break
        if target_index == -1:
            session.is_playing = False
            session.position_seconds = 0
            _bump(session)
            db.add(session)
            db.commit()
            return build_state(db, user_id)

    target = items[target_index]
    session.current_item_id = target.id
    if target.track_id is not None:
        session.seed_track_id = target.track_id
    session.is_playing = True
    session.position_seconds = 0
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def update_playback_state(
    db: Session,
    user_id: UUID,
    *,
    current_item_id: UUID | None,
    is_playing: bool,
    position_seconds: int,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    changed = False
    if current_item_id is not None and current_item_id != session.current_item_id:
        item = db.scalar(
            select(QueueItem).where(
                QueueItem.id == current_item_id,
                QueueItem.user_id == user_id,
            )
        )
        if item is None:
            raise QueueValidationError("Queue item not found.")
        session.current_item_id = item.id
        if item.track_id is not None:
            session.seed_track_id = item.track_id
        changed = True
    if session.is_playing != is_playing:
        session.is_playing = is_playing
        changed = True
    session.position_seconds = max(0, position_seconds)
    if changed:
        _bump(session)
        db.add(session)
    db.commit()
    return build_state(db, user_id)


def enqueue_tracks(
    db: Session,
    user_id: UUID,
    track_ids: list[UUID],
) -> QueueState:
    unique_ids: list[UUID] = []
    seen: set[UUID] = set()
    for track_id in track_ids:
        if track_id not in seen:
            seen.add(track_id)
            unique_ids.append(track_id)
    tracks = _load_tracks(db, unique_ids)
    if len(tracks) != len(unique_ids):
        raise QueueValidationError("One or more tracks are not available.")
    if not tracks:
        return build_state(db, user_id)

    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    current_index = _current_index(session, items)
    insert_at = len(items)
    for index in range(current_index + 1, len(items)):
        if items[index].source == QueueItemSource.radio:
            insert_at = index
            break
    new_items: list[QueueItem] = []
    for offset, track in enumerate(tracks):
        data = _track_data(track)
        item = QueueItem(
            user_id=user_id,
            position=insert_at + offset,
            track_id=track.id,
            recording_key=data["recording_key"],
            title=data["title"],
            artist=data["artist"],
            expected_duration_seconds=data["expected_duration_seconds"],
            source=QueueItemSource.manual,
            status=QueueItemStatus.ready,
        )
        db.add(item)
        new_items.append(item)
    for index, item in enumerate(items):
        if index >= insert_at:
            item.position += len(new_items)
    db.flush()
    if session.current_item_id is None and new_items:
        session.current_item_id = new_items[0].id
        session.seed_track_id = new_items[0].track_id
    session.queue_exhausted = False
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def remove_item(
    db: Session,
    user_id: UUID,
    item_id: UUID,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    index = next(
        (i for i, item in enumerate(items) if item.id == item_id), -1
    )
    if index == -1:
        return build_state(db, user_id)
    item = items[index]
    was_current = session.current_item_id == item.id
    _cancel_item_job(db, item)
    db.delete(item)
    db.flush()
    items.pop(index)
    _renumber(items)

    if was_current:
        replacement = None
        for candidate in items[index:]:
            if candidate.status != QueueItemStatus.failed:
                replacement = candidate
                break
        if replacement is None:
            for candidate in reversed(items[:index]):
                if candidate.status != QueueItemStatus.failed:
                    replacement = candidate
                    break
        session.current_item_id = replacement.id if replacement else None
        session.is_playing = replacement is not None
        session.position_seconds = 0
        if replacement and replacement.track_id is not None:
            session.seed_track_id = replacement.track_id
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def remove_items_by_recording_key(
    db: Session,
    user_id: UUID,
    recording_key: str,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    current_index = _current_index(session, items)
    removed_current = False
    remaining: list[QueueItem] = []
    for index, item in enumerate(items):
        if item.recording_key == recording_key:
            _cancel_item_job(db, item)
            if index == current_index:
                removed_current = True
            db.delete(item)
        else:
            remaining.append(item)
    if len(remaining) == len(items):
        return build_state(db, user_id)
    db.flush()
    _renumber(remaining)

    if removed_current:
        replacement = None
        for index in range(current_index + 1, len(items)):
            candidate = items[index]
            if (
                candidate.recording_key != recording_key
                and candidate.status != QueueItemStatus.failed
            ):
                replacement = candidate
                break
        if replacement is None:
            for index in range(current_index - 1, -1, -1):
                candidate = items[index]
                if (
                    candidate.recording_key != recording_key
                    and candidate.status != QueueItemStatus.failed
                ):
                    replacement = candidate
                    break
        session.current_item_id = replacement.id if replacement else None
        session.is_playing = replacement is not None
        session.position_seconds = 0
        if replacement and replacement.track_id is not None:
            session.seed_track_id = replacement.track_id
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def clear_queue(db: Session, user_id: UUID) -> QueueState:
    session = get_or_create_session(db, user_id)
    session.current_item_id = None
    db.flush()
    for item in _load_items(db, user_id):
        _cancel_item_job(db, item)
        db.delete(item)
    session.seed_track_id = None
    session.is_playing = False
    session.position_seconds = 0
    session.queue_exhausted = False
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def _prune_played_items(
    db: Session,
    user_id: UUID,
    session: RadioSession,
) -> bool:
    items = _load_items(db, user_id)
    current_index = _current_index(session, items)
    if current_index <= 10:
        return False
    remove_count = current_index - 10
    for item in items[:remove_count]:
        _cancel_item_job(db, item)
        db.delete(item)
    db.flush()
    _renumber(items[remove_count:])
    _bump(session)
    db.add(session)
    return True


def _remove_failed_items(
    db: Session,
    user_id: UUID,
    session: RadioSession,
) -> bool:
    items = _load_items(db, user_id)
    failed = [item for item in items if item.status == QueueItemStatus.failed]
    if not failed:
        return False
    current_index = _current_index(session, items)
    current_failed = (
        current_index >= 0 and items[current_index].status == QueueItemStatus.failed
    )
    for item in failed:
        db.delete(item)
    db.flush()

    if current_failed:
        replacement = None
        for index in range(current_index + 1, len(items)):
            if items[index].status != QueueItemStatus.failed:
                replacement = items[index]
                break
        if replacement is None:
            for index in range(current_index - 1, -1, -1):
                if items[index].status != QueueItemStatus.failed:
                    replacement = items[index]
                    break
        session.current_item_id = replacement.id if replacement else None
        session.is_playing = replacement is not None
        session.position_seconds = 0
        if replacement and replacement.track_id is not None:
            session.seed_track_id = replacement.track_id
        _bump(session)
        db.add(session)

    remaining = [item for item in items if item.status != QueueItemStatus.failed]
    _renumber(remaining)
    return True


def refill_queue(
    db: Session,
    user_id: UUID,
    client: LastfmClient,
) -> QueueState:
    session = get_or_create_session(db, user_id)
    pruned = _prune_played_items(db, user_id, session)
    if pruned:
        db.commit()
    removed_failed = _remove_failed_items(db, user_id, session)
    if removed_failed:
        db.commit()

    state = build_state(db, user_id)
    items = state.items
    current_index = state.current_index
    auto_ahead = _auto_ahead(items, current_index)
    needed = QUEUE_TARGET_AHEAD - len(auto_ahead)
    if needed <= 0:
        if session.queue_exhausted:
            session.queue_exhausted = False
            _bump(session)
            db.add(session)
            db.commit()
        return build_state(db, user_id)

    slots = QUEUE_MAX_ITEMS - len(items)
    needed = min(needed, max(0, slots))
    if needed <= 0:
        return build_state(db, user_id)

    queue_keys = {item.recording_key for item in items}
    if current_index >= 0:
        queue_keys.add(items[current_index].recording_key)

    selected, _seed_count = build_radio_batch(
        db,
        client,
        user_id,
        session,
        limit=needed,
        exclude=list(queue_keys),
    )

    items = _load_items(db, user_id)
    next_position = items[-1].position + 1 if items else 0
    added = 0
    exhausted = False

    for candidate in selected:
        key = candidate.recording_key
        if not key or key in queue_keys:
            continue
        queue_keys.add(key)

        if candidate.local_track is not None:
            track = candidate.local_track
            data = _track_data(track)
            item = QueueItem(
                user_id=user_id,
                position=next_position,
                track_id=track.id,
                recording_key=data["recording_key"],
                title=data["title"],
                artist=data["artist"],
                expected_duration_seconds=data[
                    "expected_duration_seconds"
                ],
                source=QueueItemSource.radio,
                status=QueueItemStatus.ready,
                reason=candidate.reason,
            )
            db.add(item)
            next_position += 1
            added += 1
            continue

        try:
            job = import_service.create_job(
                db,
                user_id=user_id,
                query=f"{candidate.artist} {candidate.title}".strip(),
                force_llm_approval=True,
                source_artist=candidate.artist,
                source_title=candidate.title,
                expected_duration_seconds=(
                    candidate.expected_duration_seconds
                ),
                recording_key=key,
            )
        except import_service.ImportDisabledError:
            exhausted = True
            break
        except import_service.ImportValidationError:
            continue

        if job.status == RipJobStatus.completed and job.track_id is not None:
            track = db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == job.track_id)
            )
            if track is None:
                continue
            data = _track_data(track)
            item = QueueItem(
                user_id=user_id,
                position=next_position,
                track_id=track.id,
                recording_key=data["recording_key"],
                title=data["title"],
                artist=data["artist"],
                expected_duration_seconds=data[
                    "expected_duration_seconds"
                ],
                source=QueueItemSource.radio,
                status=QueueItemStatus.ready,
                reason=candidate.reason,
            )
        else:
            item = QueueItem(
                user_id=user_id,
                position=next_position,
                recording_key=key,
                title=candidate.title,
                artist=candidate.artist,
                expected_duration_seconds=(
                    candidate.expected_duration_seconds
                ),
                source=QueueItemSource.radio,
                status=QueueItemStatus.pending,
                import_job_id=job.id,
                reason=candidate.reason,
            )
        db.add(item)
        next_position += 1
        added += 1

    if added == 0:
        exhausted = True
    session.queue_exhausted = exhausted
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def import_to_queue(
    db: Session,
    user_id: UUID,
    *,
    query: str,
    candidate_url: str | None,
    candidate_title: str | None,
    candidate_artist: str | None,
    candidate_duration_seconds: int | None,
    video_id: str | None,
    play_now: bool,
    source_artist: str | None,
    source_title: str | None,
    expected_duration_seconds: int | None,
    recording_key: str | None,
) -> QueueState:
    item_key = recording_key
    if not item_key and (source_artist or candidate_artist):
        item_key = song_identity(
            source_artist or candidate_artist or "",
            source_title or candidate_title or query,
        )
    session = get_or_create_session(db, user_id)
    items = _load_items(db, user_id)
    if item_key:
        existing_item = next(
            (item for item in items if item.recording_key == item_key),
            None,
        )
        if existing_item is not None:
            if play_now:
                session.current_item_id = existing_item.id
                session.is_playing = True
                session.position_seconds = 0
                session.seed_track_id = existing_item.track_id
            session.queue_exhausted = False
            _bump(session)
            db.add(session)
            db.commit()
            return build_state(db, user_id)

    job = import_service.create_job(
        db,
        user_id=user_id,
        query=query,
        candidate_url=candidate_url,
        candidate_title=candidate_title,
        candidate_artist=candidate_artist,
        candidate_duration_seconds=candidate_duration_seconds,
        force_llm_approval=False,
        source_artist=source_artist,
        source_title=source_title,
        expected_duration_seconds=expected_duration_seconds,
        recording_key=recording_key,
    )
    existing = next(
        (item for item in items if item.import_job_id == job.id), None
    )
    if existing is not None:
        item = existing
    else:
        next_position = items[-1].position + 1 if items else 0
        if (
            job.status == RipJobStatus.completed
            and job.track_id is not None
        ):
            track = db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == job.track_id)
            )
            if track is None:
                raise QueueValidationError("Imported track not found.")
            data = _track_data(track)
            item = QueueItem(
                user_id=user_id,
                position=next_position,
                track_id=track.id,
                recording_key=data["recording_key"],
                title=data["title"],
                artist=data["artist"],
                expected_duration_seconds=data[
                    "expected_duration_seconds"
                ],
                source=QueueItemSource.manual,
                status=QueueItemStatus.ready,
                import_job_id=job.id,
            )
        else:
            item_key = (
                job.recording_key
                or recording_key
                or (
                    song_identity(
                        source_artist or candidate_artist or "",
                        source_title or candidate_title or query,
                    )
                    if (source_artist or candidate_artist)
                    else ""
                )
            )
            item = QueueItem(
                user_id=user_id,
                position=next_position,
                recording_key=item_key,
                title=(
                    job.source_title
                    or source_title
                    or candidate_title
                    or query
                ),
                artist=(
                    job.source_artist
                    or source_artist
                    or candidate_artist
                    or ""
                ),
                video_id=video_id,
                expected_duration_seconds=(
                    expected_duration_seconds
                    or candidate_duration_seconds
                ),
                source=QueueItemSource.manual,
                status=QueueItemStatus.pending,
                import_job_id=job.id,
            )
        db.add(item)
        db.flush()

    if play_now:
        session.current_item_id = item.id
        session.is_playing = True
        session.position_seconds = 0
        session.seed_track_id = item.track_id
    _bump(session)
    db.add(session)
    db.commit()
    return build_state(db, user_id)


def mark_job_ready(
    db: Session,
    job_id: UUID,
    track_id: UUID,
) -> None:
    track = db.scalar(
        select(Track)
        .options(joinedload(Track.artist))
        .where(Track.id == track_id)
    )
    if track is None:
        return
    data = _track_data(track)
    items = db.scalars(
        select(QueueItem).where(QueueItem.import_job_id == job_id)
    ).all()
    if not items:
        return
    user_ids: set[UUID] = set()
    for item in items:
        item.track_id = track.id
        item.recording_key = data["recording_key"]
        item.title = data["title"]
        item.artist = data["artist"]
        item.expected_duration_seconds = data[
            "expected_duration_seconds"
        ]
        item.status = QueueItemStatus.ready
        item.error_message = None
        user_ids.add(item.user_id)
    for user_id in user_ids:
        session = get_or_create_session(db, user_id)
        _bump(session)
        db.add(session)
    db.commit()


def mark_job_failed(
    db: Session,
    job_id: UUID,
    message: str,
) -> None:
    items = db.scalars(
        select(QueueItem).where(QueueItem.import_job_id == job_id)
    ).all()
    if not items:
        return
    user_ids: set[UUID] = set()
    for item in items:
        item.status = QueueItemStatus.failed
        item.error_message = message[:1000]
        user_ids.add(item.user_id)
    for user_id in user_ids:
        session = get_or_create_session(db, user_id)
        _bump(session)
        db.add(session)
    db.commit()
