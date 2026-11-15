"""add per-recording skip escalation fields

Revision ID: 0009_radio_feedback_skip_window
Revises: 0008_backend_queue
Create Date: 2026-11-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009_radio_feedback_skip_window"
down_revision: Union[str, None] = "0008_backend_queue"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "radio_feedback",
        sa.Column(
            "skip_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "radio_feedback",
        sa.Column(
            "skip_window_started_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("radio_feedback", "skip_window_started_at")
    op.drop_column("radio_feedback", "skip_count")
