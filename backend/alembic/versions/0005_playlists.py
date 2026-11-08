"""personal playlists

Revision ID: 0005_playlists
Revises: 0004_llm_setting
Create Date: 2026-11-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_playlists"
down_revision: Union[str, None] = "0004_llm_setting"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "playlists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_playlists_owner_id", "playlists", ["owner_id"], unique=False
    )
    op.create_index(
        "ix_playlists_updated_at", "playlists", ["updated_at"], unique=False
    )

    op.create_table(
        "playlist_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("playlist_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["playlist_id"], ["playlists.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "playlist_id",
            "track_id",
            name="uq_playlist_items_playlist_track",
        ),
        sa.UniqueConstraint(
            "playlist_id",
            "position",
            name="uq_playlist_items_playlist_position",
        ),
    )
    op.create_index(
        "ix_playlist_items_playlist_id",
        "playlist_items",
        ["playlist_id"],
        unique=False,
    )
    op.create_index(
        "ix_playlist_items_track_id",
        "playlist_items",
        ["track_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_playlist_items_track_id", table_name="playlist_items")
    op.drop_index("ix_playlist_items_playlist_id", table_name="playlist_items")
    op.drop_table("playlist_items")
    op.drop_index("ix_playlists_updated_at", table_name="playlists")
    op.drop_index("ix_playlists_owner_id", table_name="playlists")
    op.drop_table("playlists")
