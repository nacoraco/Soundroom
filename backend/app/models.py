from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
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

