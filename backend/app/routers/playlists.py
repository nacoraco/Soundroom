from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..models import Playlist, PlaylistItem, Track
from ..schemas import (
    PlaylistCreate,
    PlaylistDetail,
    PlaylistItemCreate,
    PlaylistItemOut,
    PlaylistReorder,
    PlaylistSummary,
    PlaylistUpdate,
    TrackOut,
)

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


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
        stream_version=track.stream_version,
        created_at=track.created_at,
    )


def _detail(playlist: Playlist) -> PlaylistDetail:
    items = sorted(playlist.items, key=lambda item: item.position)
    return PlaylistDetail(
        id=playlist.id,
        name=playlist.name,
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
        items=[
            PlaylistItemOut(
                id=item.id,
                position=item.position,
                track=_track_out(item.track),
            )
            for item in items
        ],
    )


def _load_owned(
    db: Session,
    playlist_id: UUID,
    owner_id: UUID,
    *,
    with_items: bool = True,
    populate_existing: bool = False,
) -> Playlist:
    statement = select(Playlist).where(
        Playlist.id == playlist_id,
        Playlist.owner_id == owner_id,
    )
    if with_items:
        statement = statement.options(
            selectinload(Playlist.items)
            .joinedload(PlaylistItem.track)
            .joinedload(Track.artist),
            selectinload(Playlist.items)
            .joinedload(PlaylistItem.track)
            .joinedload(Track.album),
        )
    if populate_existing:
        statement = statement.execution_options(populate_existing=True)
    playlist = db.scalar(statement)
    if playlist is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist not found",
        )
    return playlist


def _detail_after_commit(
    db: Session,
    playlist_id: UUID,
    owner_id: UUID,
) -> PlaylistDetail:
    playlist = _load_owned(
        db,
        playlist_id,
        owner_id,
        populate_existing=True,
    )
    return _detail(playlist)


@router.get("", response_model=list[PlaylistSummary])
def list_playlists(
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> list[PlaylistSummary]:
    playlists = db.scalars(
        select(Playlist)
        .options(selectinload(Playlist.items).joinedload(PlaylistItem.track))
        .where(Playlist.owner_id == ctx.user.id)
        .order_by(Playlist.updated_at.desc(), Playlist.name, Playlist.id)
    ).all()
    return [
        PlaylistSummary(
            id=playlist.id,
            name=playlist.name,
            item_count=len(playlist.items),
            total_duration_seconds=sum(
                item.track.duration_seconds
                for item in playlist.items
                if item.track is not None
            ),
            created_at=playlist.created_at,
            updated_at=playlist.updated_at,
        )
        for playlist in playlists
    ]


@router.post("", response_model=PlaylistDetail, status_code=status.HTTP_201_CREATED)
def create_playlist(
    payload: PlaylistCreate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    playlist = Playlist(
        id=uuid4(),
        owner_id=ctx.user.id,
        name=payload.name,
    )
    db.add(playlist)
    db.commit()
    return _detail_after_commit(db, playlist.id, ctx.user.id)


@router.get("/{playlist_id}", response_model=PlaylistDetail)
def get_playlist(
    playlist_id: UUID,
    ctx: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    return _detail(_load_owned(db, playlist_id, ctx.user.id))


@router.patch("/{playlist_id}", response_model=PlaylistDetail)
def rename_playlist(
    playlist_id: UUID,
    payload: PlaylistUpdate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    playlist = _load_owned(db, playlist_id, ctx.user.id)
    playlist.name = payload.name
    playlist.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _detail_after_commit(db, playlist.id, ctx.user.id)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playlist(
    playlist_id: UUID,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    playlist = _load_owned(db, playlist_id, ctx.user.id)
    db.delete(playlist)
    db.commit()


@router.post(
    "/{playlist_id}/items",
    response_model=PlaylistDetail,
    status_code=status.HTTP_201_CREATED,
)
def add_playlist_item(
    playlist_id: UUID,
    payload: PlaylistItemCreate,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    playlist = _load_owned(db, playlist_id, ctx.user.id)
    track = db.scalar(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(Track.id == payload.track_id, Track.is_available.is_(True))
    )
    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found",
        )
    if any(item.track_id == track.id for item in playlist.items):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track is already in this playlist",
        )

    next_position = max((item.position for item in playlist.items), default=-1) + 1
    item = PlaylistItem(
        id=uuid4(),
        playlist_id=playlist.id,
        track_id=track.id,
        position=next_position,
    )
    playlist.updated_at = datetime.now(timezone.utc)
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Track is already in this playlist",
        ) from exc
    return _detail_after_commit(db, playlist.id, ctx.user.id)


@router.delete("/{playlist_id}/items/{item_id}", response_model=PlaylistDetail)
def remove_playlist_item(
    playlist_id: UUID,
    item_id: UUID,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    playlist = _load_owned(db, playlist_id, ctx.user.id)
    item = next((entry for entry in playlist.items if entry.id == item_id), None)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playlist item not found",
        )

    remaining = sorted(
        (entry for entry in playlist.items if entry.id != item.id),
        key=lambda entry: entry.position,
    )
    db.delete(item)
    for index, entry in enumerate(remaining):
        entry.position = -(index + 1)
    db.flush()
    for index, entry in enumerate(remaining):
        entry.position = index
    playlist.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _detail_after_commit(db, playlist.id, ctx.user.id)


@router.put("/{playlist_id}/items/reorder", response_model=PlaylistDetail)
def reorder_playlist_items(
    playlist_id: UUID,
    payload: PlaylistReorder,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> PlaylistDetail:
    playlist = _load_owned(db, playlist_id, ctx.user.id)
    items_by_id = {item.id: item for item in playlist.items}
    if len(set(payload.item_ids)) != len(payload.item_ids) or set(
        payload.item_ids
    ) != set(items_by_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The reorder list must contain every playlist item exactly once.",
        )

    for index, item_id in enumerate(payload.item_ids):
        items_by_id[item_id].position = -(index + 1)
    db.flush()
    for index, item_id in enumerate(payload.item_ids):
        items_by_id[item_id].position = index
    playlist.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _detail_after_commit(db, playlist.id, ctx.user.id)
