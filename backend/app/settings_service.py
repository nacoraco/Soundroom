from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import AppSettings

SETTINGS_ID = 1
DEFAULT_AUTO_RIP_ON_MISS = False
DEFAULT_LLM_AUTO_APPROVE = False
DEFAULT_MAX_TRACK_MINUTES = 15


def get_or_create_app_settings(db: Session) -> AppSettings:
    settings = db.get(AppSettings, SETTINGS_ID)
    if settings is not None:
        return settings

    settings = AppSettings(
        id=SETTINGS_ID,
        auto_rip_on_miss=DEFAULT_AUTO_RIP_ON_MISS,
        llm_auto_approve=DEFAULT_LLM_AUTO_APPROVE,
        max_track_minutes=DEFAULT_MAX_TRACK_MINUTES,
    )
    db.add(settings)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        settings = db.get(AppSettings, SETTINGS_ID)
        if settings is None:
            raise
        return settings
    db.refresh(settings)
    return settings
