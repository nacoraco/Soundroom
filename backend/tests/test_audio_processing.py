from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.audio_processing import (
    AudioProcessingError,
    process_audio,
)
from app.config import Settings, get_settings
from app.importer import process_next_job
from app.models import AppSettings, RipJob, RipJobStatus, Track, User
from .utils import auth_headers, login

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg is required for audio processing tests",
)


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    )


def _make_sample(path: Path) -> None:
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            (
                "aevalsrc=if(between(t\\,1\\,3)\\,"
                "0.05*sin(2*PI*440*t)\\,0):s=44100:d=4"
            ),
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(path),
        ]
    )


def _make_one_channel_sample(path: Path) -> None:
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=0|0.05*sin(2*PI*440*t):s=44100:d=4",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "2",
            str(path),
        ]
    )


def _duration(path: Path) -> float:
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
    return float(result.stdout.strip())


def _loudness(path: Path) -> float:
    result = _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostdin",
            "-i",
            str(path),
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
            "-f",
            "null",
            "-",
        ]
    )
    matches = re.findall(
        r"\{[^{}]*\"input_i\"[^{}]*\}",
        result.stderr,
        re.DOTALL,
    )
    assert matches
    values = json.loads(matches[-1])
    return float(values["input_i"])


def test_process_audio_trims_edges_and_normalizes(tmp_path):
    source = tmp_path / "source.mp3"
    destination = tmp_path / "processed.mp3"
    _make_sample(source)
    assert _duration(source) == pytest.approx(4.0, abs=0.1)

    settings = Settings(
        audio_processing_enabled=True,
        audio_trim_silence=True,
        audio_normalize_loudness=True,
        audio_target_lufs=-14.0,
        audio_target_true_peak_db=-1.5,
        audio_target_lra=11.0,
    )
    result = process_audio(source, destination, settings)

    assert destination.is_file()
    assert 2.0 <= _duration(destination) <= 2.6
    assert result.duration_seconds in {2, 3}
    assert _loudness(destination) == pytest.approx(-14.0, abs=0.7)


def test_process_audio_does_not_trim_one_silent_channel(tmp_path):
    source = tmp_path / "one-channel.mp3"
    destination = tmp_path / "processed.mp3"
    _make_one_channel_sample(source)

    settings = Settings(
        audio_processing_enabled=True,
        audio_trim_silence=True,
        audio_normalize_loudness=True,
    )
    result = process_audio(source, destination, settings)

    assert 3.8 <= _duration(destination) <= 4.2
    assert result.duration_seconds == 4


def test_process_audio_rejects_unsafe_trim(tmp_path):
    source = tmp_path / "source.mp3"
    destination = tmp_path / "processed.mp3"
    _make_sample(source)

    settings = Settings(
        audio_processing_enabled=True,
        audio_trim_silence=True,
        audio_normalize_loudness=True,
        audio_max_trim_seconds=0.1,
        audio_min_remaining_ratio=0.95,
    )
    result = process_audio(source, destination, settings)

    assert 3.8 <= _duration(destination) <= 4.2
    assert result.duration_seconds == 4


def test_process_audio_rejects_missing_source(tmp_path):
    settings = Settings(
        audio_processing_enabled=True,
        audio_trim_silence=True,
        audio_normalize_loudness=True,
    )

    with pytest.raises(AudioProcessingError):
        process_audio(
            tmp_path / "missing.mp3",
            tmp_path / "out.mp3",
            settings,
        )


def test_upload_processing_preserves_original(
    client,
    tmp_path,
    monkeypatch,
):
    source = tmp_path / "source.mp3"
    _make_sample(source)
    content = source.read_bytes()
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    monkeypatch.setattr(settings, "audio_processing_enabled", True)
    monkeypatch.setattr(settings, "audio_trim_silence", True)
    monkeypatch.setattr(settings, "audio_normalize_loudness", True)

    login_response = login(client)
    assert login_response.status_code == 200
    headers = auth_headers(login_response.json()["csrf_token"])

    response = client.post(
        "/api/tracks",
        files={"file": ("source.mp3", content, "audio/mpeg")},
        data={"title": "Processed Song", "artist": "Processed Artist"},
        headers=headers,
    )

    assert response.status_code == 201
    track = response.json()
    assert track["duration_seconds"] in {2, 3}
    final_files = list((tmp_path / "tracks").glob("*.mp3"))
    assert len(final_files) == 1
    assert final_files[0].is_file()
    originals = list((tmp_path / "originals").glob("*.mp3"))
    assert len(originals) == 1
    assert originals[0].read_bytes() == content


def test_download_import_processing_preserves_original(
    db_session,
    tmp_path,
    monkeypatch,
):
    source = tmp_path / "download.mp3"
    _make_sample(source)
    content = source.read_bytes()
    settings = get_settings()
    monkeypatch.setattr(settings, "media_storage_path", str(tmp_path))
    monkeypatch.setattr(settings, "audio_processing_enabled", True)
    monkeypatch.setattr(settings, "audio_trim_silence", True)
    monkeypatch.setattr(settings, "audio_normalize_loudness", True)

    admin = db_session.scalar(
        select(User).where(User.email == "admin@example.com")
    )
    assert admin is not None
    db_session.add(
        AppSettings(
            id=1,
            auto_rip_on_miss=True,
            llm_auto_approve=False,
            max_track_minutes=5,
        )
    )
    job = RipJob(
        requested_by_user_id=admin.id,
        query_text="Downloaded Song",
        normalized_query="downloaded song",
        status=RipJobStatus.queued,
        candidate_url="https://example.com/video",
        candidate_title="Downloaded Song",
        candidate_artist="Downloaded Artist",
        candidate_duration_seconds=4,
        source_artist="Downloaded Artist",
        source_title="Downloaded Song",
        expected_duration_seconds=4,
    )
    db_session.add(job)
    db_session.commit()

    def fake_download(candidate, workdir):
        copied = Path(workdir) / "source.mp3"
        copied.write_bytes(content)
        return copied

    monkeypatch.setattr("app.importer.download_candidate", fake_download)

    process_next_job(db_session, settings)
    db_session.refresh(job)

    assert job.status is RipJobStatus.completed
    track = db_session.get(Track, job.track_id)
    assert track is not None
    assert track.duration_seconds == 2
    final_path = tmp_path / track.file_path
    assert final_path.is_file()
    originals = list((tmp_path / "originals").glob("*.mp3"))
    assert len(originals) == 1
    assert originals[0].read_bytes() == content
