from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from .audio_processing import (
    AudioProcessingError,
    find_original_file,
    process_audio,
)
from .config import Settings, get_settings
from .db import SessionLocal
from .models import Track

logger = logging.getLogger(__name__)


def _reprocess_track(
    db,
    track: Track,
    media_root: Path,
    settings: Settings,
) -> tuple[int, bool]:
    canonical_path = (media_root / track.file_path).resolve()
    if not canonical_path.is_relative_to(media_root):
        raise AudioProcessingError("Track path is outside media storage.")
    if not canonical_path.is_file():
        raise AudioProcessingError("Track file is missing.")

    original_path = find_original_file(media_root, track.file_path)
    created_original = False
    if original_path is None:
        original_path = (
            media_root / "originals" / f"{canonical_path.stem}.mp3"
        )
        original_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(canonical_path, original_path)
        created_original = True

    processed_path = (
        media_root / ".tmp" / f"reprocess-{canonical_path.stem}.mp3"
    )
    replaced = False
    try:
        result = process_audio(original_path, processed_path, settings)
        os.replace(processed_path, canonical_path)
        replaced = True
        old_duration = track.duration_seconds
        track.duration_seconds = result.duration_seconds
        db.add(track)
        db.commit()
        return old_duration, created_original
    except Exception:
        if created_original and not replaced:
            original_path.unlink(missing_ok=True)
        raise
    finally:
        processed_path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Trim edge silence and normalize loudness for existing tracks. "
            "By default only tracks without a saved original are processed."
        )
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Reprocess every track, including tracks with saved originals.",
    )
    parser.add_argument(
        "--track-id",
        type=UUID,
        help="Process one track by ID.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Process at most this many tracks.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List tracks without changing files or the database.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    settings = get_settings()
    media_root = Path(settings.media_storage_path).resolve()
    media_root.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        statement = (
            select(Track)
            .where(Track.is_available.is_(True))
            .order_by(Track.created_at.asc(), Track.id.asc())
        )
        if args.track_id is not None:
            statement = statement.where(Track.id == args.track_id)
        tracks = list(db.scalars(statement))

        selected: list[Track] = []
        for track in tracks:
            if args.track_id is not None or args.all:
                selected.append(track)
                continue
            if find_original_file(media_root, track.file_path) is None:
                selected.append(track)

        if args.limit is not None:
            selected = selected[: max(1, args.limit)]

        if not selected:
            logger.info("No tracks need audio processing.")
            return 0

        failures = 0
        for index, track in enumerate(selected, start=1):
            label = f"{track.canonical_artist} - {track.canonical_title}"
            if args.dry_run:
                logger.info(
                    "[%s/%s] would process %s (%s)",
                    index,
                    len(selected),
                    label,
                    track.file_path,
                )
                continue
            logger.info(
                "[%s/%s] processing %s (%s)",
                index,
                len(selected),
                label,
                track.file_path,
            )
            try:
                old_duration, _ = _reprocess_track(
                    db,
                    track,
                    media_root,
                    settings,
                )
                logger.info(
                    "[%s/%s] done: %ss -> %ss",
                    index,
                    len(selected),
                    old_duration,
                    track.duration_seconds,
                )
            except Exception as exc:
                db.rollback()
                failures += 1
                logger.error(
                    "[%s/%s] failed for %s: %s",
                    index,
                    len(selected),
                    label,
                    exc,
                )

    if failures:
        logger.error("%s track(s) failed.", failures)
        return 1
    if args.dry_run:
        logger.info("Would process %s track(s).", len(selected))
    else:
        logger.info("Processed %s track(s).", len(selected))
    return 0


if __name__ == "__main__":
    sys.exit(main())
