from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..deps import AuthContext, get_current_auth, require_csrf
from ..models import User, UserSession
from ..schemas import AuthResponse, LoginRequest, UserOut
from ..security import (
    derive_csrf_token,
    generate_session_token,
    hash_session_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))

    if user is None or not verify_password(user.password_hash, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Cookie"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled.",
        )

    session_token = generate_session_token()
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.session_ttl_hours
    )
    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(session_token),
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()

    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )

    return AuthResponse(
        user=UserOut.model_validate(user),
        csrf_token=derive_csrf_token(session_token, settings.app_secret_key),
    )


@router.get("/me", response_model=AuthResponse)
def me(ctx: AuthContext = Depends(get_current_auth)) -> AuthResponse:
    return AuthResponse(
        user=UserOut.model_validate(ctx.user),
        csrf_token=ctx.csrf_token,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    ctx: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    ctx.session.revoked_at = datetime.now(timezone.utc)
    db.add(ctx.session)
    db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(key=settings.session_cookie_name, path="/")
    return response
