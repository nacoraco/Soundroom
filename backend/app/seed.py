from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import SessionLocal
from .models import User, UserRole
from .security import hash_password


def seed_initial_admin(db: Session | None = None) -> None:
    settings = get_settings()
    owns_session = db is None
    if db is None:
        db = SessionLocal()

    try:
        if db.scalar(select(User).where(User.role == UserRole.admin)) is not None:
            print("Initial admin already exists; nothing to do.")
            return

        email = settings.initial_admin_email.lower()
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                display_name=settings.initial_admin_display_name,
                password_hash=hash_password(settings.initial_admin_password),
                role=UserRole.admin,
                is_active=True,
            )
            db.add(user)
            print(f"Created initial admin {email}.")
        else:
            user.role = UserRole.admin
            user.is_active = True
            db.add(user)
            print(f"Promoted existing user {email} to admin.")
        db.commit()
    finally:
        if owns_session:
            db.close()


def seed_initial_listener(db: Session | None = None) -> None:
    settings = get_settings()
    email = settings.initial_listener_email.strip().lower()
    if not email:
        return

    owns_session = db is None
    if db is None:
        db = SessionLocal()

    try:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            print("Initial listener already exists; nothing to do.")
            return

        user = User(
            email=email,
            display_name=settings.initial_listener_display_name,
            password_hash=hash_password(settings.initial_listener_password),
            role=UserRole.listener,
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Created initial listener {email}.")
    finally:
        if owns_session:
            db.close()


if __name__ == "__main__":
    seed_initial_admin()
    seed_initial_listener()
