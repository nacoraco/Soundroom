"""app settings and rip jobs

Revision ID: 0003_import_jobs
Revises: 0002_tracks
Create Date: 2026-11-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_import_jobs"
down_revision: Union[str, None] = "0002_tracks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("auto_rip_on_miss", sa.Boolean(), nullable=False),
        sa.Column("max_track_minutes", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_app_settings_updated_by_user_id",
        "app_settings",
        ["updated_by_user_id"],
        unique=False,
    )
    op.create_table(
        "rip_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("query_text", sa.String(length=300), nullable=False),
        sa.Column("normalized_query", sa.String(length=300), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "searching",
                "downloading",
                "processing",
                "needs_review",
                "completed",
                "failed",
                "cancelled",
                name="rip_job_status",
                native_enum=False,
                length=30,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("candidate_url", sa.String(length=1000), nullable=True),
        sa.Column("candidate_title", sa.String(length=300), nullable=True),
        sa.Column("candidate_artist", sa.String(length=200), nullable=True),
        sa.Column("candidate_duration_seconds", sa.Integer(), nullable=True),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("error_message", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["track_id"], ["tracks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_rip_jobs_requested_by_user_id",
        "rip_jobs",
        ["requested_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_rip_jobs_normalized_query",
        "rip_jobs",
        ["normalized_query"],
        unique=False,
    )
    op.create_index("ix_rip_jobs_status", "rip_jobs", ["status"], unique=False)
    op.create_index("ix_rip_jobs_track_id", "rip_jobs", ["track_id"], unique=False)
    op.create_index("ix_rip_jobs_created_at", "rip_jobs", ["created_at"], unique=False)
    op.create_index(
        "ix_rip_jobs_normalized_query_status",
        "rip_jobs",
        ["normalized_query", "status"],
        unique=False,
    )

    settings_table = sa.table(
        "app_settings",
        sa.column("id", sa.Integer),
        sa.column("auto_rip_on_miss", sa.Boolean),
        sa.column("max_track_minutes", sa.Integer),
    )
    op.bulk_insert(
        settings_table,
        [
            {
                "id": 1,
                "auto_rip_on_miss": False,
                "max_track_minutes": 15,
            }
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_rip_jobs_normalized_query_status", table_name="rip_jobs")
    op.drop_index("ix_rip_jobs_created_at", table_name="rip_jobs")
    op.drop_index("ix_rip_jobs_track_id", table_name="rip_jobs")
    op.drop_index("ix_rip_jobs_status", table_name="rip_jobs")
    op.drop_index("ix_rip_jobs_normalized_query", table_name="rip_jobs")
    op.drop_index("ix_rip_jobs_requested_by_user_id", table_name="rip_jobs")
    op.drop_table("rip_jobs")
    op.drop_index(
        "ix_app_settings_updated_by_user_id", table_name="app_settings"
    )
    op.drop_table("app_settings")
