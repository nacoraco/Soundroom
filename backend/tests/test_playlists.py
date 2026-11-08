from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Artist, PlaylistItem, Track, TrackSource
from app.text import normalize_text

from .utils import auth_headers, login


def admin_headers(client: TestClient) -> dict[str, str]:
    response = login(client)
    assert response.status_code == 200
    return auth_headers(response.json()["csrf_token"])


def create_listener(client: TestClient, admin: dict[str, str]) -> tuple[TestClient, dict[str, str]]:
    response = client.post(
        "/api/admin/users",
        json={
            "email": "listener@example.com",
            "display_name": "Listener",
            "password": "listener-password",
            "role": "listener",
        },
        headers=admin,
    )
    assert response.status_code == 201
    listener = TestClient(client.app)
    login_response = login(
        listener,
        email="listener@example.com",
        password="listener-password",
    )
    assert login_response.status_code == 200
    return listener, auth_headers(login_response.json()["csrf_token"])


def seed_track(
    db_session,
    title: str,
    *,
    artist_name: str = "Test Artist",
    duration_seconds: int = 180,
    is_available: bool = True,
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
        is_available=is_available,
    )
    db_session.add(track)
    db_session.commit()
    return track


def create_playlist(client: TestClient, headers: dict[str, str], name: str):
    response = client.post(
        "/api/playlists",
        json={"name": name},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def add_track(
    client: TestClient,
    headers: dict[str, str],
    playlist_id: str,
    track_id: str,
):
    return client.post(
        f"/api/playlists/{playlist_id}/items",
        json={"track_id": track_id},
        headers=headers,
    )


def test_playlists_require_authentication(client: TestClient):
    assert client.get("/api/playlists").status_code == 401
    assert client.post("/api/playlists", json={"name": "Private"}).status_code == 401


def test_create_and_list_own_playlist(client: TestClient):
    headers = admin_headers(client)

    created = client.post(
        "/api/playlists",
        json={"name": "  Late night  "},
        headers=headers,
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["name"] == "Late night"
    assert payload["items"] == []

    listing = client.get("/api/playlists")

    assert listing.status_code == 200
    assert listing.json() == [
        {
            "id": payload["id"],
            "name": "Late night",
            "item_count": 0,
            "total_duration_seconds": 0,
            "created_at": payload["created_at"],
            "updated_at": payload["updated_at"],
        }
    ]


def test_other_users_cannot_see_or_change_playlist(client: TestClient, db_session):
    admin = admin_headers(client)
    playlist = create_playlist(client, admin, "Admin only")
    track = seed_track(db_session, "Private track")
    listener, listener_headers = create_listener(client, admin)

    try:
        assert listener.get("/api/playlists").json() == []
        assert listener.get(f"/api/playlists/{playlist['id']}").status_code == 404
        assert (
            listener.patch(
                f"/api/playlists/{playlist['id']}",
                json={"name": "Taken"},
                headers=listener_headers,
            ).status_code
            == 404
        )
        assert (
            listener.post(
                f"/api/playlists/{playlist['id']}/items",
                json={"track_id": str(track.id)},
                headers=listener_headers,
            ).status_code
            == 404
        )
        assert (
            listener.delete(
                f"/api/playlists/{playlist['id']}",
                headers=listener_headers,
            ).status_code
            == 404
        )
    finally:
        listener.close()


def test_add_items_positions_duplicates_and_summary(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Three records")
    first = seed_track(db_session, "First", duration_seconds=60)
    second = seed_track(db_session, "Second", duration_seconds=120)

    first_response = add_track(client, headers, playlist["id"], str(first.id))
    second_response = add_track(client, headers, playlist["id"], str(second.id))

    assert first_response.status_code == 201
    assert [item["position"] for item in first_response.json()["items"]] == [0]
    assert second_response.status_code == 201
    assert [item["position"] for item in second_response.json()["items"]] == [0, 1]

    duplicate = add_track(client, headers, playlist["id"], str(first.id))
    assert duplicate.status_code == 409

    detail = client.get(f"/api/playlists/{playlist['id']}").json()
    assert [item["track"]["title"] for item in detail["items"]] == [
        "First",
        "Second",
    ]
    assert [item["position"] for item in detail["items"]] == [0, 1]

    summary = client.get("/api/playlists").json()[0]
    assert summary["item_count"] == 2
    assert summary["total_duration_seconds"] == 180

    stored = db_session.scalars(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == UUID(playlist["id"]))
        .order_by(PlaylistItem.position)
    ).all()
    assert [item.track_id for item in stored] == [first.id, second.id]


def test_remove_item_renumbers_positions(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Reorder")
    first = seed_track(db_session, "First")
    second = seed_track(db_session, "Second")
    third = seed_track(db_session, "Third")

    add_track(client, headers, playlist["id"], str(first.id))
    added_second = add_track(client, headers, playlist["id"], str(second.id))
    add_track(client, headers, playlist["id"], str(third.id))
    middle_item = added_second.json()["items"][1]

    removed = client.delete(
        f"/api/playlists/{playlist['id']}/items/{middle_item['id']}",
        headers=headers,
    )

    assert removed.status_code == 200
    assert [item["track"]["title"] for item in removed.json()["items"]] == [
        "First",
        "Third",
    ]
    assert [item["position"] for item in removed.json()["items"]] == [0, 1]

    stored = db_session.scalars(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == UUID(playlist["id"]))
        .order_by(PlaylistItem.position)
    ).all()
    assert [item.track_id for item in stored] == [first.id, third.id]
    assert [item.position for item in stored] == [0, 1]


def test_reorder_items_and_persist(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Reorder")
    first = seed_track(db_session, "First")
    second = seed_track(db_session, "Second")
    third = seed_track(db_session, "Third")

    added = add_track(client, headers, playlist["id"], str(first.id)).json()
    added = add_track(client, headers, playlist["id"], str(second.id)).json()
    added = add_track(client, headers, playlist["id"], str(third.id)).json()
    item_ids = [item["id"] for item in added["items"]]
    new_order = [item_ids[2], item_ids[0], item_ids[1]]

    reordered = client.put(
        f"/api/playlists/{playlist['id']}/items/reorder",
        json={"item_ids": new_order},
        headers=headers,
    )

    assert reordered.status_code == 200
    assert [item["track"]["title"] for item in reordered.json()["items"]] == [
        "Third",
        "First",
        "Second",
    ]
    assert [item["position"] for item in reordered.json()["items"]] == [0, 1, 2]

    detail = client.get(f"/api/playlists/{playlist['id']}").json()
    assert [item["track"]["title"] for item in detail["items"]] == [
        "Third",
        "First",
        "Second",
    ]

    stored = db_session.scalars(
        select(PlaylistItem)
        .where(PlaylistItem.playlist_id == UUID(playlist["id"]))
        .order_by(PlaylistItem.position)
    ).all()
    assert [item.track_id for item in stored] == [third.id, first.id, second.id]
    assert [item.position for item in stored] == [0, 1, 2]


def test_reorder_requires_exact_item_set(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Reorder")
    first = seed_track(db_session, "First")
    second = seed_track(db_session, "Second")
    added = add_track(client, headers, playlist["id"], str(first.id)).json()
    added = add_track(client, headers, playlist["id"], str(second.id)).json()
    item_ids = [item["id"] for item in added["items"]]

    missing = client.put(
        f"/api/playlists/{playlist['id']}/items/reorder",
        json={"item_ids": [item_ids[0]]},
        headers=headers,
    )
    duplicate = client.put(
        f"/api/playlists/{playlist['id']}/items/reorder",
        json={"item_ids": [item_ids[0], item_ids[0]]},
        headers=headers,
    )

    assert missing.status_code == 422
    assert duplicate.status_code == 422


def test_rename_and_delete_playlist(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Old name")
    track = seed_track(db_session, "Track")
    add_track(client, headers, playlist["id"], str(track.id))

    renamed = client.patch(
        f"/api/playlists/{playlist['id']}",
        json={"name": "New name"},
        headers=headers,
    )

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "New name"
    assert client.get(f"/api/playlists/{playlist['id']}").json()["name"] == "New name"

    deleted = client.delete(f"/api/playlists/{playlist['id']}", headers=headers)

    assert deleted.status_code == 204
    assert client.get(f"/api/playlists/{playlist['id']}").status_code == 404
    assert (
        db_session.scalar(
            select(PlaylistItem).where(PlaylistItem.playlist_id == UUID(playlist["id"]))
        )
        is None
    )


def test_add_rejects_unavailable_track_and_requires_csrf(client: TestClient, db_session):
    headers = admin_headers(client)
    playlist = create_playlist(client, headers, "Unavailable")
    track = seed_track(db_session, "Hidden", is_available=False)

    invalid = add_track(client, headers, playlist["id"], str(track.id))
    missing_csrf = client.post(
        f"/api/playlists/{playlist['id']}/items",
        json={"track_id": str(track.id)},
    )

    assert invalid.status_code == 404
    assert missing_csrf.status_code == 403


def test_missing_playlist_and_item_return_404(client: TestClient):
    headers = admin_headers(client)

    assert client.get(f"/api/playlists/{uuid4()}").status_code == 404
    assert (
        client.delete(
            f"/api/playlists/{uuid4()}/items/{uuid4()}",
            headers=headers,
        ).status_code
        == 404
    )
