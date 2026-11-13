from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class UserRole(StrEnum):
    listener = "listener"
    editor = "editor"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(
            UserRole,
            name="user_role",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=UserRole.listener,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    sessions: Mapped[list[UserSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    playlists: Mapped[list[Playlist]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped[User] = relationship(back_populates="sessions")


class TrackSource(StrEnum):
    upload = "upload"
    youtube = "youtube"


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(
        String(200), unique=True, index=True, nullable=False
    )

    albums: Mapped[list[Album]] = relationship(back_populates="artist")
    tracks: Mapped[list[Track]] = relationship(back_populates="artist")


class Album(Base):
    __tablename__ = "albums"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    release_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cover_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    artist: Mapped[Artist] = relationship(back_populates="albums")
    tracks: Mapped[list[Track]] = relationship(back_populates="album")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    album_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("albums.id", ondelete="SET NULL"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    normalized_title: Mapped[str] = mapped_column(
        String(300), index=True, nullable=False
    )
    canonical_artist: Mapped[str] = mapped_column(
        String(200), default="", server_default="", nullable=False
    )
    canonical_title: Mapped[str] = mapped_column(
        String(300), default="", server_default="", nullable=False
    )
    recording_key: Mapped[str] = mapped_column(
        String(400),
        default="",
        server_default="",
        index=True,
        nullable=False,
    )
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(
        String(500), unique=True, index=True, nullable=False
    )
    mime_type: Mapped[str] = mapped_column(
        String(100), default="audio/mpeg", nullable=False
    )
    source_type: Mapped[TrackSource] = mapped_column(
        SAEnum(
            TrackSource,
            name="track_source",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=TrackSource.upload,
        nullable=False,
    )
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    audio_sha256: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False
    )
    is_available: Mapped[bool] = mapped_column(
        Boolean, default=True, index=True, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )

    artist: Mapped[Artist] = relationship(back_populates="tracks")
    album: Mapped[Album | None] = relationship(back_populates="tracks")

    @property
    def stream_version(self) -> str:
        return hashlib.sha256(
            self.file_path.encode("utf-8")
        ).hexdigest()[:12]


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        index=True,
        nullable=False,
    )

    owner: Mapped[User] = relationship(back_populates="playlists")
    items: Mapped[list[PlaylistItem]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="PlaylistItem.position",
    )


class PlaylistItem(Base):
    __tablename__ = "playlist_items"
    __table_args__ = (
        UniqueConstraint(
            "playlist_id", "track_id", name="uq_playlist_items_playlist_track"
        ),
        UniqueConstraint(
            "playlist_id", "position", name="uq_playlist_items_playlist_position"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), index=True, nullable=False
    )
    track_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    playlist: Mapped[Playlist] = relationship(back_populates="items")
    track: Mapped[Track] = relationship()


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    auto_rip_on_miss: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    llm_auto_approve: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    max_track_minutes: Mapped[int] = mapped_column(
        Integer, default=15, nullable=False
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RipJobStatus(StrEnum):
    queued = "queued"
    searching = "searching"
    downloading = "downloading"
    processing = "processing"
    needs_review = "needs_review"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


ACTIVE_RIP_JOB_STATUSES = (
    RipJobStatus.queued,
    RipJobStatus.searching,
    RipJobStatus.downloading,
    RipJobStatus.processing,
    RipJobStatus.needs_review,
)


class RipJob(Base):
    __tablename__ = "rip_jobs"
    __table_args__ = (
        Index(
            "ix_rip_jobs_normalized_query_status",
            "normalized_query",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    query_text: Mapped[str] = mapped_column(String(300), nullable=False)
    normalized_query: Mapped[str] = mapped_column(
        String(300), index=True, nullable=False
    )
    status: Mapped[RipJobStatus] = mapped_column(
        SAEnum(
            RipJobStatus,
            name="rip_job_status",
            native_enum=False,
            length=30,
            create_constraint=True,
            validate_strings=True,
        ),
        default=RipJobStatus.queued,
        index=True,
        nullable=False,
    )
    candidate_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    candidate_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    candidate_artist: Mapped[str | None] = mapped_column(String(200), nullable=True)
    candidate_duration_seconds: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    source_artist: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    expected_duration_seconds: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    recording_key: Mapped[str | None] = mapped_column(
        String(400), index=True, nullable=True
    )
    force_llm_approval: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
        nullable=False,
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DiscoveryLevel(StrEnum):
    familiar = "familiar"
    balanced = "balanced"
    adventurous = "adventurous"


class QueueItemStatus(StrEnum):
    ready = "ready"
    pending = "pending"
    failed = "failed"


class QueueItemSource(StrEnum):
    radio = "radio"
    manual = "manual"


class RadioFeedbackVerdict(StrEnum):
    reject = "reject"
    like = "like"


class Listen(Base):
    __tablename__ = "listens"
    __table_args__ = (
        Index("ix_listens_user_started", "user_id", "started_at"),
        Index("ix_listens_user_track", "user_id", "track_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    recording_key: Mapped[str] = mapped_column(
        String(400), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    artist: Mapped[str] = mapped_column(String(200), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
        nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    played_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_ratio: Mapped[float] = mapped_column(
        Float, default=0.0, nullable=False
    )
    skipped: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), default="radio", nullable=False
    )


class RadioFeedback(Base):
    __tablename__ = "radio_feedback"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "recording_key", name="uq_radio_feedback_user_recording"
        ),
        Index("ix_radio_feedback_user_verdict", "user_id", "verdict"),
        Index("ix_radio_feedback_user_artist", "user_id", "artist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    recording_key: Mapped[str] = mapped_column(
        String(400), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    artist: Mapped[str] = mapped_column(String(200), nullable=False)
    verdict: Mapped[RadioFeedbackVerdict] = mapped_column(
        SAEnum(
            RadioFeedbackVerdict,
            name="radio_feedback_verdict",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=RadioFeedbackVerdict.reject,
        nullable=False,
    )
    reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )


class QueueItem(Base):
    __tablename__ = "queue_items"
    __table_args__ = (
        Index("ix_queue_items_user_position", "user_id", "position"),
        Index("ix_queue_items_user_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    track_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    recording_key: Mapped[str] = mapped_column(
        String(400), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    artist: Mapped[str] = mapped_column(String(200), nullable=False)
    video_id: Mapped[str | None] = mapped_column(String(30), nullable=True)
    expected_duration_seconds: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    source: Mapped[QueueItemSource] = mapped_column(
        SAEnum(
            QueueItemSource,
            name="queue_item_source",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=QueueItemSource.radio,
        nullable=False,
    )
    status: Mapped[QueueItemStatus] = mapped_column(
        SAEnum(
            QueueItemStatus,
            name="queue_item_status",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=QueueItemStatus.pending,
        nullable=False,
    )
    import_job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rip_jobs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    error_message: Mapped[str | None] = mapped_column(
        String(1000), nullable=True
    )
    track: Mapped[Track | None] = relationship("Track", lazy="joined")
    import_job: Mapped[RipJob | None] = relationship(
        "RipJob", lazy="joined"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RadioSession(Base):
    __tablename__ = "radio_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    seed_track_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tracks.id", ondelete="SET NULL"), index=True, nullable=True
    )
    current_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("queue_items.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    revision: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    is_playing: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    position_seconds: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0", nullable=False
    )
    queue_exhausted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    discovery_level: Mapped[DiscoveryLevel] = mapped_column(
        SAEnum(
            DiscoveryLevel,
            name="radio_discovery_level",
            native_enum=False,
            length=20,
            create_constraint=True,
            validate_strings=True,
        ),
        default=DiscoveryLevel.balanced,
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class LastfmCache(Base):
    __tablename__ = "lastfm_cache"

    key: Mapped[str] = mapped_column(String(500), primary_key=True)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )

