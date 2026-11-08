from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from .models import Track
from .text import normalize_text

TRAILING_BRACKETS = re.compile(r"\s*[\(\[][^)\]]*[\)\]]\s*$")
SIMILAR_LIMIT = 20
RESULT_LIMIT = 20


class LastfmError(Exception):
    pass


@dataclass(frozen=True)
class SimilarTrack:
    title: str
    artist: str
    match: float


@dataclass(frozen=True)
class Recommendation:
    track: Track
    score: float
    seed_count: int


class LastfmClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://ws.audioscrobbler.com/2.0/",
        timeout: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={"User-Agent": "Soundroom/0.1"},
        )
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> LastfmClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def get_similar(
        self,
        artist: str,
        title: str,
        limit: int = SIMILAR_LIMIT,
    ) -> list[SimilarTrack]:
        params = {
            "method": "track.getsimilar",
            "artist": artist,
            "track": title,
            "api_key": self.api_key,
            "format": "json",
            "limit": max(1, min(limit, SIMILAR_LIMIT)),
            "autocorrect": 1,
        }
        try:
            response = self._client.get(self.base_url, params=params)
        except httpx.HTTPError as exc:
            raise LastfmError("Last.fm is unavailable.") from exc

        if response.status_code >= 400:
            raise LastfmError("Last.fm returned an error.")

        try:
            payload = response.json()
        except ValueError as exc:
            raise LastfmError("Last.fm returned invalid data.") from exc

        if isinstance(payload, dict) and payload.get("error"):
            message = payload.get("message") or "Last.fm returned an error."
            raise LastfmError(str(message))

        container = (
            payload.get("similartracks", {})
            if isinstance(payload, dict)
            else {}
        )
        raw_tracks = container.get("track", []) if isinstance(container, dict) else []
        if isinstance(raw_tracks, dict):
            raw_tracks = [raw_tracks]

        results: list[SimilarTrack] = []
        for item in raw_tracks[:limit]:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            artist_data = item.get("artist")
            artist_name = (
                artist_data.get("name")
                if isinstance(artist_data, dict)
                else artist_data
            )
            if not isinstance(name, str) or not isinstance(artist_name, str):
                continue
            if not name.strip() or not artist_name.strip():
                continue
            try:
                match = float(item.get("match") or 0)
            except (TypeError, ValueError):
                match = 0.0
            results.append(
                SimilarTrack(
                    title=name.strip(),
                    artist=artist_name.strip(),
                    match=max(0.0, min(match, 1.0)),
                )
            )
        return results


def _compact(value: str) -> str:
    return normalize_text(value).replace(" ", "")


def _strip_trailing_brackets(value: str) -> str:
    previous = None
    result = value.strip()
    while previous != result:
        previous = result
        result = TRAILING_BRACKETS.sub("", result).strip()
    return result


def lastfm_seed_metadata(track: Track) -> tuple[str, str]:
    artist = track.artist.name.strip()
    title = _strip_trailing_brackets(track.title)

    if " - " in title:
        prefix, suffix = title.split(" - ", 1)
        prefix = prefix.strip()
        suffix = _strip_trailing_brackets(suffix)
        prefix_compact = _compact(prefix)
        artist_compact = _compact(artist)
        if (
            prefix
            and suffix
            and prefix_compact
            and artist_compact
            and (
                prefix_compact in artist_compact
                or artist_compact in prefix_compact
            )
        ):
            return prefix, suffix

    return artist, title or track.title


def _match_quality(similar: SimilarTrack, track: Track) -> float:
    candidate_title = normalize_text(similar.title)
    local_title = normalize_text(track.title)
    candidate_artist = normalize_text(similar.artist)
    local_artist = normalize_text(track.artist.name)
    if not candidate_title or not candidate_artist:
        return 0.0

    candidate_title_compact = candidate_title.replace(" ", "")
    local_title_compact = local_title.replace(" ", "")
    candidate_artist_compact = candidate_artist.replace(" ", "")
    local_artist_compact = local_artist.replace(" ", "")
    combined_compact = local_title_compact + local_artist_compact

    title_matches = (
        candidate_title == local_title
        or candidate_title in local_title
        or candidate_title_compact in local_title_compact
    )
    artist_matches = (
        candidate_artist == local_artist
        or candidate_artist in local_artist
        or local_artist in candidate_artist
        or (
            len(candidate_artist_compact) >= 3
            and candidate_artist_compact in combined_compact
        )
    )
    if not title_matches or not artist_matches:
        return 0.0

    quality = 0.0
    quality += 2.0 if candidate_title == local_title else 1.0
    quality += 2.0 if candidate_artist == local_artist else 1.0
    return quality


def match_local_track(
    similar: SimilarTrack,
    local_tracks: list[Track],
) -> Track | None:
    best_track: Track | None = None
    best_quality = 0.0
    for track in local_tracks:
        quality = _match_quality(similar, track)
        if quality > best_quality or (
            quality == best_quality
            and quality > 0
            and best_track is not None
            and (len(track.title), str(track.id))
            < (len(best_track.title), str(best_track.id))
        ):
            best_track = track
            best_quality = quality
    return best_track


def build_recommendations(
    seed_tracks: list[Track],
    similar_by_seed: list[tuple[Track, list[SimilarTrack]]],
    local_tracks: list[Track],
) -> list[Recommendation]:
    seed_ids = {track.id for track in seed_tracks}
    seed_keys = {
        (normalize_text(track.title), normalize_text(track.artist.name))
        for track in seed_tracks
    }
    scores: dict[object, float] = {}
    seed_counts: dict[object, set[object]] = {}
    tracks_by_id: dict[object, Track] = {}

    for seed, similar_tracks in similar_by_seed:
        matched: dict[object, float] = {}
        for similar in similar_tracks:
            local_track = match_local_track(similar, local_tracks)
            if local_track is None or local_track.id in seed_ids:
                continue
            if (
                normalize_text(local_track.title),
                normalize_text(local_track.artist.name),
            ) in seed_keys:
                continue
            matched[local_track.id] = max(
                matched.get(local_track.id, 0.0),
                similar.match,
            )
            tracks_by_id[local_track.id] = local_track

        for track_id, match in matched.items():
            scores[track_id] = scores.get(track_id, 0.0) + match
            seed_counts.setdefault(track_id, set()).add(seed.id)

    ranked = sorted(
        tracks_by_id.values(),
        key=lambda track: (
            -scores[track.id],
            -len(seed_counts[track.id]),
            normalize_text(track.title),
            str(track.id),
        ),
    )
    return [
        Recommendation(
            track=track,
            score=round(scores[track.id], 4),
            seed_count=len(seed_counts[track.id]),
        )
        for track in ranked[:RESULT_LIMIT]
    ]
