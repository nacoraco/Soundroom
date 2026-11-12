from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ACTIVE_RIP_JOB_STATUSES, RipJob, RipJobStatus, Track
from .recommendations import canonical_metadata, song_identity
from .settings_service import get_or_create_app_settings
from .text import normalize_text


class ImportDisabledError(Exception):
    pass


class ImportValidationError(Exception):
    pass


def create_job(
    db: Session,
    *,
    user_id: UUID,
    query: str,
    candidate_url: str | None = None,
    candidate_title: str | None = None,
    candidate_artist: str | None = None,
    candidate_duration_seconds: int | None = None,
    force_llm_approval: bool = False,
    source_artist: str | None = None,
    source_title: str | None = None,
    expected_duration_seconds: int | None = None,
    recording_key: str | None = None,
    check_auto_rip: bool = True,
) -> RipJob:
    settings = get_or_create_app_settings(db)
    if check_auto_rip and not settings.auto_rip_on_miss:
        raise ImportDisabledError("Automatic import is disabled.")

    normalized_query = normalize_text(query)
    if len(normalized_query) < 3:
        raise ImportValidationError("Enter at least 3 characters.")

    if candidate_duration_seconds is not None:
        max_seconds = max(1, settings.max_track_minutes) * 60
        if candidate_duration_seconds > max_seconds:
            raise ImportValidationError(
                "The selected release exceeds the configured maximum "
                "track duration."
            )

    if source_artist and source_title:
        source_artist, source_title = canonical_metadata(
            source_artist, source_title
        )
    recording_key = (
        recording_key
        or (
            song_identity(source_artist, source_title)
            if source_artist and source_title
            else None
        )
    )

    if recording_key:
        existing_track = db.scalar(
            select(Track).where(
                Track.recording_key == recording_key,
                Track.is_available.is_(True),
            )
        )
        if existing_track is not None:
            completed = RipJob(
                requested_by_user_id=user_id,
                query_text=query,
                normalized_query=normalized_query,
                status=RipJobStatus.completed,
                source_artist=source_artist,
                source_title=source_title,
                expected_duration_seconds=expected_duration_seconds,
                recording_key=recording_key,
                track_id=existing_track.id,
                finished_at=datetime.now(timezone.utc),
            )
            db.add(completed)
            db.commit()
            db.refresh(completed)
            return completed

        existing_key = db.scalar(
            select(RipJob)
            .where(
                RipJob.recording_key == recording_key,
                RipJob.status.in_(ACTIVE_RIP_JOB_STATUSES),
            )
            .order_by(RipJob.created_at.desc())
            .limit(1)
        )
        if existing_key is not None:
            return existing_key

    existing_statement = select(RipJob).where(
        RipJob.normalized_query == normalized_query,
        RipJob.status.in_(ACTIVE_RIP_JOB_STATUSES),
    )
    if candidate_url is not None:
        existing_statement = existing_statement.where(
            RipJob.candidate_url == candidate_url
        )
    else:
        existing_statement = existing_statement.where(
            RipJob.candidate_url.is_(None)
        )
    existing = db.scalar(
        existing_statement.order_by(RipJob.created_at.desc()).limit(1)
    )
    if existing is not None:
        return existing

    job = RipJob(
        requested_by_user_id=user_id,
        query_text=query,
        normalized_query=normalized_query,
        status=RipJobStatus.queued,
        force_llm_approval=force_llm_approval,
        source_artist=source_artist,
        source_title=source_title,
        expected_duration_seconds=expected_duration_seconds,
        recording_key=recording_key,
    )
    if candidate_url is not None:
        job.candidate_url = candidate_url
        job.candidate_title = candidate_title
        job.candidate_artist = candidate_artist
        job.candidate_duration_seconds = candidate_duration_seconds
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
