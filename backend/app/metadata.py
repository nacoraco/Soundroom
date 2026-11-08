from dataclasses import dataclass
from pathlib import Path
import re

from mutagen import MutagenError
from mutagen.mp3 import MP3


class InvalidMp3Error(ValueError):
    pass


@dataclass(frozen=True)
class AudioMetadata:
    title: str | None
    artist: str | None
    album: str | None
    release_year: int | None
    duration_seconds: int


def _tag_text(tags, key: str) -> str | None:
    if tags is None:
        return None
    frame = tags.get(key)
    if frame is None:
        return None
    values = getattr(frame, "text", None)
    if not values:
        return None
    value = str(values[0]).strip()
    return value or None


def _release_year(tags) -> int | None:
    value = _tag_text(tags, "TDRC") or _tag_text(tags, "TYER")
    if not value:
        return None
    match = re.search(r"\d{4}", value)
    if not match:
        return None
    year = int(match.group(0))
    return year if 1900 <= year <= 2100 else None


def read_mp3_metadata(path: Path) -> AudioMetadata:
    try:
        audio = MP3(path)
    except (MutagenError, EOFError, OSError) as exc:
        raise InvalidMp3Error("The file is not a valid MP3.") from exc

    duration_seconds = int(round(audio.info.length))
    if duration_seconds <= 0:
        raise InvalidMp3Error("The MP3 has no playable audio.")

    return AudioMetadata(
        title=_tag_text(audio.tags, "TIT2"),
        artist=_tag_text(audio.tags, "TPE1"),
        album=_tag_text(audio.tags, "TALB"),
        release_year=_release_year(audio.tags),
        duration_seconds=duration_seconds,
    )
