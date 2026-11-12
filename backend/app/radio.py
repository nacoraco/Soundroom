from __future__ import annotations

import logging
import random
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from .lastfm_cache import cache_get, cache_set
from .models import (
    DiscoveryLevel,
    Listen,
    RadioFeedback,
    RadioFeedbackVerdict,
    RadioSession,
    Track,
)
from .recommendations import (
    SIMILAR_LIMIT_MAX,
    LastfmClient,
    LastfmError,
    SimilarArtist,
    SimilarTrack,
    TrackInfo,
    canonical_metadata,
    song_identity,
)
from .text import normalize_text

logger = logging.getLogger(__name__)

SEED_POOL_LIMIT = 100
SEED_LOOKBACK_DAYS = 90
SEED_COMPLETION_MIN = 0.9
FALLBACK_COMPLETION_MIN = 0.5
FALLBACK_SEED_LIMIT = 5
MAX_SEEDS = 10
RECENT_EXCLUDE_LIMIT = 100
REJECTION_TTL_DAYS = 30
NOT_NOW_TTL_DAYS = 7
FAILED_TTL_DAYS = 1
ARTIST_COOLDOWN_REJECTIONS = 2
ARTIST_COOLDOWN_DAYS = 7
DEFAULT_BATCH_LIMIT = 10
ARTIST_BATCH_CAP = 2
RELAXED_ARTIST_CAP = 3
CACHE_TTL_SECONDS = 24 * 60 * 60
MIN_MATCH_BALANCED = 0.30
MIN_MATCH_ADVENTUROUS = 0.20


@dataclass(frozen=True)
class DiscoveryProfile:
    recent_seeds: int
    random_seeds: int
    similar_quota: int
    artist_quota: int
    tag_quota: int
    min_match: float
    jitter: float


PROFILES: dict[DiscoveryLevel, DiscoveryProfile] = {
    DiscoveryLevel.familiar: DiscoveryProfile(8, 2, 8, 1, 1, 0.35, 0.10),
    DiscoveryLevel.balanced: DiscoveryProfile(6, 4, 7, 2, 1, MIN_MATCH_BALANCED, 0.20),
    DiscoveryLevel.adventurous: DiscoveryProfile(
        4, 6, 6, 2, 2, MIN_MATCH_ADVENTUROUS, 0.35
    ),
}


@dataclass(frozen=True)
class RadioSeed:
    track_id: UUID | None
    title: str
    artist: str
    recording_key: str

    @property
    def key(self) -> str:
        return f"track:{self.track_id or self.recording_key}"


@dataclass
class RadioCandidate:
    title: str
    artist: str
    recording_key: str
    score: float = 0.0
    best_match: float = 0.0
    seed_count: set[str] = field(default_factory=set)
    sources: set[str] = field(default_factory=set)
    local_track: Track | None = None
    expected_duration_seconds: int | None = None
    reason: str | None = None
    rank_score: float = 0.0


def get_or_create_session(db: Session, user_id: UUID) -> RadioSession:
    session = db.scalar(
        select(RadioSession).where(RadioSession.user_id == user_id)
    )
    if session is not None:
        return session
    session = RadioSession(
        user_id=user_id,
        discovery_level=DiscoveryLevel.balanced,
        enabled=True,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def qualified_seed_count(db: Session, user_id: UUID) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=SEED_LOOKBACK_DAYS)
    count = db.scalar(
        select(func.count(func.distinct(Listen.track_id))).where(
            Listen.user_id == user_id,
            Listen.track_id.is_not(None),
            Listen.started_at >= cutoff,
            Listen.completion_ratio >= SEED_COMPLETION_MIN,
        )
    )
    return int(count or 0)


def _seed_rows(
    db: Session,
    user_id: UUID,
    min_completion: float,
    limit: int,
) -> list[RadioSeed]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=SEED_LOOKBACK_DAYS)
    rows = db.execute(
        select(
            Listen.track_id,
            Listen.recording_key,
            Listen.title,
            Listen.artist,
            func.max(Listen.started_at).label("last_started"),
        )
        .where(
            Listen.user_id == user_id,
            Listen.track_id.is_not(None),
            Listen.started_at >= cutoff,
            Listen.completion_ratio >= min_completion,
        )
        .group_by(
            Listen.track_id,
            Listen.recording_key,
            Listen.title,
            Listen.artist,
        )
        .order_by(func.max(Listen.started_at).desc())
        .limit(limit)
    ).all()
    return [
        RadioSeed(
            track_id=row.track_id,
            title=row.title,
            artist=row.artist,
            recording_key=row.recording_key,
        )
        for row in rows
    ]


def _anchor_seed(db: Session, session: RadioSession) -> RadioSeed | None:
    if session.seed_track_id is None:
        return None
    track = db.scalar(
        select(Track)
        .options(joinedload(Track.artist))
        .where(Track.id == session.seed_track_id)
    )
    if track is None or not track.is_available:
        return None
    return RadioSeed(
        track_id=track.id,
        title=track.canonical_title or track.title,
        artist=track.artist.name,
        recording_key=track.recording_key
        or song_identity(track.artist.name, track.title),
    )


def select_seeds(
    db: Session,
    user_id: UUID,
    session: RadioSession,
    profile: DiscoveryProfile,
    rng: random.Random | None = None,
) -> list[RadioSeed]:
    rng = rng or random.Random()
    recent = _seed_rows(db, user_id, SEED_COMPLETION_MIN, SEED_POOL_LIMIT)
    if not recent:
        recent = _seed_rows(
            db, user_id, FALLBACK_COMPLETION_MIN, FALLBACK_SEED_LIMIT
        )

    rejected_keys, blocked_artists = active_feedback(db, user_id)
    recent = [
        seed
        for seed in recent
        if seed.recording_key not in rejected_keys
        and normalize_text(seed.artist) not in blocked_artists
    ]

    anchor = _anchor_seed(db, session)
    if anchor is not None and (
        anchor.recording_key in rejected_keys
        or normalize_text(anchor.artist) in blocked_artists
    ):
        anchor = None
    selected: list[RadioSeed] = []
    seen: set[str] = set()

    if anchor is not None:
        selected.append(anchor)
        seen.add(anchor.recording_key)

    recent_slice = recent[: profile.recent_seeds]
    older = recent[profile.recent_seeds :]
    random_count = min(profile.random_seeds, len(older))
    random_slice = rng.sample(older, random_count) if random_count else []

    for seed in [*recent_slice, *random_slice, *recent]:
        if len(selected) >= MAX_SEEDS:
            break
        if seed.recording_key in seen:
            continue
        selected.append(seed)
        seen.add(seed.recording_key)

    return selected


def active_feedback(
    db: Session,
    user_id: UUID,
) -> tuple[set[str], set[str]]:
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(RadioFeedback).where(
            RadioFeedback.user_id == user_id,
            RadioFeedback.verdict == RadioFeedbackVerdict.reject,
            or_(
                RadioFeedback.expires_at.is_(None),
                RadioFeedback.expires_at > now,
            ),
        )
    ).all()
    cutoff = now - timedelta(days=ARTIST_COOLDOWN_DAYS)
    artist_counts = Counter(
        normalize_text(row.artist)
        for row in rows
        if _as_utc(row.created_at) >= cutoff
    )
    blocked_artists = {
        artist
        for artist, count in artist_counts.items()
        if artist and count >= ARTIST_COOLDOWN_REJECTIONS
    }
    return {row.recording_key for row in rows}, blocked_artists


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def recent_listen_keys(db: Session, user_id: UUID) -> set[str]:
    rows = db.scalars(
        select(Listen.recording_key)
        .where(Listen.user_id == user_id)
        .order_by(Listen.started_at.desc())
        .limit(RECENT_EXCLUDE_LIMIT)
    ).all()
    return set(rows)


def local_track_index(db: Session) -> dict[str, Track]:
    tracks = db.scalars(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(Track.is_available.is_(True))
    ).all()
    index: dict[str, Track] = {}
    for track in tracks:
        key = track.recording_key or song_identity(
            track.artist.name, track.title
        )
        index.setdefault(key, track)
    return index


def _cached_similar(
    db: Session,
    client: LastfmClient,
    artist: str,
    title: str,
    limit: int,
) -> list[SimilarTrack]:
    key = (
        f"lastfm:similar:{normalize_text(artist)}:"
        f"{normalize_text(title)}:{limit}"
    )
    cached = cache_get(db, key)
    if cached is not None:
        return [SimilarTrack(**item) for item in cached]
    try:
        result = client.get_similar(artist, title, limit)
    except LastfmError:
        logger.warning("Last.fm similar lookup failed for %s - %s", artist, title)
        return []
    cache_set(db, key, [asdict(item) for item in result], CACHE_TTL_SECONDS)
    return result


def _cached_similar_artists(
    db: Session,
    client: LastfmClient,
    artist: str,
    limit: int,
) -> list[SimilarArtist]:
    key = f"lastfm:similarartists:{normalize_text(artist)}:{limit}"
    cached = cache_get(db, key)
    if cached is not None:
        return [SimilarArtist(**item) for item in cached]
    try:
        result = client.get_similar_artists(artist, limit)
    except LastfmError:
        logger.warning("Last.fm similar artist lookup failed for %s", artist)
        return []
    cache_set(db, key, [asdict(item) for item in result], CACHE_TTL_SECONDS)
    return result


def _cached_artist_top_tracks(
    db: Session,
    client: LastfmClient,
    artist: str,
    limit: int,
) -> list[SimilarTrack]:
    key = f"lastfm:artisttracks:{normalize_text(artist)}:{limit}"
    cached = cache_get(db, key)
    if cached is not None:
        return [SimilarTrack(**item) for item in cached]
    try:
        result = client.get_artist_top_tracks(artist, limit)
    except LastfmError:
        logger.warning("Last.fm artist top tracks lookup failed for %s", artist)
        return []
    cache_set(db, key, [asdict(item) for item in result], CACHE_TTL_SECONDS)
    return result


def _cached_info(
    db: Session,
    client: LastfmClient,
    artist: str,
    title: str,
) -> TrackInfo:
    key = f"lastfm:info:{normalize_text(artist)}:{normalize_text(title)}"
    cached = cache_get(db, key)
    if cached is not None:
        return TrackInfo(
            duration_seconds=cached.get("duration_seconds"),
            listeners=cached.get("listeners"),
            playcount=cached.get("playcount"),
            tags=tuple(cached.get("tags") or ()),
        )
    try:
        result = client.get_info(artist, title)
    except LastfmError:
        logger.warning("Last.fm track info lookup failed for %s - %s", artist, title)
        return TrackInfo(None, None, None, ())
    cache_set(db, key, asdict(result), CACHE_TTL_SECONDS)
    return result


def _cached_tag_top_tracks(
    db: Session,
    client: LastfmClient,
    tag: str,
    limit: int,
) -> list[SimilarTrack]:
    key = f"lastfm:tagtracks:{normalize_text(tag)}:{limit}"
    cached = cache_get(db, key)
    if cached is not None:
        return [SimilarTrack(**item) for item in cached]
    try:
        result = client.get_tag_top_tracks(tag, limit)
    except LastfmError:
        logger.warning("Last.fm tag top tracks lookup failed for %s", tag)
        return []
    cache_set(db, key, [asdict(item) for item in result], CACHE_TTL_SECONDS)
    return result


def _add_candidate(
    candidates: dict[str, RadioCandidate],
    seed: RadioSeed,
    similar: SimilarTrack,
    source: str,
    weight: float,
    local_index: dict[str, Track],
    reason: str | None = None,
) -> None:
    title = similar.title.strip()
    artist = similar.artist.strip()
    if not title or not artist:
        return
    key = song_identity(artist, title)
    if key == seed.recording_key:
        return
    entry = candidates.get(key)
    local_track = local_index.get(key)
    if entry is None:
        display_artist, display_title = (
            (local_track.artist.name, local_track.title)
            if local_track is not None
            else canonical_metadata(artist, title)
        )
        entry = RadioCandidate(
            title=display_title,
            artist=display_artist,
            recording_key=key,
            local_track=local_track,
            expected_duration_seconds=(
                local_track.duration_seconds
                if local_track is not None
                else None
            ),
            reason=reason or f"Because you played {seed.title}",
        )
        candidates[key] = entry

    if source == "similar":
        entry.best_match = max(entry.best_match, similar.match)
        entry.score += max(0.0, min(similar.match, 1.0)) * weight
    else:
        entry.score += weight
    entry.sources.add(source)
    entry.seed_count.add(seed.key)


def build_candidates(
    db: Session,
    client: LastfmClient,
    seeds: list[RadioSeed],
    profile: DiscoveryProfile,
    local_index: dict[str, Track],
) -> dict[str, RadioCandidate]:
    candidates: dict[str, RadioCandidate] = {}
    seed_keys = {seed.recording_key for seed in seeds}

    for seed in seeds:
        for similar in _cached_similar(
            db, client, seed.artist, seed.title, SIMILAR_LIMIT_MAX
        ):
            if seed_keys and song_identity(similar.artist, similar.title) in seed_keys:
                continue
            _add_candidate(
                candidates,
                seed,
                similar,
                "similar",
                1.0,
                local_index,
            )

    artist_seeds = seeds[:2]
    artist_queue: list[tuple[RadioSeed, SimilarArtist]] = []
    seen_artists: set[str] = set()
    for seed in artist_seeds:
        for artist in _cached_similar_artists(db, client, seed.artist, 4):
            artist_key = normalize_text(artist.name)
            if not artist_key or artist_key in seen_artists:
                continue
            seen_artists.add(artist_key)
            artist_queue.append((seed, artist))
            if len(artist_queue) >= 4:
                break
        if len(artist_queue) >= 4:
            break
    for seed, artist in artist_queue:
        for similar in _cached_artist_top_tracks(
            db, client, artist.name, 3
        ):
            _add_candidate(
                candidates,
                seed,
                similar,
                "artist",
                0.65,
                local_index,
                reason=f"Similar to {seed.title}",
            )

    tag_seeds = seeds[:2]
    tag_counts: Counter[str] = Counter()
    tag_owner: dict[str, RadioSeed] = {}
    for seed in tag_seeds:
        info = _cached_info(db, client, seed.artist, seed.title)
        for tag in info.tags[:5]:
            tag_counts[tag] += 1
            tag_owner.setdefault(tag, seed)
    for tag, _count in tag_counts.most_common(2):
        seed = tag_owner[tag]
        for similar in _cached_tag_top_tracks(db, client, tag, 15):
            _add_candidate(
                candidates,
                seed,
                similar,
                "tag",
                0.55,
                local_index,
                reason=f"Tag: {tag}",
            )

    return candidates


def filter_candidates(
    candidates: dict[str, RadioCandidate],
    seeds: list[RadioSeed],
    rejected_keys: set[str],
    blocked_artists: set[str],
    recent_keys: set[str],
    queue_keys: set[str],
    min_match: float,
) -> dict[str, RadioCandidate]:
    seed_keys = {seed.recording_key for seed in seeds}
    filtered: dict[str, RadioCandidate] = {}
    for key, candidate in candidates.items():
        if key in seed_keys:
            continue
        if key in rejected_keys or key in recent_keys or key in queue_keys:
            continue
        if normalize_text(candidate.artist) in blocked_artists:
            continue
        if (
            candidate.sources == {"similar"}
            and candidate.best_match < min_match
        ):
            continue
        filtered[key] = candidate
    return filtered


def rank_candidates(
    candidates: dict[str, RadioCandidate],
    profile: DiscoveryProfile,
    rng: random.Random | None = None,
) -> list[RadioCandidate]:
    rng = rng or random.Random()
    ranked = list(candidates.values())
    for candidate in ranked:
        candidate.rank_score = candidate.score * rng.uniform(
            1 - profile.jitter, 1 + profile.jitter
        )
    return sorted(
        ranked,
        key=lambda candidate: (
            -candidate.rank_score,
            -len(candidate.seed_count),
            normalize_text(candidate.title),
            normalize_text(candidate.artist),
        ),
    )


def select_batch(
    ranked: list[RadioCandidate],
    limit: int,
    profile: DiscoveryProfile,
) -> list[RadioCandidate]:
    selected: list[RadioCandidate] = []
    selected_keys: set[str] = set()
    artist_counts: Counter[str] = Counter()
    last_artist: str | None = None
    artist_cap = (
        RELAXED_ARTIST_CAP
        if len(ranked) < limit
        else ARTIST_BATCH_CAP
    )

    def take(predicate, count: int) -> None:
        nonlocal last_artist
        added = 0
        for candidate in ranked:
            if len(selected) >= limit or added >= count:
                break
            if candidate.recording_key in selected_keys:
                continue
            if not predicate(candidate):
                continue
            artist_key = normalize_text(candidate.artist)
            if artist_counts[artist_key] >= artist_cap:
                continue
            if last_artist == artist_key:
                continue
            selected.append(candidate)
            selected_keys.add(candidate.recording_key)
            artist_counts[artist_key] += 1
            last_artist = artist_key
            added += 1

    take(lambda c: "similar" in c.sources, profile.similar_quota)
    take(lambda c: "artist" in c.sources, profile.artist_quota)
    take(lambda c: "tag" in c.sources, profile.tag_quota)
    take(lambda c: True, limit - len(selected))

    if len(selected) < limit:
        for candidate in ranked:
            if len(selected) >= limit:
                break
            if candidate.recording_key in selected_keys:
                continue
            artist_key = normalize_text(candidate.artist)
            if artist_counts[artist_key] >= artist_cap:
                continue
            selected.append(candidate)
            selected_keys.add(candidate.recording_key)
            artist_counts[artist_key] += 1

    return selected


def enrich_expected_duration(
    db: Session,
    client: LastfmClient,
    candidates: list[RadioCandidate],
) -> None:
    for candidate in candidates:
        if candidate.expected_duration_seconds is not None:
            continue
        info = _cached_info(
            db, client, candidate.artist, candidate.title
        )
        candidate.expected_duration_seconds = info.duration_seconds


def build_radio_batch(
    db: Session,
    client: LastfmClient,
    user_id: UUID,
    session: RadioSession,
    *,
    limit: int = DEFAULT_BATCH_LIMIT,
    exclude: list[str] | None = None,
    rng: random.Random | None = None,
) -> tuple[list[RadioCandidate], int]:
    level = DiscoveryLevel(session.discovery_level)
    profile = PROFILES[level]
    seeds = select_seeds(db, user_id, session, profile, rng=rng)
    if not seeds:
        return [], 0

    rejected_keys, blocked_artists = active_feedback(db, user_id)
    recent_keys = recent_listen_keys(db, user_id)
    queue_keys = {key for key in (exclude or []) if key}
    local_index = local_track_index(db)

    candidates = build_candidates(db, client, seeds, profile, local_index)
    filtered = filter_candidates(
        candidates,
        seeds,
        rejected_keys,
        blocked_artists,
        recent_keys,
        queue_keys,
        profile.min_match,
    )
    ranked = rank_candidates(filtered, profile, rng=rng)
    selected = select_batch(ranked, limit, profile)
    enrich_expected_duration(db, client, selected)
    return selected, len(seeds)


def set_feedback(
    db: Session,
    user_id: UUID,
    *,
    recording_key: str,
    artist: str,
    title: str,
    verdict: str,
    reason: str | None = None,
    track_id: UUID | None = None,
) -> RadioFeedback | None:
    if verdict == "clear":
        existing = db.scalar(
            select(RadioFeedback).where(
                RadioFeedback.user_id == user_id,
                RadioFeedback.recording_key == recording_key,
            )
        )
        if existing is not None:
            db.delete(existing)
            db.commit()
        return None

    now = datetime.now(timezone.utc)
    if verdict == "like":
        expires_at = None
    elif reason == "never":
        expires_at = None
    elif reason == "not_now":
        expires_at = now + timedelta(days=NOT_NOW_TTL_DAYS)
    elif reason == "failed":
        expires_at = now + timedelta(days=FAILED_TTL_DAYS)
    else:
        expires_at = now + timedelta(days=REJECTION_TTL_DAYS)

    entry = db.scalar(
        select(RadioFeedback).where(
            RadioFeedback.user_id == user_id,
            RadioFeedback.recording_key == recording_key,
        )
    )
    if entry is None:
        entry = RadioFeedback(
            user_id=user_id,
            recording_key=recording_key,
            artist=artist,
            title=title,
            verdict=RadioFeedbackVerdict(verdict),
            reason=reason,
            track_id=track_id,
            expires_at=expires_at,
        )
        db.add(entry)
    else:
        entry.artist = artist
        entry.title = title
        entry.verdict = RadioFeedbackVerdict(verdict)
        entry.reason = reason
        entry.track_id = track_id
        entry.expires_at = expires_at
        entry.created_at = now
    db.commit()
    db.refresh(entry)

    _trim_feedback(db, user_id)
    return entry


def _trim_feedback(db: Session, user_id: UUID) -> None:
    stale = db.scalars(
        select(RadioFeedback)
        .where(
            RadioFeedback.user_id == user_id,
            RadioFeedback.verdict == RadioFeedbackVerdict.reject,
        )
        .order_by(RadioFeedback.created_at.desc())
        .offset(100)
    ).all()
    if not stale:
        return
    for row in stale:
        db.delete(row)
    db.commit()


def record_listen(
    db: Session,
    user_id: UUID,
    *,
    track: Track,
    played_seconds: int,
    duration_seconds: int,
    skipped: bool,
    source: str,
    started_at: datetime | None = None,
) -> Listen:
    duration = max(1, track.duration_seconds)
    played = max(0, min(played_seconds, duration))
    completion = min(1.0, played / duration) if duration else 0.0
    now = datetime.now(timezone.utc)
    listen = Listen(
        user_id=user_id,
        track_id=track.id,
        recording_key=track.recording_key
        or song_identity(track.artist.name, track.title),
        title=track.canonical_title or track.title,
        artist=track.artist.name,
        started_at=started_at or now,
        ended_at=now,
        played_seconds=played,
        duration_seconds=duration,
        completion_ratio=completion,
        skipped=skipped,
        source=source,
    )
    db.add(listen)
    if completion >= SEED_COMPLETION_MIN:
        existing = db.scalar(
            select(RadioFeedback).where(
                RadioFeedback.user_id == user_id,
                RadioFeedback.recording_key == listen.recording_key,
                RadioFeedback.verdict == RadioFeedbackVerdict.reject,
                or_(
                    RadioFeedback.reason.is_(None),
                    RadioFeedback.reason.not_in(("not_now", "never")),
                ),
            )
        )
        if existing is not None:
            db.delete(existing)
    db.commit()
    db.refresh(listen)
    return listen
