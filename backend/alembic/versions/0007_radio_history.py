"""add canonical identity and radio history

Revision ID: 0007_radio_history
Revises: 0006_radio_llm
Create Date: 2026-11-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007_radio_history"
down_revision: Union[str, None] = "0006_radio_llm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tracks",
        sa.Column(
            "canonical_artist",
            sa.String(length=200),
            server_default="",
            nullable=False,
        ),
    )
    op.add_column(
        "tracks",
        sa.Column(
            "canonical_title",
            sa.String(length=300),
            server_default="",
            nullable=False,
        ),
    )
    op.add_column(
        "tracks",
        sa.Column(
            "recording_key",
            sa.String(length=400),
            server_default="",
            nullable=False,
        ),
    )
    op.create_index(
        "ix_tracks_recording_key", "tracks", ["recording_key"], unique=False
    )

    op.add_column(
        "rip_jobs", sa.Column("source_artist", sa.String(length=200), nullable=True)
    )
    op.add_column(
        "rip_jobs", sa.Column("source_title", sa.String(length=300), nullable=True)
    )
    op.add_column(
        "rip_jobs",
        sa.Column("expected_duration_seconds", sa.Integer(), nullable=True),
    )
    op.add_column(
        "rip_jobs", sa.Column("recording_key", sa.String(length=400), nullable=True)
    )
    op.create_index(
        "ix_rip_jobs_recording_key", "rip_jobs", ["recording_key"], unique=False
    )

    op.create_table(
        "listens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("recording_key", sa.String(length=400), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("artist", sa.String(length=200), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("played_seconds", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("completion_ratio", sa.Float(), nullable=False),
        sa.Column("skipped", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_listens_user_id", "listens", ["user_id"], unique=False)
    op.create_index("ix_listens_track_id", "listens", ["track_id"], unique=False)
    op.create_index(
        "ix_listens_recording_key", "listens", ["recording_key"], unique=False
    )
    op.create_index("ix_listens_started_at", "listens", ["started_at"], unique=False)
    op.create_index(
        "ix_listens_user_started", "listens", ["user_id", "started_at"], unique=False
    )
    op.create_index(
        "ix_listens_user_track", "listens", ["user_id", "track_id"], unique=False
    )

    op.create_table(
        "radio_feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("recording_key", sa.String(length=400), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("artist", sa.String(length=200), nullable=False),
        sa.Column(
            "verdict",
            sa.Enum(
                "reject",
                "like",
                name="radio_feedback_verdict",
                native_enum=False,
                length=20,
                create_constraint=True,
                validate_strings=True,
            ),
            nullable=False,
        ),
        sa.Column("reason", sa.String(length=30), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "recording_key", name="uq_radio_feedback_user_recording"
        ),
    )
    op.create_index(
        "ix_radio_feedback_user_id", "radio_feedback", ["user_id"], unique=False
    )
    op.create_index(
        "ix_radio_feedback_track_id", "radio_feedback", ["track_id"], unique=False
    )
    op.create_index(
        "ix_radio_feedback_recording_key",
        "radio_feedback",
        ["recording_key"],
        unique=False,
    )
    op.create_index(
        "ix_radio_feedback_expires_at",
        "radio_feedback",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_radio_feedback_user_verdict",
        "radio_feedback",
        ["user_id", "verdict"],
        unique=False,
    )
    op.create_index(
        "ix_radio_feedback_user_artist",
        "radio_feedback",
        ["user_id", "artist"],
        unique=False,
    )

    op.create_table(
        "radio_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("seed_track_id", sa.Uuid(), nullable=True),
        sa.Column(
            "discovery_level",
            sa.Enum(
                "familiar",
                "balanced",
                "adventurous",
                name="radio_discovery_level",
                native_enum=False,
                length=20,
                create_constraint=True,
                validate_strings=True,
            ),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["seed_track_id"], ["tracks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index(
        "ix_radio_sessions_user_id", "radio_sessions", ["user_id"], unique=True
    )
    op.create_index(
        "ix_radio_sessions_seed_track_id",
        "radio_sessions",
        ["seed_track_id"],
        unique=False,
    )

    op.create_table(
        "lastfm_cache",
        sa.Column("key", sa.String(length=500), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_index(
        "ix_lastfm_cache_expires_at", "lastfm_cache", ["expires_at"], unique=False
    )


def downgrade() -> None:
    op.drop_table("lastfm_cache")
    op.drop_table("radio_sessions")
    op.drop_table("radio_feedback")
    op.drop_table("listens")

    op.drop_index("ix_rip_jobs_recording_key", table_name="rip_jobs")
    op.drop_column("rip_jobs", "recording_key")
    op.drop_column("rip_jobs", "expected_duration_seconds")
    op.drop_column("rip_jobs", "source_title")
    op.drop_column("rip_jobs", "source_artist")

    op.drop_index("ix_tracks_recording_key", table_name="tracks")
    op.drop_column("tracks", "recording_key")
    op.drop_column("tracks", "canonical_title")
    op.drop_column("tracks", "canonical_artist")
