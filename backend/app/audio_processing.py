from __future__ import annotations

import json
import logging
import math
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import Settings

logger = logging.getLogger(__name__)


class AudioProcessingError(RuntimeError):
    pass


@dataclass(frozen=True)
class AudioProcessingResult:
    duration_seconds: int
    input_lufs: float | None = None


_LOUDNESS_JSON = re.compile(
    r"\{[^{}]*\"input_i\"[^{}]*\}",
    re.DOTALL,
)


def _number(value: float) -> str:
    return f"{value:g}"


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise AudioProcessingError(
            f"Required audio tool is not installed: {command[0]}"
        ) from exc
    except subprocess.CalledProcessError as exc:
        output = (exc.stderr or exc.stdout or "").strip()
        detail = output.splitlines()[-1] if output else "unknown error"
        raise AudioProcessingError(f"Audio processing failed: {detail}") from exc


_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


def _silence_intervals(
    source: Path,
    settings: Settings,
    duration: int,
) -> list[tuple[float, float]]:
    result = _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-af",
            (
                "silencedetect="
                f"noise={_number(settings.audio_silence_threshold_db)}dB:"
                f"d={_number(settings.audio_silence_min_duration_seconds)}"
            ),
            "-f",
            "null",
            "-",
        ]
    )
    intervals: list[tuple[float, float]] = []
    current_start: float | None = None
    for line in result.stderr.splitlines():
        start_match = _SILENCE_START.search(line)
        if start_match is not None:
            current_start = float(start_match.group(1))
            continue
        end_match = _SILENCE_END.search(line)
        if end_match is not None and current_start is not None:
            intervals.append((current_start, float(end_match.group(1))))
            current_start = None
    if current_start is not None:
        intervals.append((current_start, float(duration)))
    return intervals


def _trim_filter(
    source: Path,
    settings: Settings,
    duration: int,
) -> str | None:
    intervals = _silence_intervals(source, settings, duration)
    if not intervals:
        return None

    padding = settings.audio_silence_padding_seconds
    start = 0.0
    end = float(duration)
    if intervals[0][0] <= 0.05:
        start = max(0.0, intervals[0][1] - padding)
    if intervals[-1][1] >= duration - 0.05:
        end = min(float(duration), intervals[-1][0] + padding)

    if start <= 0.0 and end >= duration:
        return None
    if start >= end:
        return None
    if start > settings.audio_max_trim_seconds:
        return None
    if duration - end > settings.audio_max_trim_seconds:
        return None
    if end - start < duration * settings.audio_min_remaining_ratio:
        return None
    return f"atrim=start={start:.3f}:end={end:.3f}"


def _analysis_filter(settings: Settings) -> str:
    return (
        f"loudnorm=I={_number(settings.audio_target_lufs)}:"
        f"TP={_number(settings.audio_target_true_peak_db)}:"
        f"LRA={_number(settings.audio_target_lra)}:"
        "print_format=json"
    )


def _measure_loudness(
    source: Path,
    filters: list[str],
    settings: Settings,
) -> dict[str, str]:
    filter_chain = ",".join([*filters, _analysis_filter(settings)])
    result = _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-i",
            str(source),
            "-af",
            filter_chain,
            "-f",
            "null",
            "-",
        ]
    )
    match = _LOUDNESS_JSON.search(result.stderr)
    if match is None:
        raise AudioProcessingError(
            "Could not measure audio loudness."
        )
    try:
        values = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise AudioProcessingError(
            "Could not parse audio loudness measurements."
        ) from exc
    if not isinstance(values, dict):
        raise AudioProcessingError("Invalid audio loudness measurements.")
    return {str(key): str(value) for key, value in values.items()}


def _finite(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _normalization_filter(
    settings: Settings,
    measurements: dict[str, str],
) -> str:
    parts = [
        f"loudnorm=I={_number(settings.audio_target_lufs)}",
        f"TP={_number(settings.audio_target_true_peak_db)}",
        f"LRA={_number(settings.audio_target_lra)}",
    ]
    measured_fields = (
        ("measured_I", "input_i"),
        ("measured_TP", "input_tp"),
        ("measured_LRA", "input_lra"),
        ("measured_thresh", "input_thresh"),
        ("offset", "target_offset"),
    )
    for target, source_key in measured_fields:
        value = _finite(measurements.get(source_key))
        if value is None:
            raise AudioProcessingError(
                "Audio loudness measurement is incomplete."
            )
        parts.append(f"{target}={_number(value)}")
    parts.append("linear=true")
    return ":".join(parts)


def probe_duration(path: Path) -> int:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
    )
    try:
        duration = int(round(float(result.stdout.strip())))
    except ValueError as exc:
        raise AudioProcessingError(
            "Could not read processed audio duration."
        ) from exc
    if duration <= 0:
        raise AudioProcessingError(
            "Processed audio has an invalid duration."
        )
    return duration


def _encode(
    source: Path,
    destination: Path,
    settings: Settings,
    *,
    trim_filter: str | None,
) -> AudioProcessingResult:
    filters: list[str] = []
    input_lufs: float | None = None
    if trim_filter is not None:
        filters.append(trim_filter)
    if settings.audio_normalize_loudness:
        measurements = _measure_loudness(source, filters, settings)
        input_lufs = _finite(measurements.get("input_i"))
        filters.append(_normalization_filter(settings, measurements))

    command = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-map",
        "0:a:0",
    ]
    if filters:
        command.extend(["-af", ",".join(filters)])
    command.extend(
        [
            "-codec:a",
            "libmp3lame",
            "-q:a",
            str(max(0, min(9, settings.audio_mp3_quality))),
            "-map_metadata",
            "0",
            "-id3v2_version",
            "3",
            str(destination),
        ]
    )
    _run(command)

    if not destination.is_file() or destination.stat().st_size == 0:
        raise AudioProcessingError(
            "FFmpeg did not produce a processed audio file."
        )
    return AudioProcessingResult(
        duration_seconds=probe_duration(destination),
        input_lufs=input_lufs,
    )


def _trim_is_unsafe(
    source_duration: int,
    processed_duration: int,
    settings: Settings,
) -> bool:
    removed = source_duration - processed_duration
    return (
        processed_duration
        < source_duration * settings.audio_min_remaining_ratio
        or removed > settings.audio_max_trim_seconds
    )


def process_audio(
    source: Path,
    destination: Path,
    settings: Settings,
) -> AudioProcessingResult:
    source = Path(source)
    destination = Path(destination)
    if not source.is_file() or source.stat().st_size == 0:
        raise AudioProcessingError("Audio source file is missing or empty.")
    destination.parent.mkdir(parents=True, exist_ok=True)

    trim_filter: str | None = None
    source_duration: int | None = None
    if settings.audio_trim_silence:
        source_duration = probe_duration(source)
        try:
            trim_filter = _trim_filter(
                source,
                settings,
                source_duration,
            )
        except AudioProcessingError:
            logger.warning(
                "Silence detection failed for %s; using no trim",
                source,
            )

    try:
        result = _encode(
            source,
            destination,
            settings,
            trim_filter=trim_filter,
        )
    except AudioProcessingError:
        if trim_filter is None:
            raise
        logger.warning(
            "Trimming failed for %s; retrying without silence trim",
            source,
        )
        return _encode(
            source,
            destination,
            settings,
            trim_filter=None,
        )

    if (
        trim_filter is not None
        and source_duration is not None
        and _trim_is_unsafe(
            source_duration,
            result.duration_seconds,
            settings,
        )
    ):
        logger.warning(
            "Silence trim removed too much from %s (%ss -> %ss); "
            "retrying without trim",
            source,
            source_duration,
            result.duration_seconds,
        )
        return _encode(
            source,
            destination,
            settings,
            trim_filter=None,
        )

    return result


def find_original_file(
    media_root: Path,
    canonical_relative_path: str,
) -> Path | None:
    stem = Path(canonical_relative_path).stem
    matches = sorted((Path(media_root) / "originals").glob(f"{stem}.*"))
    return matches[0] if matches else None
