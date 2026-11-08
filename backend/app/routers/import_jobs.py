from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..models import ACTIVE_RIP_JOB_STATUSES, RipJob, RipJobStatus
from ..schemas import (
    ImportJobConfig,
    ImportJobCreate,
    ImportJobOut,
)
from ..settings_service import get_or_create_app_settings
from ..text import normalize_text

router = APIRouter(prefix="/api/import-jobs", tags=["import-jobs"])


@router.get("/config", response_model=ImportJobConfig)
def import_config(
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ImportJobConfig:
    settings = get_or_create_app_settings(db)
    return ImportJobConfig(
        auto_rip_on_miss=settings.auto_rip_on_miss,
        max_track_minutes=settings.max_track_minutes,
    )


@router.post("", response_model=ImportJobOut)
def create_import_job(
    payload: ImportJobCreate,
    ctx: AuthContext = Depends(get_current_auth),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    settings = get_or_create_app_settings(db)
    if not settings.auto_rip_on_miss:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Automatic import is disabled.",
        )

    normalized_query = normalize_text(payload.query)
    if len(normalized_query) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter at least 3 characters.",
        )

    existing = db.scalar(
        select(RipJob)
        .where(
            RipJob.normalized_query == normalized_query,
            RipJob.status.in_(ACTIVE_RIP_JOB_STATUSES),
        )
        .order_by(RipJob.created_at.desc())
        .limit(1)
    )
    if existing is not None:
        return existing

    job = RipJob(
        requested_by_user_id=ctx.user.id,
        query_text=payload.query,
        normalized_query=normalized_query,
        status=RipJobStatus.queued,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/{job_id}", response_model=ImportJobOut)
def get_import_job(
    job_id: UUID,
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> RipJob:
    job = db.get(RipJob, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Import job not found.",
        )
    return job
