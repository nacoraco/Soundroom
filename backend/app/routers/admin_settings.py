from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, require_csrf, require_roles
from ..models import AppSettings, UserRole
from ..schemas import AppSettingsOut, AppSettingsUpdate
from ..settings_service import get_or_create_app_settings

router = APIRouter(prefix="/api/admin/settings", tags=["admin"])


@router.get("", response_model=AppSettingsOut)
def read_settings(
    _: AuthContext = Depends(require_roles(UserRole.admin)),
    db: Session = Depends(get_db),
) -> AppSettings:
    return get_or_create_app_settings(db)


@router.put("", response_model=AppSettingsOut)
def update_settings(
    payload: AppSettingsUpdate,
    ctx: AuthContext = Depends(require_roles(UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> AppSettings:
    settings = get_or_create_app_settings(db)
    settings.auto_rip_on_miss = payload.auto_rip_on_miss
    settings.llm_auto_approve = payload.llm_auto_approve
    settings.max_track_minutes = payload.max_track_minutes
    settings.updated_by_user_id = ctx.user.id
    settings.updated_at = datetime.now(timezone.utc)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings
