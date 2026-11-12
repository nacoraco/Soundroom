from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import import_service, queue_service
from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..models import QueueItem, Track
from ..radio import qualified_seed_count
from ..recommendations import LastfmClient
from ..schemas import (
    QueueAdvanceRequest,
    QueueEnqueueRequest,
    QueueImportRequest,
    QueueItemOut,
    QueuePlayItemRequest,
    QueuePlayRequest,
    QueueStateOut,
    QueueStateUpdate,
    TrackOut,
)
from .radio import get_lastfm_client

router = APIRouter(prefix="/api/queue", tags=["queue"])


def _track_out(track: Track) -> TrackOut:
    return TrackOut(
        id=track.id,
        title=track.title,
        artist_name=track.artist.name,
        album_title=track.album.title if track.album else None,
        release_year=track.album.release_year if track.album else None,
        duration_seconds=track.duration_seconds,
        mime_type=track.mime_type,
        source_type=track.source_type,
        is_available=track.is_available,
        recording_key=track.recording_key,
        created_at=track.created_at,
    )


def _item_out(item: QueueItem) -> QueueItemOut:
    import_status = None
    if item.import_job is not None:
        import_status = getattr(
            item.import_job.status, "value", item.import_job.status
        )
    return QueueItemOut(
        id=item.id,
        position=item.position,
        status=getattr(item.status, "value", item.status),
        source=getattr(item.source, "value", item.source),
        recording_key=item.recording_key,
        title=item.title,
        artist=item.artist,
        video_id=item.video_id,
        expected_duration_seconds=item.expected_duration_seconds,
        import_job_id=item.import_job_id,
        import_status=import_status,
        error_message=item.error_message,
        reason=item.reason,
        track=_track_out(item.track) if item.track is not None else None,
    )


def _state_out(db: Session, state: queue_service.QueueState, user_id: UUID) -> QueueStateOut:
    session = state.session
    return QueueStateOut(
        revision=session.revision,
        current_item_id=session.current_item_id,
        current_index=state.current_index,
        is_playing=session.is_playing,
        position_seconds=session.position_seconds,
        needs_refill=state.needs_refill,
        radio_exhausted=session.queue_exhausted,
        qualified_seed_count=qualified_seed_count(db, user_id),
        items=[_item_out(item) for item in state.items],
    )


@router.get("", response_model=QueueStateOut)
def get_queue(
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    state = queue_service.build_state(db, ctx.user.id, commit=True)
    return _state_out(db, state, ctx.user.id)


@router.post("/play", response_model=QueueStateOut)
def play(
    payload: QueuePlayRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    try:
        state = queue_service.play_tracks(
            db,
            ctx.user.id,
            payload.track_ids,
            start_track_id=payload.start_track_id,
        )
    except queue_service.QueueValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _state_out(db, state, ctx.user.id)


@router.post("/play-item", response_model=QueueStateOut)
def play_item(
    payload: QueuePlayItemRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    try:
        state = queue_service.play_item(db, ctx.user.id, payload.item_id)
    except queue_service.QueueValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _state_out(db, state, ctx.user.id)


@router.post("/advance", response_model=QueueStateOut)
def advance(
    payload: QueueAdvanceRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    state = queue_service.advance(db, ctx.user.id, payload.direction)
    return _state_out(db, state, ctx.user.id)


@router.post("/state", response_model=QueueStateOut)
def update_state(
    payload: QueueStateUpdate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    try:
        state = queue_service.update_playback_state(
            db,
            ctx.user.id,
            current_item_id=payload.current_item_id,
            is_playing=payload.is_playing,
            position_seconds=payload.position_seconds,
        )
    except queue_service.QueueValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _state_out(db, state, ctx.user.id)


@router.post("/items", response_model=QueueStateOut)
def enqueue(
    payload: QueueEnqueueRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    try:
        state = queue_service.enqueue_tracks(
            db, ctx.user.id, payload.track_ids
        )
    except queue_service.QueueValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _state_out(db, state, ctx.user.id)


@router.delete("/items/{item_id}", response_model=QueueStateOut)
def remove_item(
    item_id: UUID,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    state = queue_service.remove_item(db, ctx.user.id, item_id)
    return _state_out(db, state, ctx.user.id)


@router.post("/clear", response_model=QueueStateOut)
def clear(
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    state = queue_service.clear_queue(db, ctx.user.id)
    return _state_out(db, state, ctx.user.id)


@router.post("/refill", response_model=QueueStateOut)
def refill(
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    client: LastfmClient = Depends(get_lastfm_client),
) -> QueueStateOut:
    state = queue_service.refill_queue(db, ctx.user.id, client)
    return _state_out(db, state, ctx.user.id)


@router.post("/import", response_model=QueueStateOut)
def import_track(
    payload: QueueImportRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> QueueStateOut:
    if payload.candidate is None and not (
        payload.source_artist and payload.source_title
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "source_artist and source_title are required when no "
                "candidate is selected."
            ),
        )
    candidate_url = (
        "https://www.youtube.com/watch?v="
        f"{payload.candidate.video_id}"
        if payload.candidate is not None
        else None
    )
    try:
        state = queue_service.import_to_queue(
            db,
            ctx.user.id,
            query=payload.query,
            candidate_url=candidate_url,
            candidate_title=(
                payload.candidate.title
                if payload.candidate is not None
                else payload.source_title
            ),
            candidate_artist=(
                payload.candidate.artist
                if payload.candidate is not None
                else payload.source_artist
            ),
            candidate_duration_seconds=(
                payload.candidate.duration_seconds
                if payload.candidate is not None
                else None
            ),
            video_id=(
                payload.candidate.video_id
                if payload.candidate is not None
                else None
            ),
            play_now=payload.play_now,
            source_artist=payload.source_artist,
            source_title=payload.source_title,
            expected_duration_seconds=(
                payload.expected_duration_seconds
                or (
                    payload.candidate.duration_seconds
                    if payload.candidate is not None
                    else None
                )
            ),
            recording_key=payload.recording_key,
        )
    except import_service.ImportDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except (
        import_service.ImportValidationError,
        queue_service.QueueValidationError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return _state_out(db, state, ctx.user.id)
