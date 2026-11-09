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
    RESULT_LIMIT,
    SIMILAR_LIMIT,
    LastfmClient,
    LastfmError,
    SeedReference,
    SimilarTrack,
    build_recommendations,
    clean_seed_metadata,
)
from ..schemas import (
    DiscoverRecommendation,
    DiscoverRequest,
    DiscoverResponse,
    RadioRequest,
    RadioResponse,
    TrackOut,
)
from ..text import normalize_text

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


def _recommendation_out(recommendation) -> DiscoverRecommendation:
    return DiscoverRecommendation(
        title=recommendation.title,
        artist=recommendation.artist,
        local_track=(
            _track_out(recommendation.local_track)
            if recommendation.local_track is not None
            else None
        ),
        score=recommendation.score,
        seed_count=recommendation.seed_count,
    )


def _similar_tracks_for_seed(
    client: LastfmClient,
    artist: str,
    title: str,
) -> list[SimilarTrack]:
    tracks = client.get_similar(artist, title, limit=SIMILAR_LIMIT)
    if tracks:
        return tracks

    fallback: list[SimilarTrack] = []
    similar_artists = client.get_similar_artists(artist, limit=5)
    for similar_artist in similar_artists:
        top_tracks = client.get_artist_top_tracks(
            similar_artist.name,
            limit=5,
        )
        for index, track in enumerate(top_tracks):
            match = max(
                0.1,
                similar_artist.match * (1.0 - index * 0.12),
            )
            fallback.append(
                SimilarTrack(
                    title=track.title,
                    artist=track.artist,
                    match=match,
                )
            )
            if len(fallback) >= SIMILAR_LIMIT:
                break
        if len(fallback) >= SIMILAR_LIMIT:
            break

    if not fallback:
        for index, track in enumerate(
            client.get_artist_top_tracks(artist, limit=10)
        ):
            fallback.append(
                SimilarTrack(
                    title=track.title,
                    artist=track.artist,
                    match=max(0.1, 0.6 - index * 0.04),
                )
            )

    return fallback[:SIMILAR_LIMIT]

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


def _load_local_tracks(db: Session) -> list[Track]:
    return list(
        db.scalars(
            select(Track)
            .options(joinedload(Track.artist), joinedload(Track.album))
            .where(Track.is_available.is_(True))
            .order_by(Track.id)
        ).all()
    )


def _lastfm_failure(exc: Exception) -> HTTPException:
    logger.warning("Last.fm recommendation request failed: %s", exc)
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Last.fm recommendations are temporarily unavailable.",
    )


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
    seed_refs = [
        SeedReference(
            title=clean_seed_metadata(seed.artist.name, seed.title)[1],
            artist=clean_seed_metadata(seed.artist.name, seed.title)[0],
            track_id=seed.id,
        )
        for seed in ordered_seeds
    ]
    similar_by_seed = []
    try:
        for seed, seed_ref in zip(ordered_seeds, seed_refs):
            artist, title = clean_seed_metadata(seed.artist.name, seed.title)
            similar_by_seed.append(
                (
                    seed_ref,
                    _similar_tracks_for_seed(client, artist, title),
                )
            )
    except LastfmError as exc:
        raise _lastfm_failure(exc) from exc

    recommendations = build_recommendations(
        seed_refs,
        similar_by_seed,
        _load_local_tracks(db),
        limit=RESULT_LIMIT,
    )
    return DiscoverResponse(
        seeds=payload.seed_track_ids,
        recommendations=[
            _recommendation_out(recommendation)
            for recommendation in recommendations
        ],
    )


@router.post("/radio", response_model=RadioResponse)
def discover_radio(
    payload: RadioRequest,
    _: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    client: LastfmClient = Depends(get_lastfm_client),
) -> RadioResponse:
    seed_refs = [
        SeedReference(
            title=clean_seed_metadata(seed.artist, seed.title)[1],
            artist=clean_seed_metadata(seed.artist, seed.title)[0],
        )
        for seed in payload.seeds
    ]
    similar_by_seed = []
    try:
        for seed_ref in seed_refs:
            similar_by_seed.append(
                (
                    seed_ref,
                    _similar_tracks_for_seed(
                        client,
                        seed_ref.artist,
                        seed_ref.title,
                    ),
                )
            )
    except LastfmError as exc:
        raise _lastfm_failure(exc) from exc

    recommendations = build_recommendations(
        seed_refs,
        similar_by_seed,
        _load_local_tracks(db),
        limit=RESULT_LIMIT + len(payload.exclude),
    )
    excluded_keys: set[tuple[str, str]] = set()
    for item in payload.exclude:
        artist, title = clean_seed_metadata(item.artist, item.title)
        excluded_keys.add((normalize_text(title), normalize_text(artist)))
        excluded_keys.add((normalize_text(item.title), normalize_text(item.artist)))
    recommendations = [
        recommendation
        for recommendation in recommendations
        if (
            normalize_text(
                clean_seed_metadata(
                    recommendation.artist,
                    recommendation.title,
                )[1]
            ),
            normalize_text(
                clean_seed_metadata(
                    recommendation.artist,
                    recommendation.title,
                )[0]
            ),
        )
        not in excluded_keys
    ][: payload.limit]
    return RadioResponse(
        recommendations=[
            _recommendation_out(recommendation)
            for recommendation in recommendations
        ],
    )
