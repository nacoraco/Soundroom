from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import AuthContext, require_csrf, require_roles
from ..models import User, UserRole, UserSession
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password

router = APIRouter(prefix="/api/admin/users", tags=["admin"])


@router.get("", response_model=list[UserOut])
def list_users(
    _: AuthContext = Depends(require_roles(UserRole.admin)),
    db: Session = Depends(get_db),
) -> list[User]:
    return list(db.scalars(select(User).order_by(User.email)).all())


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _: AuthContext = Depends(require_roles(UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> User:
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    user = User(
        email=email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    ctx: AuthContext = Depends(require_roles(UserRole.admin)),
    __: AuthContext = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    is_self = user.id == ctx.user.id
    if is_self and (payload.role is not None or payload.is_active is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role or active status.",
        )

    if not is_self and user.role is UserRole.admin and (
        payload.role is not None or payload.is_active is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts cannot be modified.",
        )

    if payload.display_name is not None:
        user.display_name = payload.display_name
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not payload.is_active:
            db.execute(
                update(UserSession)
                .where(
                    UserSession.user_id == user.id,
                    UserSession.revoked_at.is_(None),
                )
                .values(revoked_at=datetime.now(timezone.utc))
            )

    db.add(user)
    db.commit()
    db.refresh(user)
    return user
