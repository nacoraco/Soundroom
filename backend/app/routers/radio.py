from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..models import Track
from ..radio import (
    DEFAULT_BATCH_LIMIT,
    build_radio_batch,
    get_or_create_session,
    qualified_seed_count,
    record_listen,
    set_feedback,
)
from ..recommendations import LastfmClient, canonical_metadata, song_identity
from ..schemas import (
    RadioFeedbackCreate,
    RadioListenCreate,
    RadioListenOut,
    RadioNextRequest,
    RadioNextResponse,
    RadioRecommendationOut,
    RadioSessionOut,
    RadioSessionUpdate,
    TrackOut,
)

router = APIRouter(prefix="/api/radio", tags=["radio"])


def get_lastfm_client(
    settings: Settings = Depends(get_settings),
) -> Iterator[LastfmClient]:
    if not settings.lastfm_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm is not configured.",
        )
    with LastfmClient(
        api_key=settings.lastfm_api_key,
        base_url=settings.lastfm_base_url,
        timeout=settings.lastfm_timeout_seconds,
    ) as client:
        yield client


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


def _session_out(db: Session, session, user_id: UUID) -> RadioSessionOut:
    seed_track = None
    if session.seed_track_id is not None:
        seed_track = db.scalar(
            select(Track)
            .options(joinedload(Track.artist), joinedload(Track.album))
            .where(Track.id == session.seed_track_id)
        )
    return RadioSessionOut(
        enabled=session.enabled,
        discovery_level=session.discovery_level,
        seed_track=_track_out(seed_track) if seed_track else None,
        qualified_seed_count=qualified_seed_count(db, user_id),
    )


@router.get("/session", response_model=RadioSessionOut)
def get_session(
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> RadioSessionOut:
    session = get_or_create_session(db, ctx.user.id)
    return _session_out(db, session, ctx.user.id)


@router.put("/session", response_model=RadioSessionOut)
def update_session(
    payload: RadioSessionUpdate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RadioSessionOut:
    session = get_or_create_session(db, ctx.user.id)
    if payload.enabled is not None:
        session.enabled = payload.enabled
    if payload.discovery_level is not None:
        session.discovery_level = payload.discovery_level
    if payload.reset_seed:
        session.seed_track_id = None
    if payload.seed_track_id is not None:
        track = db.get(Track, payload.seed_track_id)
        if track is None or not track.is_available:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Seed track not found",
            )
        session.seed_track_id = track.id
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(db, session, ctx.user.id)


@router.post("/next", response_model=RadioNextResponse)
def next_batch(
    payload: RadioNextRequest,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    client: LastfmClient = Depends(get_lastfm_client),
) -> RadioNextResponse:
    session = get_or_create_session(db, ctx.user.id)
    if payload.discovery_level is not None:
        session.discovery_level = payload.discovery_level
        db.add(session)
        db.commit()
        db.refresh(session)

    if not session.enabled:
        return RadioNextResponse(
            recommendations=[],
            seed_count=0,
            qualified_seed_count=qualified_seed_count(db, ctx.user.id),
            discovery_level=session.discovery_level,
            exhausted=True,
        )

    selected, seed_count = build_radio_batch(
        db,
        client,
        ctx.user.id,
        session,
        limit=max(1, min(payload.limit, DEFAULT_BATCH_LIMIT * 2)),
        exclude=payload.exclude,
    )
    return RadioNextResponse(
        recommendations=[
            RadioRecommendationOut(
                title=candidate.title,
                artist=candidate.artist,
                recording_key=candidate.recording_key,
                local_track=(
                    _track_out(candidate.local_track)
                    if candidate.local_track is not None
                    else None
                ),
                score=round(candidate.score, 4),
                seed_count=len(candidate.seed_count),
                expected_duration_seconds=candidate.expected_duration_seconds,
                reason=candidate.reason,
                sources=sorted(candidate.sources),
            )
            for candidate in selected
        ],
        seed_count=seed_count,
        qualified_seed_count=qualified_seed_count(db, ctx.user.id),
        discovery_level=session.discovery_level,
        exhausted=not selected,
    )


@router.post("/feedback")
def submit_feedback(
    payload: RadioFeedbackCreate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, str | None]:
    track: Track | None = None
    if payload.track_id is not None:
        track = db.scalar(
            select(Track)
            .options(joinedload(Track.artist))
            .where(Track.id == payload.track_id)
        )
        if track is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Track not found",
            )

    if track is not None:
        recording_key = (
            track.recording_key
            or song_identity(track.artist.name, track.title)
        )
        title = track.canonical_title or track.title
        artist = track.artist.name
    else:
        if not payload.title or not payload.artist:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="title and artist are required for external tracks",
            )
        artist, title = canonical_metadata(payload.artist, payload.title)
        recording_key = (
            payload.recording_key or song_identity(artist, title)
        )

    set_feedback(
        db,
        ctx.user.id,
        recording_key=recording_key,
        artist=artist,
        title=title,
        verdict=payload.verdict,
        reason=payload.reason,
        track_id=track.id if track is not None else None,
    )
    return {"recording_key": recording_key, "verdict": payload.verdict}


@router.post("/listen", response_model=RadioListenOut)
def submit_listen(
    payload: RadioListenCreate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RadioListenOut:
    track = db.scalar(
        select(Track)
        .options(joinedload(Track.artist))
        .where(Track.id == payload.track_id)
    )
    if track is None or not track.is_available:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found",
        )
    started_at = payload.started_at
    if started_at is not None and started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    if started_at is not None and started_at > datetime.now(timezone.utc):
        started_at = datetime.now(timezone.utc)

    listen = record_listen(
        db,
        ctx.user.id,
        track=track,
        played_seconds=payload.played_seconds,
        duration_seconds=payload.duration_seconds,
        skipped=payload.skipped,
        source=payload.source,
        started_at=started_at,
    )
    return RadioListenOut(
        completion_ratio=listen.completion_ratio,
        qualified=listen.completion_ratio >= 0.9,
    )
