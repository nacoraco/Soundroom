"""add server-owned playback queue

Revision ID: 0008_backend_queue
Revises: 0007_radio_history
Create Date: 2026-11-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008_backend_queue"
down_revision: Union[str, None] = "0007_radio_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "queue_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("recording_key", sa.String(length=400), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("artist", sa.String(length=200), nullable=False),
        sa.Column("video_id", sa.String(length=30), nullable=True),
        sa.Column("expected_duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "source",
            sa.Enum(
                "radio",
                "manual",
                name="queue_item_source",
                native_enum=False,
                length=20,
                create_constraint=True,
                validate_strings=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "ready",
                "pending",
                "failed",
                name="queue_item_status",
                native_enum=False,
                length=20,
                create_constraint=True,
                validate_strings=True,
            ),
            nullable=False,
        ),
        sa.Column("import_job_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(length=300), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
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
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["import_job_id"], ["rip_jobs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_queue_items_user_id", "queue_items", ["user_id"])
    op.create_index("ix_queue_items_track_id", "queue_items", ["track_id"])
    op.create_index(
        "ix_queue_items_recording_key", "queue_items", ["recording_key"]
    )
    op.create_index(
        "ix_queue_items_import_job_id", "queue_items", ["import_job_id"]
    )
    op.create_index(
        "ix_queue_items_user_position",
        "queue_items",
        ["user_id", "position"],
    )
    op.create_index(
        "ix_queue_items_user_status",
        "queue_items",
        ["user_id", "status"],
    )

    with op.batch_alter_table("radio_sessions") as batch_op:
        batch_op.add_column(sa.Column("current_item_id", sa.Uuid(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "revision",
                sa.Integer(),
                server_default="0",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "is_playing",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "position_seconds",
                sa.Integer(),
                server_default="0",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "queue_exhausted",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )
        batch_op.create_foreign_key(
            "fk_radio_sessions_current_item_id",
            "queue_items",
            ["current_item_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_radio_sessions_current_item_id", ["current_item_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("radio_sessions") as batch_op:
        batch_op.drop_index("ix_radio_sessions_current_item_id")
        batch_op.drop_constraint(
            "fk_radio_sessions_current_item_id", type_="foreignkey"
        )
        batch_op.drop_column("queue_exhausted")
        batch_op.drop_column("position_seconds")
        batch_op.drop_column("is_playing")
        batch_op.drop_column("revision")
        batch_op.drop_column("current_item_id")

    op.drop_table("queue_items")
