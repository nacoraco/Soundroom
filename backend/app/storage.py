import hashlib
import os
from pathlib import Path
import tempfile

from fastapi import UploadFile

from .config import Settings

CHUNK_SIZE = 1024 * 1024


class UploadTooLarge(Exception):
    def __init__(self, max_mb: int):
        self.max_mb = max_mb


class EmptyUpload(Exception):
    pass


async def save_upload_to_temp(
    upload: UploadFile, settings: Settings
) -> tuple[Path, str, int]:
    root = Path(settings.media_storage_path)
    temp_dir = root / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    max_bytes = settings.max_upload_mb * 1024 * 1024
    digest = hashlib.sha256()
    size = 0
    temp_path: Path | None = None

    try:
        descriptor, temp_name = tempfile.mkstemp(dir=temp_dir, suffix=".mp3")
        os.close(descriptor)
        temp_path = Path(temp_name)

        with temp_path.open("wb") as output:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLarge(settings.max_upload_mb)
                digest.update(chunk)
                output.write(chunk)

        if size == 0:
            raise EmptyUpload()

        return temp_path, digest.hexdigest(), size
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise
