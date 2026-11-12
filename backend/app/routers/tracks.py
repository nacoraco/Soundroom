from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf, require_roles
from ..metadata import InvalidMp3Error, read_mp3_metadata
from ..models import Album, Artist, Track, TrackSource, UserRole
from ..recommendations import canonical_metadata, song_identity
from ..schemas import TrackOut, TrackPage
from ..storage import EmptyUpload, UploadTooLarge, save_upload_to_temp
from ..streaming import InvalidRange, parse_range_header
from ..text import normalize_text

router = APIRouter(prefix="/api/tracks", tags=["tracks"])

PAGE_SIZE = 20
MIN_SEARCH_LENGTH = 3
MAX_SEARCH_LENGTH = 200
STREAM_CHUNK_SIZE = 64 * 1024


def _iter_file(path: Path, start: int, length: int):
    with path.open("rb") as file:
        file.seek(start)
        remaining = length
        while remaining > 0:
            chunk = file.read(min(STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _empty_page(page: int) -> TrackPage:
    return TrackPage(
        items=[],
        page=page,
        page_size=PAGE_SIZE,
        total=0,
        total_pages=0,
    )


def _track_out(track: Track, artist: Artist, album: Album | None) -> TrackOut:
    return TrackOut(
        id=track.id,
        title=track.title,
        artist_name=artist.name,
        album_title=album.title if album is not None else None,
        release_year=album.release_year if album is not None else None,
        duration_seconds=track.duration_seconds,
        mime_type=track.mime_type,
        source_type=track.source_type,
        is_available=track.is_available,
        recording_key=track.recording_key,
        created_at=track.created_at,
    )


@router.get("", response_model=TrackPage)
def list_tracks(
    q: str | None = Query(default=None, max_length=MAX_SEARCH_LENGTH),
    page: int = Query(default=1, ge=1),
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> TrackPage:
    raw_query = (q or "").strip()
    normalized_query = normalize_text(raw_query)
    if raw_query and len(normalized_query) < MIN_SEARCH_LENGTH:
        return _empty_page(page)

    filters = [Track.is_available.is_(True)]
    if normalized_query:
        filters.append(
            or_(
                Track.normalized_title.contains(
                    normalized_query, autoescape=True
                ),
                Artist.normalized_name.contains(
                    normalized_query, autoescape=True
                ),
            )
        )

    total = (
        db.scalar(
            select(func.count(Track.id))
            .join(Artist, Track.artist_id == Artist.id)
            .where(*filters)
        )
        or 0
    )
    if total == 0:
        return _empty_page(page)

    order_by = (
        (Track.normalized_title.asc(), Artist.normalized_name.asc(), Track.id.asc())
        if normalized_query
        else (Track.created_at.desc(), Track.id.asc())
    )
    tracks = db.scalars(
        select(Track)
        .join(Artist, Track.artist_id == Artist.id)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(*filters)
        .order_by(*order_by)
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
    ).all()

    return TrackPage(
        items=[
            _track_out(track, track.artist, track.album)
            for track in tracks
        ],
        page=page,
        page_size=PAGE_SIZE,
        total=total,
        total_pages=(total + PAGE_SIZE - 1) // PAGE_SIZE,
    )


@router.get("/{track_id}", response_model=TrackOut)
def get_track(
    track_id: UUID,
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> TrackOut:
    track = db.scalar(
        select(Track)
        .options(joinedload(Track.artist), joinedload(Track.album))
        .where(Track.id == track_id, Track.is_available.is_(True))
    )
    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found",
        )
    return _track_out(track, track.artist, track.album)


@router.get("/{track_id}/stream")
def stream_track(
    track_id: UUID,
    request: Request,
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    track = db.get(Track, track_id)
    if track is None or not track.is_available:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found",
        )

    media_root = Path(settings.media_storage_path).resolve()
    file_path = (media_root / track.file_path).resolve()
    if not file_path.is_relative_to(media_root) or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track file not found",
        )

    file_size = file_path.stat().st_size
    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track file not found",
        )

    range_header = request.headers.get("range")
    try:
        byte_range = (
            parse_range_header(range_header, file_size)
            if range_header is not None
            else None
        )
    except InvalidRange as exc:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Range not satisfiable",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Range": f"bytes */{file_size}",
            },
        ) from exc

    if byte_range is None:
        start = 0
        end = file_size - 1
        response_status = status.HTTP_200_OK
    else:
        start = byte_range.start
        end = byte_range.end
        response_status = status.HTTP_206_PARTIAL_CONTENT

    length = end - start + 1
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Length": str(length),
        "Content-Disposition": "inline",
        "ETag": f'"{track.audio_sha256}"',
        "X-Content-Type-Options": "nosniff",
    }
    if byte_range is not None:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    return StreamingResponse(
        _iter_file(file_path, start, length),
        status_code=response_status,
        headers=headers,
        media_type=track.mime_type,
    )


@router.delete("/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_track(
    track_id: UUID,
    _: AuthContext = Depends(require_roles(UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    track = db.get(Track, track_id)
    if track is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found",
        )

    media_root = Path(settings.media_storage_path).resolve()
    file_path = (media_root / track.file_path).resolve()
    if not file_path.is_relative_to(media_root):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track file not found",
        )
    if file_path.exists():
        if not file_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Track file not found",
            )
        file_path.unlink()

    db.delete(track)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("", response_model=TrackOut, status_code=status.HTTP_201_CREATED)
async def upload_track(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    artist: str | None = Form(default=None),
    album: str | None = Form(default=None),
    release_year: int | None = Form(default=None),
    _: AuthContext = Depends(require_roles(UserRole.editor, UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TrackOut:
    if not file.filename or Path(file.filename).suffix.lower() != ".mp3":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only MP3 files are accepted.",
        )

    title = (title or "").strip() or None
    artist = (artist or "").strip() or None
    album = (album or "").strip() or None
    if release_year is not None and not 1900 <= release_year <= 2100:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Release year must be between 1900 and 2100.",
        )

    try:
        temp_path, sha256, _size = await save_upload_to_temp(file, settings)
    except UploadTooLarge as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "File is too large. "
                f"Maximum allowed size is {settings.max_upload_mb} MB."
            ),
        ) from exc
    except EmptyUpload as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The uploaded file is empty.",
        ) from exc

    try:
        try:
            metadata = read_mp3_metadata(temp_path)
        except InvalidMp3Error as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc

        final_title = title or metadata.title
        final_artist = artist or metadata.artist
        final_album = album or metadata.album
        final_year = release_year if release_year is not None else metadata.release_year

        missing = [
            name
            for name, value in (("title", final_title), ("artist", final_artist))
            if not value
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "missing_metadata",
                    "message": (
                        "The file is missing title or artist metadata. "
                        "Enter the missing details and upload again."
                    ),
                    "missing": missing,
                    "metadata": {
                        "title": metadata.title,
                        "artist": metadata.artist,
                        "album": metadata.album,
                        "release_year": metadata.release_year,
                        "duration_seconds": metadata.duration_seconds,
                    },
                },
            )

        normalized_artist = normalize_text(final_artist or "")
        normalized_title = normalize_text(final_title or "")
        if not normalized_artist:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Artist is required.",
            )
        if not normalized_title:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Title is required.",
            )

        if (
            db.scalar(select(Track.id).where(Track.audio_sha256 == sha256))
            is not None
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This recording is already in the library.",
            )

        artist_obj = db.scalar(
            select(Artist).where(Artist.normalized_name == normalized_artist)
        )
        if artist_obj is None:
            artist_obj = Artist(
                name=final_artist,
                normalized_name=normalized_artist,
            )
            db.add(artist_obj)
            db.flush()

        album_obj: Album | None = None
        if final_album:
            album_obj = db.scalar(
                select(Album).where(
                    Album.artist_id == artist_obj.id,
                    func.lower(Album.title) == final_album.casefold(),
                )
            )
            if album_obj is None:
                album_obj = Album(
                    artist_id=artist_obj.id,
                    title=final_album,
                    release_year=final_year,
                )
                db.add(album_obj)
                db.flush()
            elif final_year is not None and album_obj.release_year is None:
                album_obj.release_year = final_year

        relative_path = f"tracks/{uuid4().hex}.mp3"
        final_path = Path(settings.media_storage_path) / relative_path
        final_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(temp_path, final_path)

        canonical_artist, canonical_title = canonical_metadata(
            final_artist or "", final_title or ""
        )
        track = Track(
            artist_id=artist_obj.id,
            album_id=album_obj.id if album_obj is not None else None,
            title=final_title,
            normalized_title=normalized_title,
            canonical_artist=canonical_artist,
            canonical_title=canonical_title,
            recording_key=song_identity(
                final_artist or "", final_title or ""
            ),
            duration_seconds=metadata.duration_seconds,
            file_path=relative_path,
            mime_type="audio/mpeg",
            source_type=TrackSource.upload,
            audio_sha256=sha256,
            is_available=True,
        )

        try:
            db.add(track)
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            final_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This recording is already in the library.",
            ) from exc
        except Exception:
            db.rollback()
            final_path.unlink(missing_ok=True)
            raise

        db.refresh(track)
        return _track_out(track, artist_obj, album_obj)
    finally:
        temp_path.unlink(missing_ok=True)
