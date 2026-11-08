from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, require_csrf, require_roles
from ..models import RipJob, RipJobStatus, UserRole
from ..schemas import ImportJobOut, ImportJobUpdate

router = APIRouter(prefix="/api/editor/import-jobs", tags=["editor"])


def _get_review_job(db: Session, job_id: UUID) -> RipJob:
    job = db.get(RipJob, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Import job not found.",
        )
    if job.status is not RipJobStatus.needs_review:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only jobs awaiting review can be changed.",
        )
    return job


@router.get("", response_model=list[ImportJobOut])
def list_import_jobs(
    status_filter: RipJobStatus | None = Query(default=None, alias="status"),
    _: AuthContext = Depends(require_roles(UserRole.editor, UserRole.admin)),
    db: Session = Depends(get_db),
) -> list[RipJob]:
    statement = select(RipJob).order_by(RipJob.created_at.desc())
    if status_filter is not None:
        statement = statement.where(RipJob.status == status_filter)
    return list(db.scalars(statement).all())


@router.patch("/{job_id}", response_model=ImportJobOut)
def update_import_job(
    job_id: UUID,
    payload: ImportJobUpdate,
    _: AuthContext = Depends(require_roles(UserRole.editor, UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    job = _get_review_job(db, job_id)
    if payload.candidate_title is not None:
        job.candidate_title = payload.candidate_title
    if payload.candidate_artist is not None:
        job.candidate_artist = payload.candidate_artist
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/approve", response_model=ImportJobOut)
def approve_import_job(
    job_id: UUID,
    _: AuthContext = Depends(require_roles(UserRole.editor, UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    job = _get_review_job(db, job_id)
    if not (
        job.candidate_url
        and job.candidate_title
        and job.candidate_artist
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Candidate title, artist and URL are required.",
        )

    job.status = RipJobStatus.queued
    job.error_message = None
    job.started_at = None
    job.finished_at = None
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/reject", response_model=ImportJobOut)
def reject_import_job(
    job_id: UUID,
    _: AuthContext = Depends(require_roles(UserRole.editor, UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    job = _get_review_job(db, job_id)
    job.status = RipJobStatus.cancelled
    job.error_message = "Rejected by editor."
    job.finished_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
