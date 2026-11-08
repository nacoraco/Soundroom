"""add llm auto approval setting

Revision ID: 0004_llm_setting
Revises: 0003_import_jobs
Create Date: 2026-11-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_llm_setting"
down_revision: Union[str, None] = "0003_import_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "llm_auto_approve",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "llm_auto_approve")
