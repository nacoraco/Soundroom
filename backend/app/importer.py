from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .audio_processing import process_audio
from .config import Settings, get_settings
from .db import SessionLocal
from .llm_review import review_candidates_with_llm
from . import queue_service
from .models import (
    Artist,
    RipJob,
    RipJobStatus,
    Track,
    TrackSource,
)
from .recommendations import canonical_metadata, song_identity
from .settings_service import get_or_create_app_settings
from .text import normalize_text

logger = logging.getLogger(__name__)

AUTO_APPROVE_MIN_SCORE = 3.0
AUTO_APPROVE_MARGIN = 0.75
VERSION_MARKERS = (
    "live",
    "cover",
    "karaoke",
    "instrumental",
    "remix",
    "reaction",
    "extended",
    "nightcore",
    "slowed",
    "sped up",
    "bbc",
    "session",
    "bluray",
    "blu ray",
    "dvd",
    "webrip",
    "hdrip",
    "1080p",
    "720p",
    "480p",
    "x264",
    "x265",
    "h264",
    "h265",
)
VERSION_MARKER_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(marker) for marker in VERSION_MARKERS) + r")\b",
    re.IGNORECASE,
)
LIVE_PERFORMANCE_PATTERN = re.compile(
    r"(?:[\(\[]\s*[^\)\]]*\b(?:live|concert|performance|performed live|"
    r"unplugged)\b[^\)\]]*[\)\]])"
    r"|(?:\blive\s+(?:at|from|in|on|performance|session|version|recording)\b)"
    r"|(?:\b(?:concert|performed live|unplugged)\b)"
    r"|(?:[-–—|]\s*(?:live|concert|performance)\b)"
    r"|(?:\b(?:live|concert|performance)\s*$)",
    re.IGNORECASE,
)
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")


@dataclass(frozen=True)
class Candidate:
    url: str
    title: str
    artist: str | None
    duration_seconds: int | None
    uploader: str | None = None
    view_count: int | None = None
    video_id: str | None = None
    thumbnail_url: str | None = None


def is_live_performance(candidate: Candidate) -> bool:
    return bool(LIVE_PERFORMANCE_PATTERN.search(candidate.title))


def version_markers(value: str) -> frozenset[str]:
    return frozenset(VERSION_MARKER_PATTERN.findall(normalize_text(value)))


def version_conflict(candidate: Candidate, source_title: str | None) -> bool:
    allowed = version_markers(source_title or "")
    found = version_markers(candidate.title)
    if found - allowed:
        return True
    if is_live_performance(candidate) and not (
        {"live", "concert", "performance", "unplugged"} & allowed
    ):
        return True
    return False


def duration_conflict(
    candidate: Candidate,
    expected_duration_seconds: int | None,
) -> bool:
    if expected_duration_seconds is None or candidate.duration_seconds is None:
        return False
    tolerance = max(15, round(expected_duration_seconds * 0.10))
    return abs(candidate.duration_seconds - expected_duration_seconds) > tolerance


def filter_candidates(
    candidates: list[Candidate],
    source_title: str | None,
    expected_duration_seconds: int | None,
) -> list[Candidate]:
    return [
        candidate
        for candidate in candidates
        if not version_conflict(candidate, source_title)
        and not duration_conflict(candidate, expected_duration_seconds)
    ]


def _candidate_video_id(entry: dict) -> str | None:
    video_id = entry.get("id")
    if isinstance(video_id, str) and VIDEO_ID_PATTERN.fullmatch(video_id):
        return video_id

    url = entry.get("webpage_url") or entry.get("url")
    if not isinstance(url, str):
        return None
    parsed = urlparse(url)
    candidate = (
        parse_qs(parsed.query).get("v", [None])[0]
        if parsed.hostname not in {"youtu.be", "www.youtu.be"}
        else parsed.path.strip("/").split("/")[0]
    )
    if isinstance(candidate, str) and VIDEO_ID_PATTERN.fullmatch(candidate):
        return candidate
    return None


def _candidate_url(entry: dict) -> str | None:
    video_id = _candidate_video_id(entry)
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    url = entry.get("webpage_url") or entry.get("url")
    return str(url) if url else None


def _candidate_artist(title: str, entry: dict) -> str | None:
    artist = entry.get("artist") or entry.get("creator")
    if artist:
        return str(artist)

    if " - " in title:
        prefix = title.split(" - ", 1)[0].strip()
        if 1 <= len(prefix) <= 120:
            return prefix

    channel = entry.get("channel") or entry.get("uploader")
    return str(channel) if channel else None


def _candidate_thumbnail(entry: dict) -> str | None:
    thumbnail = entry.get("thumbnail")
    if not thumbnail:
        thumbnails = entry.get("thumbnails") or []
        candidates = [
            item
            for item in thumbnails
            if isinstance(item, dict) and isinstance(item.get("url"), str)
        ]
        if candidates:
            thumbnail = max(
                candidates,
                key=lambda item: item.get("width") or item.get("height") or 0,
            ).get("url")
    if isinstance(thumbnail, str) and thumbnail.startswith("https://"):
        return thumbnail
    return None


def search_candidates(query: str, limit: int = 5) -> list[Candidate]:
    import yt_dlp

    limit = max(1, min(limit, 10))
    options = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 15,
    }
    search_queries = [query]
    for suffix in ("lyrics", "audio"):
        fallback = f"{query} {suffix}".strip()
        if fallback not in search_queries:
            search_queries.append(fallback)

    candidates: list[Candidate] = []
    seen_urls: set[str] = set()
    with yt_dlp.YoutubeDL(options) as ydl:
        for search_query in search_queries:
            try:
                info = ydl.extract_info(
                    f"ytsearch{limit}:{search_query}", download=False
                )
            except Exception:
                continue
            entries = list(info.get("entries") or []) if info else []
            for entry in entries[:limit]:
                url = _candidate_url(entry)
                title = str(entry.get("track") or entry.get("title") or "")
                artist = _candidate_artist(title, entry)
                duration = entry.get("duration")
                uploader = entry.get("channel") or entry.get("uploader")
                view_count = entry.get("view_count")
                if not url or not title or url in seen_urls:
                    continue
                seen_urls.add(url)
                candidates.append(
                    Candidate(
                        url=url,
                        title=str(title),
                        artist=str(artist) if artist else None,
                        duration_seconds=(
                            int(duration) if duration is not None else None
                        ),
                        uploader=str(uploader) if uploader else None,
                        view_count=(
                            int(view_count) if view_count is not None else None
                        ),
                        video_id=_candidate_video_id(entry),
                        thumbnail_url=_candidate_thumbnail(entry),
                    )
                )
            if len(candidates) >= limit:
                break
    return candidates[:limit]


def _match_score(query: str, candidate: Candidate) -> float:
    normalized_query = normalize_text(query)
    normalized_title = normalize_text(candidate.title)
    normalized_artist = normalize_text(candidate.artist or "")
    haystack = f"{normalized_title} {normalized_artist}"
    tokens = normalized_query.split()
    if not tokens:
        return 0

    hits = sum(1 for token in tokens if token in haystack)
    score = (hits / len(tokens)) * 2
    if normalized_query in normalized_title:
        score += 2
    elif normalized_query in haystack:
        score += 1

    if normalized_artist and normalized_query in normalized_artist:
        score += 0.5

    for marker in VERSION_MARKERS:
        if marker in normalized_title and marker not in normalized_query:
            score -= 0.35

    uploader = normalize_text(candidate.uploader or "")
    if any(
        marker in uploader
        for marker in ("official", "vevo", "topic")
    ):
        score += 0.6
    if candidate.view_count:
        score += min(math.log10(candidate.view_count + 1) / 10, 0.5)

    return max(score, 0)


def rank_candidates(
    query: str,
    candidates: list[Candidate],
    max_seconds: int | None,
) -> list[tuple[float, Candidate]]:
    eligible = [
        candidate
        for candidate in candidates
        if max_seconds is None
        or candidate.duration_seconds is None
        or candidate.duration_seconds <= max_seconds
    ]
    return sorted(
        ((_match_score(query, candidate), candidate) for candidate in eligible),
        key=lambda item: (is_live_performance(item[1]), -item[0]),
    )


def choose_candidate(
    query: str,
    candidates: list[Candidate],
    max_seconds: int,
) -> tuple[Candidate | None, bool]:
    scored = rank_candidates(query, candidates, max_seconds)
    if not scored:
        return None, False

    top_score, top_candidate = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else None
    clear_margin = (
        second_score is None
        or top_score - second_score >= AUTO_APPROVE_MARGIN
    )
    if (
        top_score >= AUTO_APPROVE_MIN_SCORE
        and clear_margin
        and top_candidate.title
        and top_candidate.artist
    ):
        return top_candidate, False
    return top_candidate, True


def download_candidate(candidate: Candidate, workdir: Path) -> Path:
    import yt_dlp

    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "overwrites": True,
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "%(id)s.%(ext)s"),
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        ydl.download([candidate.url])

    files = [
        path
        for path in workdir.iterdir()
        if path.is_file() and path.suffix not in {".part", ".ytdl"}
    ]
    if not files:
        raise RuntimeError("yt-dlp did not produce an audio file.")
    return max(files, key=lambda path: path.stat().st_size)


def convert_to_mp3(source: Path, destination: Path) -> Path:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(destination),
        ],
        check=True,
        capture_output=True,
    )
    if not destination.is_file():
        raise RuntimeError("FFmpeg did not produce an MP3 file.")
    return destination


def probe_duration(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        duration = int(round(float(result.stdout.strip())))
    except ValueError as exc:
        raise RuntimeError("Could not read audio duration.") from exc
    if duration <= 0:
        raise RuntimeError("Audio duration is invalid.")
    return duration


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _candidate_from_job(job: RipJob) -> Candidate:
    if not (
        job.candidate_url
        and job.candidate_title
        and job.candidate_artist
    ):
        raise ValueError("Candidate metadata is incomplete.")
    return Candidate(
        url=job.candidate_url,
        title=job.candidate_title,
        artist=job.candidate_artist,
        duration_seconds=job.candidate_duration_seconds,
    )


def _job_is_cancelled(db: Session, job: RipJob) -> bool:
    db.refresh(job, attribute_names=["status"])
    return job.status is RipJobStatus.cancelled


def _fail_job(db: Session, job_id, message: str) -> None:
    db.rollback()
    job = db.get(RipJob, job_id)
    if job is None or job.status is RipJobStatus.cancelled:
        return
    job.status = RipJobStatus.failed
    job.error_message = message[:1000]
    job.finished_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    queue_service.mark_job_failed(db, job_id, message)


def _publish_download(
    db: Session,
    job: RipJob,
    config: Settings,
    max_track_minutes: int,
) -> None:
    candidate = _candidate_from_job(job)
    max_seconds = max(1, max_track_minutes) * 60
    media_root = Path(config.media_storage_path)
    media_root.mkdir(parents=True, exist_ok=True)

    if _job_is_cancelled(db, job):
        return

    with tempfile.TemporaryDirectory(dir=media_root) as temp_dir:
        workdir = Path(temp_dir)
        source = download_candidate(candidate, workdir)
        if _job_is_cancelled(db, job):
            return
        job.status = RipJobStatus.processing
        db.add(job)
        db.commit()

        mp3_path = workdir / "track.mp3"
        convert_to_mp3(source, mp3_path)
        duration = probe_duration(mp3_path)
        logger.info(
            "Published import audio before post-processing duration=%ss",
            duration,
        )
        if duration > max_seconds:
            raise ValueError(
                "The downloaded track exceeds the configured maximum duration."
            )
        if duration_conflict(
            Candidate(
                url=candidate.url,
                title=candidate.title,
                artist=candidate.artist,
                duration_seconds=duration,
            ),
            job.expected_duration_seconds,
        ):
            raise ValueError(
                "The downloaded recording does not match the expected duration."
            )
        if _job_is_cancelled(db, job):
            return

        storage_id = uuid4().hex
        relative_path = f"tracks/{storage_id}.mp3"
        final_path = media_root / relative_path
        original_suffix = source.suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,8}", original_suffix):
            original_suffix = ".audio"
        original_path = (
            media_root / "originals" / f"{storage_id}{original_suffix}"
        )

        try:
            audio_sha256 = _sha256(mp3_path)
            existing = db.scalar(
                select(Track).where(Track.audio_sha256 == audio_sha256)
            )
            if existing is not None:
                job.track_id = existing.id
                job.status = RipJobStatus.completed
                job.error_message = None
                job.finished_at = datetime.now(timezone.utc)
                db.add(job)
                db.commit()
                queue_service.mark_job_ready(db, job.id, existing.id)
                return

            final_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(mp3_path), final_path)
            if config.audio_processing_enabled:
                original_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, original_path)

            source_artist = job.source_artist or candidate.artist or ""
            source_title = job.source_title or candidate.title
            display_artist, display_title = canonical_metadata(
                source_artist, source_title
            )
            if not display_artist or not display_title:
                raise ValueError("Candidate title or artist is empty.")

            normalized_artist = normalize_text(display_artist)
            normalized_title = normalize_text(display_title)
            artist = db.scalar(
                select(Artist).where(
                    Artist.normalized_name == normalized_artist
                )
            )
            if artist is None:
                artist = Artist(
                    name=display_artist,
                    normalized_name=normalized_artist,
                )
                db.add(artist)
                db.flush()

            track = Track(
                artist_id=artist.id,
                album_id=None,
                title=display_title,
                normalized_title=normalized_title,
                canonical_artist=display_artist,
                canonical_title=display_title,
                recording_key=song_identity(source_artist, source_title),
                duration_seconds=duration,
                file_path=relative_path,
                mime_type="audio/mpeg",
                source_type=TrackSource.youtube,
                source_url=candidate.url,
                audio_sha256=audio_sha256,
                is_available=True,
            )
            db.add(track)
            db.flush()
            job.track_id = track.id
            job.status = RipJobStatus.completed
            job.error_message = None
            job.finished_at = datetime.now(timezone.utc)
            db.add(job)
            db.commit()
            queue_service.mark_job_ready(db, job.id, track.id)
        except Exception:
            db.rollback()
            final_path.unlink(missing_ok=True)
            original_path.unlink(missing_ok=True)
            raise

        if config.audio_processing_enabled:
            job_id = job.id
            track_id = job.track_id
            processed_path = workdir / "processed.mp3"
            try:
                processed = process_audio(source, processed_path, config)
                os.replace(processed_path, final_path)
                if track_id is not None:
                    track = db.get(Track, track_id)
                    if track is not None:
                        track.duration_seconds = processed.duration_seconds
                        db.add(track)
                        db.commit()
                        queue_service.mark_job_ready(
                            db,
                            job_id,
                            track.id,
                        )
                logger.info(
                    "Post-processed import track=%s duration=%ss input_lufs=%s",
                    track_id,
                    processed.duration_seconds,
                    processed.input_lufs,
                )
            except Exception:
                db.rollback()
                logger.exception(
                    "Post-processing failed for track %s; keeping fast version",
                    track_id,
                )
            finally:
                processed_path.unlink(missing_ok=True)


def process_job(
    db: Session,
    job: RipJob,
    config: Settings,
    max_track_minutes: int,
    llm_auto_approve: bool = False,
) -> None:
    job_id = job.id
    try:
        if _job_is_cancelled(db, job):
            return
        if job.status is RipJobStatus.searching:
            candidates = search_candidates(job.query_text)
            if _job_is_cancelled(db, job):
                return
            unfiltered_count = len(candidates)
            candidates = filter_candidates(
                candidates,
                job.source_title,
                job.expected_duration_seconds,
            )
            max_seconds = max(1, max_track_minutes) * 60
            ranked = rank_candidates(job.query_text, candidates, max_seconds)
            candidate, ambiguous = choose_candidate(
                job.query_text, candidates, max_seconds
            )
            if candidate is None:
                if unfiltered_count and not candidates:
                    message = (
                        "No suitable version matched the requested recording "
                        "(live, cover, remix, karaoke, or wrong duration)."
                    )
                elif not candidates:
                    message = (
                        "No external search results found for this track."
                    )
                else:
                    message = (
                        "No candidate within the "
                        f"{max(1, max_track_minutes)}-minute duration limit "
                        f"({len(candidates)} result(s) checked)."
                    )
                logger.warning(
                    "Import job %s found no suitable candidate for %r "
                    "(%d search results)",
                    job_id,
                    job.query_text,
                    len(candidates),
                )
                _fail_job(db, job_id, message)
                return

            llm_attempted = False
            if ambiguous and llm_auto_approve:
                llm_attempted = True
                eligible = [item[1] for item in ranked]
                review_candidates = [
                    item for item in eligible if not is_live_performance(item)
                ] or eligible
                decision = review_candidates_with_llm(
                    job.query_text, review_candidates, config
                )
                if decision is not None:
                    candidate = review_candidates[decision.candidate_index]
                    ambiguous = False
                    logger.info(
                        "LLM auto-approved import job %s with confidence %.2f: %s",
                        job_id,
                        decision.confidence,
                        decision.reason,
                    )
                else:
                    logger.warning(
                        "LLM review for import job %s returned no decision; "
                        "editor review required",
                        job_id,
                    )

            job.candidate_url = candidate.url
            job.candidate_title = candidate.title
            job.candidate_artist = candidate.artist
            job.candidate_duration_seconds = candidate.duration_seconds
            if ambiguous:
                job.status = RipJobStatus.needs_review
                job.error_message = (
                    "Ambiguous match; LLM review unavailable or inconclusive. "
                    "Editor review required."
                    if llm_attempted
                    else "Ambiguous match; editor review required."
                )
                db.add(job)
                db.commit()
                return

            if _job_is_cancelled(db, job):
                return
            job.status = RipJobStatus.downloading
            db.add(job)
            db.commit()

        if _job_is_cancelled(db, job):
            return
        if job.status is not RipJobStatus.downloading:
            return

        _publish_download(db, job, config, max_track_minutes)
    except Exception as exc:
        logger.exception("Import job %s failed", job_id)
        _fail_job(db, job_id, str(exc))


def claim_next_job(db: Session) -> RipJob | None:
    statement = (
        select(RipJob)
        .where(RipJob.status == RipJobStatus.queued)
        .order_by(RipJob.created_at.asc())
        .limit(1)
    )
    if db.get_bind().dialect.name != "sqlite":
        statement = statement.with_for_update(skip_locked=True)
    job = db.scalar(statement)
    if job is None:
        return None

    job.started_at = datetime.now(timezone.utc)
    if job.candidate_url:
        job.status = RipJobStatus.downloading
    else:
        job.status = RipJobStatus.searching
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def process_next_job(
    db: Session,
    config: Settings | None = None,
) -> RipJob | None:
    runtime_config = config or get_settings()
    app_settings = get_or_create_app_settings(db)
    job = claim_next_job(db)
    if job is None:
        return None
    process_job(
        db,
        job,
        runtime_config,
        app_settings.max_track_minutes,
        app_settings.llm_auto_approve or job.force_llm_approval,
    )
    return job


def run_worker() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    while True:
        try:
            with SessionLocal() as db:
                job = process_next_job(db)
                if job is None:
                    time.sleep(0.25)
        except Exception:
            logger.exception("Import worker loop failed")
            time.sleep(2)


if __name__ == "__main__":
    run_worker()
