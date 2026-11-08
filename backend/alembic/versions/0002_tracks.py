"""artists, albums and tracks

Revision ID: 0002_tracks
Revises: 0001_initial
Create Date: 2026-11-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_tracks"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "artists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("normalized_name", sa.String(length=200), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_artists_normalized_name", "artists", ["normalized_name"], unique=True
    )

    op.create_table(
        "albums",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("artist_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("release_year", sa.Integer(), nullable=True),
        sa.Column("cover_path", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(
            ["artist_id"], ["artists.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_albums_artist_id", "albums", ["artist_id"], unique=False)

    op.create_table(
        "tracks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("artist_id", sa.Uuid(), nullable=False),
        sa.Column("album_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("normalized_title", sa.String(length=300), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column(
            "source_type",
            sa.Enum(
                "upload",
                "youtube",
                name="track_source",
                native_enum=False,
                length=20,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column("audio_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "is_available", sa.Boolean(), server_default=sa.true(), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"], ["artists.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["album_id"], ["albums.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tracks_artist_id", "tracks", ["artist_id"], unique=False)
    op.create_index("ix_tracks_album_id", "tracks", ["album_id"], unique=False)
    op.create_index(
        "ix_tracks_normalized_title", "tracks", ["normalized_title"], unique=False
    )
    op.create_index("ix_tracks_file_path", "tracks", ["file_path"], unique=True)
    op.create_index("ix_tracks_audio_sha256", "tracks", ["audio_sha256"], unique=True)
    op.create_index("ix_tracks_is_available", "tracks", ["is_available"], unique=False)
    op.create_index("ix_tracks_created_at", "tracks", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_tracks_created_at", table_name="tracks")
    op.drop_index("ix_tracks_is_available", table_name="tracks")
    op.drop_index("ix_tracks_audio_sha256", table_name="tracks")
    op.drop_index("ix_tracks_file_path", table_name="tracks")
    op.drop_index("ix_tracks_normalized_title", table_name="tracks")
    op.drop_index("ix_tracks_album_id", table_name="tracks")
    op.drop_index("ix_tracks_artist_id", table_name="tracks")
    op.drop_table("tracks")
    op.drop_index("ix_albums_artist_id", table_name="albums")
    op.drop_table("albums")
    op.drop_index("ix_artists_normalized_name", table_name="artists")
    op.drop_table("artists")
