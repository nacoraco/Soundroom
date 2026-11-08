import logging
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import AuthContext, require_csrf
from ..models import Track
from ..recommendations import (
    SIMILAR_LIMIT,
    LastfmClient,
    LastfmError,
    build_recommendations,
    lastfm_seed_metadata,
)
from ..schemas import (
    DiscoverRecommendation,
    DiscoverRequest,
    DiscoverResponse,
    TrackOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/discover", tags=["discover"])


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
        created_at=track.created_at,
    )


def get_lastfm_client(
    settings: Settings = Depends(get_settings),
) -> Iterator[LastfmClient]:
    if not settings.lastfm_api_key.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm recommendations are not configured.",
        )
    client = LastfmClient(
        api_key=settings.lastfm_api_key,
        base_url=settings.lastfm_base_url,
        timeout=settings.lastfm_timeout_seconds,
    )
    try:
        yield client
    finally:
        client.close()


@router.post("/similar", response_model=DiscoverResponse)
def discover_similar(
    payload: DiscoverRequest,
    _: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    client: LastfmClient = Depends(get_lastfm_client),
) -> DiscoverResponse:
    seeds = db.scalars(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(
            Track.id.in_(payload.seed_track_ids),
            Track.is_available.is_(True),
        )
    ).all()
    if len(seeds) != len(payload.seed_track_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more seed tracks were not found.",
        )

    seeds_by_id = {seed.id: seed for seed in seeds}
    ordered_seeds = [seeds_by_id[track_id] for track_id in payload.seed_track_ids]
    local_tracks = db.scalars(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(Track.is_available.is_(True))
        .order_by(Track.id)
    ).all()

    similar_by_seed = []
    try:
        for seed in ordered_seeds:
            artist, title = lastfm_seed_metadata(seed)
            similar_by_seed.append(
                (
                    seed,
                    client.get_similar(artist, title, limit=SIMILAR_LIMIT),
                )
            )
    except LastfmError as exc:
        logger.warning("Last.fm recommendation request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Last.fm recommendations are temporarily unavailable.",
        ) from exc

    recommendations = build_recommendations(
        ordered_seeds,
        similar_by_seed,
        list(local_tracks),
    )
    return DiscoverResponse(
        seeds=payload.seed_track_ids,
        recommendations=[
            DiscoverRecommendation(
                track=_track_out(recommendation.track),
                score=recommendation.score,
                seed_count=recommendation.seed_count,
            )
            for recommendation in recommendations
        ],
    )
