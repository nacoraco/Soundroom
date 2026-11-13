from __future__ import annotations

import json
import math
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import Settings


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


def _trim_filter(settings: Settings) -> str:
    threshold = _number(settings.audio_silence_threshold_db)
    padding = _number(settings.audio_silence_padding_seconds)
    return (
        "silenceremove="
        "start_periods=1:start_duration=0:"
        f"start_threshold={threshold}dB:start_silence={padding}:"
        "stop_periods=1:stop_duration=0:"
        f"stop_threshold={threshold}dB:stop_silence={padding}"
    )


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

    filters: list[str] = []
    input_lufs: float | None = None
    if settings.audio_trim_silence:
        filters.append(_trim_filter(settings))
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


def find_original_file(
    media_root: Path,
    canonical_relative_path: str,
) -> Path | None:
    stem = Path(canonical_relative_path).stem
    matches = sorted((Path(media_root) / "originals").glob(f"{stem}.*"))
    return matches[0] if matches else None
