from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from .models import Track
from .text import normalize_text

TRAILING_BRACKETS = re.compile(r"\s*[\(\[][^)\]]*[\)\]]\s*$")
VERSION_MARKERS = (
    "live",
    "concert",
    "performance",
    "unplugged",
    "remix",
    "edit",
    "cover",
    "karaoke",
    "instrumental",
    "acoustic",
    "demo",
    "extended",
    "nightcore",
    "slowed",
    "sped up",
    "reverb",
    "session",
    "bbc",
)
SIMILAR_LIMIT = 20
RESULT_LIMIT = 20
MAX_RECOMMENDATION_HISTORY = 10


class LastfmError(Exception):
    pass


@dataclass(frozen=True)
class SimilarTrack:
    title: str
    artist: str
    match: float


@dataclass(frozen=True)
class SimilarArtist:
    name: str
    match: float


@dataclass(frozen=True)
class SeedReference:
    title: str
    artist: str
    track_id: object | None = None

    @property
    def key(self) -> str:
        if self.track_id is not None:
            return f"local:{self.track_id}"
        return f"external:{normalize_text(self.title)}|{normalize_text(self.artist)}"


@dataclass(frozen=True)
class Recommendation:
    title: str
    artist: str
    score: float
    seed_count: int
    local_track: Track | None


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

    def _request(self, method: str, params: dict) -> dict:
        query = {
            "method": method,
            "api_key": self.api_key,
            "format": "json",
            **params,
        }
        try:
            response = self._client.get(self.base_url, params=query)
        except httpx.HTTPError as exc:
            raise LastfmError("Last.fm is unavailable.") from exc

        if response.status_code >= 400:
            raise LastfmError("Last.fm returned an error.")

        try:
            payload = response.json()
        except ValueError as exc:
            raise LastfmError("Last.fm returned invalid data.") from exc

        if not isinstance(payload, dict):
            raise LastfmError("Last.fm returned invalid data.")
        if payload.get("error"):
            message = payload.get("message") or "Last.fm returned an error."
            raise LastfmError(str(message))
        return payload

    def get_similar(
        self,
        artist: str,
        title: str,
        limit: int = SIMILAR_LIMIT,
    ) -> list[SimilarTrack]:
        payload = self._request(
            "track.getsimilar",
            {
                "artist": artist,
                "track": title,
                "limit": max(1, min(limit, SIMILAR_LIMIT)),
                "autocorrect": 1,
            },
        )

        container = (
            payload.get("similartracks", {})
            if isinstance(payload, dict)
            else {}
        )
        raw_tracks = (
            container.get("track", [])
            if isinstance(container, dict)
            else []
        )
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


    def get_similar_artists(
        self,
        artist: str,
        limit: int = 5,
    ) -> list[SimilarArtist]:
        payload = self._request(
            "artist.getsimilar",
            {
                "artist": artist,
                "limit": max(1, min(limit, 20)),
                "autocorrect": 1,
            },
        )
        container = payload.get("similarartists", {})
        raw_artists = (
            container.get("artist", [])
            if isinstance(container, dict)
            else []
        )
        if isinstance(raw_artists, dict):
            raw_artists = [raw_artists]

        results: list[SimilarArtist] = []
        for item in raw_artists[:limit]:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if not isinstance(name, str) or not name.strip():
                continue
            try:
                match = float(item.get("match") or 0)
            except (TypeError, ValueError):
                match = 0.0
            results.append(
                SimilarArtist(
                    name=name.strip(),
                    match=max(0.0, min(match, 1.0)),
                )
            )
        return results

    def get_artist_top_tracks(
        self,
        artist: str,
        limit: int = 5,
    ) -> list[SimilarTrack]:
        payload = self._request(
            "artist.gettoptracks",
            {
                "artist": artist,
                "limit": max(1, min(limit, 20)),
                "autocorrect": 1,
            },
        )
        container = payload.get("toptracks", {})
        raw_tracks = (
            container.get("track", [])
            if isinstance(container, dict)
            else []
        )
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
            ) or artist
            if not isinstance(name, str) or not name.strip():
                continue
            if not isinstance(artist_name, str) or not artist_name.strip():
                continue
            results.append(
                SimilarTrack(
                    title=name.strip(),
                    artist=artist_name.strip(),
                    match=1.0,
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


def _version_markers(title: str) -> frozenset[str]:
    normalized = normalize_text(title)
    return frozenset(
        marker
        for marker in VERSION_MARKERS
        if re.search(rf"\b{re.escape(marker)}\b", normalized)
    )


def clean_seed_metadata(artist: str, title: str) -> tuple[str, str]:
    artist = artist.strip()
    title = _strip_trailing_brackets(title)

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

    return artist, title or title.strip()


def lastfm_seed_metadata(track: Track) -> tuple[str, str]:
    return clean_seed_metadata(track.artist.name, track.title)


def _match_quality(similar: SimilarTrack, track: Track) -> float:
    similar_artist, similar_title = clean_seed_metadata(
        similar.artist, similar.title
    )
    local_artist, local_title = clean_seed_metadata(
        track.artist.name, track.title
    )
    if not similar_title or not similar_artist:
        return 0.0
    if (
        normalize_text(similar_artist) != normalize_text(local_artist)
        or normalize_text(similar_title) != normalize_text(local_title)
    ):
        return 0.0
    if _version_markers(similar.title) != _version_markers(track.title):
        return 0.0
    return 1.0


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
    seed_refs: list[SeedReference],
    similar_by_seed: list[tuple[SeedReference, list[SimilarTrack]]],
    local_tracks: list[Track],
    limit: int = RESULT_LIMIT,
) -> list[Recommendation]:
    seed_ids = {
        seed.track_id for seed in seed_refs if seed.track_id is not None
    }
    seed_keys = {
        (normalize_text(seed.title), normalize_text(seed.artist))
        for seed in seed_refs
    }
    scores: dict[str, float] = {}
    seed_counts: dict[str, set[str]] = {}
    entries: dict[str, tuple[str, str, Track | None]] = {}

    for seed, similar_tracks in similar_by_seed:
        matched: dict[str, float] = {}
        for similar in similar_tracks:
            local_track = match_local_track(similar, local_tracks)
            candidate_key = (
                normalize_text(similar.title),
                normalize_text(similar.artist),
            )
            if candidate_key in seed_keys:
                continue
            if local_track is not None and local_track.id in seed_ids:
                continue
            if local_track is not None and (
                normalize_text(local_track.title),
                normalize_text(local_track.artist.name),
            ) in seed_keys:
                continue

            if local_track is not None:
                key = f"local:{local_track.id}"
                title = local_track.title
                artist = local_track.artist.name
            else:
                key = f"external:{candidate_key[0]}|{candidate_key[1]}"
                title = similar.title
                artist = similar.artist

            matched[key] = max(matched.get(key, 0.0), similar.match)
            entries[key] = (title, artist, local_track)

        for key, match in matched.items():
            scores[key] = scores.get(key, 0.0) + match
            seed_counts.setdefault(key, set()).add(seed.key)

    ranked = sorted(
        entries,
        key=lambda key: (
            -scores[key],
            -len(seed_counts[key]),
            normalize_text(entries[key][0]),
            normalize_text(entries[key][1]),
            key,
        ),
    )
    return [
        Recommendation(
            title=entries[key][0],
            artist=entries[key][1],
            score=round(scores[key], 4),
            seed_count=len(seed_counts[key]),
            local_track=entries[key][2],
        )
        for key in ranked[:limit]
    ]
