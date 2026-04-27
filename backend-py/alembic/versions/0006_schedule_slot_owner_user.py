"""schedule_slot per-student ownership for personal routine isolation."""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ScheduleSlot",
        sa.Column("ownerUserId", sa.String(), nullable=True),
    )
    op.create_foreign_key(
        "fk_schedule_slot_owner_user",
        "ScheduleSlot",
        "User",
        ["ownerUserId"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_schedule_slot_owner_user", "ScheduleSlot", type_="foreignkey")
    op.drop_column("ScheduleSlot", "ownerUserId")
