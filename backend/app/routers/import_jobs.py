import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import import_service, queue_service
from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..importer import rank_candidates, search_candidates
from ..models import RipJob, RipJobStatus, UserRole
from ..schemas import (
    ImportJobConfig,
    ImportJobCreate,
    ImportJobOut,
    ImportPreview,
    ImportPreviewCandidate,
)
from ..settings_service import get_or_create_app_settings
from ..text import normalize_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/import-jobs", tags=["import-jobs"])
PREVIEW_LIMIT = 8


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


@router.get("/preview", response_model=ImportPreview)
def preview_import_candidates(
    q: str = Query(min_length=3, max_length=300),
    _: AuthContext = Depends(get_current_auth),
    db: Session = Depends(get_db),
) -> ImportPreview:
    settings = get_or_create_app_settings(db)
    if not settings.auto_rip_on_miss:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Automatic import is disabled.",
        )

    query_text = q.strip()
    if len(normalize_text(query_text)) < 3:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter at least 3 characters.",
        )

    try:
        candidates = search_candidates(query_text, limit=PREVIEW_LIMIT)
    except Exception as exc:
        logger.exception("External import preview failed for %r", query_text)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="External search failed. Try again.",
        ) from exc

    max_seconds = max(1, settings.max_track_minutes) * 60
    ranked = rank_candidates(query_text, candidates, None)
    preview_candidates: list[ImportPreviewCandidate] = []
    for _, candidate in ranked:
        if candidate.video_id is None:
            continue
        duration = candidate.duration_seconds
        preview_candidates.append(
            ImportPreviewCandidate(
                video_id=candidate.video_id,
                url=candidate.url,
                title=candidate.title,
                artist=candidate.artist or candidate.uploader or "Unknown artist",
                uploader=candidate.uploader,
                duration_seconds=duration,
                view_count=candidate.view_count,
                thumbnail_url=candidate.thumbnail_url,
                within_duration_limit=(
                    duration is not None and 0 < duration <= max_seconds
                ),
            )
        )

    return ImportPreview(
        query=query_text,
        max_track_minutes=settings.max_track_minutes,
        candidates=preview_candidates,
    )


@router.post("", response_model=ImportJobOut)
def create_import_job(
    payload: ImportJobCreate,
    ctx: AuthContext = Depends(get_current_auth),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    candidate_url: str | None = None
    if payload.candidate is not None:
        candidate_url = (
            "https://www.youtube.com/watch?v="
            f"{payload.candidate.video_id}"
        )

    try:
        return import_service.create_job(
            db,
            user_id=ctx.user.id,
            query=payload.query,
            candidate_url=candidate_url,
            candidate_title=(
                payload.candidate.title
                if payload.candidate is not None
                else None
            ),
            candidate_artist=(
                payload.candidate.artist
                if payload.candidate is not None
                else None
            ),
            candidate_duration_seconds=(
                payload.candidate.duration_seconds
                if payload.candidate is not None
                else None
            ),
            force_llm_approval=payload.force_llm_approval,
            source_artist=payload.source_artist,
            source_title=payload.source_title,
            expected_duration_seconds=payload.expected_duration_seconds,
            recording_key=payload.recording_key,
        )
    except import_service.ImportDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except import_service.ImportValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


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


@router.post("/{job_id}/cancel", response_model=ImportJobOut)
def cancel_import_job(
    job_id: UUID,
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> RipJob:
    job = db.get(RipJob, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Import job not found.",
        )
    if (
        job.requested_by_user_id != ctx.user.id
        and ctx.user.role not in (UserRole.editor, UserRole.admin)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )
    if job.status in (
        RipJobStatus.completed,
        RipJobStatus.failed,
        RipJobStatus.cancelled,
    ):
        return job
    job.status = RipJobStatus.cancelled
    job.finished_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    queue_service.mark_job_failed(db, job.id, "Cancelled")
    db.refresh(job)
    return job
