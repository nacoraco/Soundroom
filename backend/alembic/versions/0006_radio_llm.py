"""force LLM approval for recommendation imports

Revision ID: 0006_radio_llm
Revises: 0005_playlists
Create Date: 2026-11-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006_radio_llm"
down_revision: Union[str, None] = "0005_playlists"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rip_jobs",
        sa.Column(
            "force_llm_approval",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("rip_jobs", "force_llm_approval")
