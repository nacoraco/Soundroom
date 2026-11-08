from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.models import Artist, RipJob, Track, TrackSource
from app.recommendations import (
    LastfmClient,
    LastfmError,
    SeedReference,
    SimilarArtist,
    SimilarTrack,
    build_recommendations,
    clean_seed_metadata,
    lastfm_seed_metadata,
    match_local_track,
)
from app.routers.discover import get_lastfm_client
from app.text import normalize_text

from .utils import auth_headers, login


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def seed_track(
    db_session,
    title: str,
    artist_name: str,
    *,
    duration_seconds: int = 180,
) -> Track:
    normalized_artist = normalize_text(artist_name)
    artist = db_session.scalar(
        select(Artist).where(Artist.normalized_name == normalized_artist)
    )
    if artist is None:
        artist = Artist(
            id=uuid4(),
            name=artist_name,
            normalized_name=normalized_artist,
        )
        db_session.add(artist)
        db_session.flush()
    track = Track(
        id=uuid4(),
        artist_id=artist.id,
        title=title,
        normalized_title=normalize_text(title),
        duration_seconds=duration_seconds,
        file_path=f"tracks/{uuid4()}.mp3",
        mime_type="audio/mpeg",
        source_type=TrackSource.upload,
        audio_sha256=(uuid4().hex + uuid4().hex),
        is_available=True,
    )
    db_session.add(track)
    db_session.commit()
    return track


class FakeLastfm:
    def __init__(self, responses, similar_artists=None, top_tracks=None):
        self.responses = responses
        self.similar_artists = similar_artists or {}
        self.top_tracks = top_tracks or {}
        self.calls = []

    def get_similar(self, artist: str, title: str, limit: int = 20):
        self.calls.append((artist, title, limit))
        return self.responses.get((artist, title), [])

    def get_similar_artists(self, artist: str, limit: int = 5):
        self.calls.append(("artists", artist, limit))
        return self.similar_artists.get(artist, [])

    def get_artist_top_tracks(self, artist: str, limit: int = 5):
        self.calls.append(("tracks", artist, limit))
        return self.top_tracks.get(artist, [])


def override_lastfm(client: TestClient, fake: FakeLastfm):
    client.app.dependency_overrides[get_lastfm_client] = lambda: fake


def clear_override(client: TestClient):
    client.app.dependency_overrides.pop(get_lastfm_client, None)


def test_lastfm_client_parses_similar_tracks_without_network():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["params"] = dict(request.url.params)
        return httpx.Response(
            200,
            json={
                "similartracks": {
                    "track": [
                        {
                            "name": "Losing My Religion",
                            "match": "0.92",
                            "artist": {"name": "R.E.M."},
                        },
                        {
                            "name": "Creep",
                            "match": "0.71",
                            "artist": {"name": "Radiohead"},
                        },
                    ]
                }
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    lastfm = LastfmClient("test-key", client=http_client)
    try:
        similar = lastfm.get_similar("R.E.M.", "Losing My Religion")
    finally:
        http_client.close()

    assert seen["params"]["method"] == "track.getsimilar"
    assert seen["params"]["api_key"] == "test-key"
    assert [item.title for item in similar] == ["Losing My Religion", "Creep"]
    assert similar[0].match == 0.92


def test_lastfm_client_surfaces_api_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"error": 6, "message": "Track not found"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    lastfm = LastfmClient("test-key", client=http_client)
    try:
        with pytest.raises(LastfmError):
            lastfm.get_similar("Nope", "Nope")
    finally:
        http_client.close()


def test_seed_metadata_cleans_common_import_suffixes():
    assert clean_seed_metadata("Artist One", "Artist One - Seed One (Official Video)") == (
        "Artist One",
        "Seed One",
    )
    assert clean_seed_metadata("remhq", "R.E.M. - Losing My Religion (Official HD Music Video)") == (
        "R.E.M.",
        "Losing My Religion",
    )
    assert clean_seed_metadata("Someone", "Song - Part 2") == (
        "Someone",
        "Song - Part 2",
    )


def test_local_matching_handles_import_suffixes_and_artists():
    tracks = [
        Track(
            id=uuid4(),
            title="R.E.M. - Losing My Religion (Official HD Music Video)",
            artist=Artist(name="remhq", normalized_name="remhq"),
        ),
        Track(
            id=uuid4(),
            title="Louis Armstrong - What A Wonderful World (Lyrics)",
            artist=Artist(name="Louis Armstrong", normalized_name="louis armstrong"),
        ),
    ]

    losing = match_local_track(SimilarTrack("Losing My Religion", "R.E.M.", 0.9), tracks)
    wonderful = match_local_track(
        SimilarTrack("What a Wonderful World", "Louis Armstrong", 0.8), tracks
    )
    missing = match_local_track(SimilarTrack("Creep", "Radiohead", 0.7), tracks)

    assert losing is tracks[0]
    assert wonderful is tracks[1]
    assert missing is None


def make_memory_track(title: str, artist_name: str = "Artist") -> Track:
    return Track(
        id=uuid4(),
        title=title,
        artist=Artist(name=artist_name, normalized_name=normalize_text(artist_name)),
    )


def test_build_recommendations_merges_ranks_excludes_and_limits():
    first = make_memory_track("Candidate A (Official Video)", "Artist A")
    second = make_memory_track("Candidate B", "Artist B")
    third = make_memory_track("Candidate C", "Artist C")
    seed_one = make_memory_track("Seed One", "Seed Artist One")
    seed_two = make_memory_track("Seed Two", "Seed Artist Two")
    excluded = make_memory_track("Seed Two", "Seed Artist Two")
    extra = [make_memory_track(f"Extra {index}") for index in range(25)]

    seed_ref_one = SeedReference("Seed One", "Seed Artist One", seed_one.id)
    seed_ref_two = SeedReference("Seed Two", "Seed Artist Two", seed_two.id)
    similar_one = [
        SimilarTrack("Candidate A", "Artist A", 0.9),
        SimilarTrack("Candidate A", "Artist A", 0.4),
        SimilarTrack("Candidate B", "Artist B", 0.4),
        SimilarTrack("Seed Two", "Seed Artist Two", 0.99),
        SimilarTrack("External Song", "External Artist", 0.7),
        *[
            SimilarTrack(track.title, track.artist.name, 0.5)
            for track in extra
        ],
    ]
    similar_two = [
        SimilarTrack("Candidate A", "Artist A", 0.3),
        SimilarTrack("Candidate B", "Artist B", 0.6),
        SimilarTrack("Candidate C", "Artist C", 0.8),
    ]

    result = build_recommendations(
        [seed_ref_one, seed_ref_two],
        [(seed_ref_one, similar_one), (seed_ref_two, similar_two)],
        [first, second, third, seed_one, seed_two, excluded, *extra],
    )

    assert [recommendation.title for recommendation in result[:3]] == [
        "Candidate A (Official Video)",
        "Candidate B",
        "Candidate C",
    ]
    assert result[0].score == 1.2
    assert result[0].seed_count == 2
    assert result[1].score == 1.0
    assert result[1].seed_count == 2
    assert result[2].score == 0.8
    assert result[2].seed_count == 1
    assert all(
        recommendation.title not in {"Seed One", "Seed Two"}
        for recommendation in result
    )
    assert any(
        recommendation.title == "External Song"
        and recommendation.local_track is None
        for recommendation in result
    )
    assert len(result) == 20


def test_discover_endpoint_returns_local_and_external_recommendations(
    client: TestClient, db_session
):
    headers = admin_headers(client)
    seed_one = seed_track(db_session, "Seed Artist One - Seed One", "Seed Artist One")
    seed_two = seed_track(db_session, "Seed Artist Two - Seed Two", "Seed Artist Two")
    first = seed_track(db_session, "Candidate A (Official Video)", "Artist A")
    second = seed_track(db_session, "Candidate B", "Artist B")
    third = seed_track(db_session, "Candidate C", "Artist C")
    fake = FakeLastfm(
        {
            ("Seed Artist One", "Seed One"): [
                SimilarTrack("Candidate A", "Artist A", 0.9),
                SimilarTrack("Candidate B", "Artist B", 0.4),
                SimilarTrack("Seed Two", "Seed Artist Two", 0.99),
                SimilarTrack("Not local", "Nobody", 0.8),
            ],
            ("Seed Artist Two", "Seed Two"): [
                SimilarTrack("Candidate A", "Artist A", 0.3),
                SimilarTrack("Candidate B", "Artist B", 0.6),
                SimilarTrack("Candidate C", "Artist C", 0.8),
            ],
        }
    )
    override_lastfm(client, fake)
    try:
        response = client.post(
            "/api/discover/similar",
            json={"seed_track_ids": [str(seed_one.id), str(seed_two.id)]},
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 200
    body = response.json()
    assert body["seeds"] == [str(seed_one.id), str(seed_two.id)]
    assert [item["title"] for item in body["recommendations"]] == [
        "Candidate A (Official Video)",
        "Candidate B",
        "Candidate C",
        "Not local",
    ]
    assert [item["local_track"]["id"] for item in body["recommendations"][:3]] == [
        str(first.id),
        str(second.id),
        str(third.id),
    ]
    assert body["recommendations"][3]["local_track"] is None
    assert body["recommendations"][0]["score"] == 1.2
    assert body["recommendations"][0]["seed_count"] == 2
    assert db_session.scalar(select(func.count(RipJob.id))) == 0


def test_radio_endpoint_uses_metadata_seeds_and_returns_five(client: TestClient, db_session):
    headers = admin_headers(client)
    local = seed_track(db_session, "Local Result", "Local Artist")
    fake = FakeLastfm(
        {
            ("Seed Artist", "Seed Song"): [
                SimilarTrack("Local Result", "Local Artist", 0.9),
                SimilarTrack("External One", "External Artist", 0.8),
                SimilarTrack("External Two", "External Artist", 0.7),
            ]
        }
    )
    override_lastfm(client, fake)
    try:
        response = client.post(
            "/api/discover/radio",
            json={
                "seeds": [
                    {"title": "Seed Artist - Seed Song (Official Video)", "artist": "Seed Artist"}
                ]
            },
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 200
    recommendations = response.json()["recommendations"]
    assert [item["title"] for item in recommendations[:3]] == [
        "Local Result",
        "External One",
        "External Two",
    ]
    assert recommendations[0]["local_track"]["id"] == str(local.id)
    assert recommendations[1]["local_track"] is None
    assert fake.calls == [("Seed Artist", "Seed Song", 20)]


def test_radio_rejects_more_than_five_seeds(client: TestClient):
    headers = admin_headers(client)
    override_lastfm(client, FakeLastfm({}))
    try:
        response = client.post(
            "/api/discover/radio",
            json={
                "seeds": [
                    {"title": f"Song {index}", "artist": f"Artist {index}"}
                    for index in range(6)
                ]
            },
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 422


def test_discover_falls_back_to_similar_artists_when_track_has_no_similarity(
    client: TestClient, db_session
):
    headers = admin_headers(client)
    seed = seed_track(
        db_session,
        "S.A.R.S. - Veruj mi (Official video)",
        "S.A.R.S.",
    )
    fake = FakeLastfm(
        {},
        similar_artists={"S.A.R.S.": [SimilarArtist("Dubioza Kolektiv", 1.0)]},
        top_tracks={
            "Dubioza Kolektiv": [
                SimilarTrack("Perspektiva", "Dubioza Kolektiv", 1.0),
                SimilarTrack("Buđav Lebac", "Dubioza Kolektiv", 1.0),
            ]
        },
    )
    override_lastfm(client, fake)
    try:
        response = client.post(
            "/api/discover/similar",
            json={"seed_track_ids": [str(seed.id)]},
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 200
    recommendations = response.json()["recommendations"]
    assert [item["title"] for item in recommendations] == [
        "Perspektiva",
        "Buđav Lebac",
    ]
    assert all(item["local_track"] is None for item in recommendations)
    assert recommendations[0]["score"] == 1.0

def test_discover_rejects_fourth_seed(client: TestClient, db_session):
    headers = admin_headers(client)
    tracks = [
        seed_track(db_session, f"Seed {index}", f"Artist {index}")
        for index in range(4)
    ]
    override_lastfm(client, FakeLastfm({}))
    try:
        response = client.post(
            "/api/discover/similar",
            json={"seed_track_ids": [str(track.id) for track in tracks]},
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 422


def test_discover_rejects_missing_seed(client: TestClient):
    headers = admin_headers(client)
    override_lastfm(client, FakeLastfm({}))
    try:
        response = client.post(
            "/api/discover/similar",
            json={"seed_track_ids": [str(uuid4())]},
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 404


def test_discover_lastfm_failure_is_isolated(client: TestClient, db_session):
    headers = admin_headers(client)
    seed = seed_track(db_session, "Seed", "Artist")

    class FailingLastfm:
        def get_similar(self, artist: str, title: str, limit: int = 20):
            raise LastfmError("down")

    override_lastfm(client, FailingLastfm())
    try:
        response = client.post(
            "/api/discover/similar",
            json={"seed_track_ids": [str(seed.id)]},
            headers=headers,
        )
    finally:
        clear_override(client)

    assert response.status_code == 503
    assert client.get("/api/tracks").status_code == 200
    assert db_session.scalar(select(func.count(RipJob.id))) == 0


def test_discover_requires_configured_key(client: TestClient, monkeypatch):
    headers = admin_headers(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "lastfm_api_key", "")
    client.app.dependency_overrides.pop(get_lastfm_client, None)

    response = client.post(
        "/api/discover/similar",
        json={"seed_track_ids": [str(uuid4())]},
        headers=headers,
    )

    assert response.status_code == 503
