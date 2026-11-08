from pathlib import Path

from mutagen.id3 import TALB, TDRC, TIT2, TPE1
from mutagen.mp3 import MP3

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password"

MP3_FRAME = b"\xff\xfb\x90\x64" + b"\x00" * 413


def make_mp3(
    path: Path,
    *,
    with_tags: bool = True,
    title: str = "Test Title",
    artist: str = "Test Artist",
    album: str = "Test Album",
    year: int = 2026,
) -> bytes:
    path.write_bytes(MP3_FRAME * 20)
    if with_tags:
        audio = MP3(path)
        audio.add_tags()
        audio.tags.add(TIT2(encoding=3, text=title))
        audio.tags.add(TPE1(encoding=3, text=artist))
        audio.tags.add(TALB(encoding=3, text=album))
        audio.tags.add(TDRC(encoding=3, text=str(year)))
        audio.save()
    return path.read_bytes()


def login(client, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )


def auth_headers(csrf_token: str) -> dict[str, str]:
    return {"X-CSRF-Token": csrf_token}
