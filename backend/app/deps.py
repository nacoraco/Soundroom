from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .config import Settings, get_settings
from .db import get_db
from .models import User, UserRole, UserSession
from .security import csrf_matches, derive_csrf_token, hash_session_token


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: UserSession
    session_token: str
    csrf_token: str


def _unauthorized(detail: str = "Authentication required") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Cookie"},
    )


def get_current_auth(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthContext:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    token_hash = hash_session_token(token)
    session = db.scalar(
        select(UserSession)
        .options(joinedload(UserSession.user))
        .where(UserSession.token_hash == token_hash)
    )
    if (
        session is None
        or session.revoked_at is not None
        or session.user is None
        or not session.user.is_active
    ):
        raise _unauthorized("Session is invalid or expired")

    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise _unauthorized("Session is invalid or expired")

    return AuthContext(
        user=session.user,
        session=session,
        session_token=token,
        csrf_token=derive_csrf_token(token, settings.app_secret_key),
    )


def get_current_user(ctx: AuthContext = Depends(get_current_auth)) -> User:
    return ctx.user


def require_roles(*roles: UserRole):
    def dependency(ctx: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if ctx.user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return ctx

    return dependency


def require_csrf(
    ctx: AuthContext = Depends(get_current_auth),
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> AuthContext:
    if not csrf_matches(x_csrf_token, ctx.csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid CSRF token",
        )
    return ctx
