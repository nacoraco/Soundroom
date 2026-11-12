from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from .models import LastfmCache

T = TypeVar("T")

DEFAULT_TTL_SECONDS = 24 * 60 * 60
MAX_KEY_LENGTH = 500


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def cache_get(db: Session, key: str) -> Any | None:
    entry = db.get(LastfmCache, key[:MAX_KEY_LENGTH])
    if entry is None:
        return None
    if _as_utc(entry.expires_at) <= datetime.now(timezone.utc):
        db.delete(entry)
        db.commit()
        return None
    try:
        return json.loads(entry.payload)
    except (TypeError, ValueError):
        db.delete(entry)
        db.commit()
        return None


def cache_set(
    db: Session,
    key: str,
    payload: Any,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> None:
    now = datetime.now(timezone.utc)
    entry = LastfmCache(
        key=key[:MAX_KEY_LENGTH],
        payload=json.dumps(payload, separators=(",", ":")),
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )
    db.merge(entry)
    db.commit()


def cached_call(
    db: Session,
    key: str,
    loader: Callable[[], T],
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> T:
    cached = cache_get(db, key)
    if cached is not None:
        return cached
    value = loader()
    cache_set(db, key, value, ttl_seconds)
    return value
