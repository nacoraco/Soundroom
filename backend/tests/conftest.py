import os

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["APP_SECRET_KEY"] = "test-secret-key"
os.environ["FRONTEND_ORIGIN"] = "http://testserver"
os.environ["COOKIE_SECURE"] = "false"
os.environ["INITIAL_ADMIN_EMAIL"] = "admin@example.com"
os.environ["INITIAL_ADMIN_PASSWORD"] = "admin-password"
os.environ["INITIAL_ADMIN_DISPLAY_NAME"] = "Administrator"
os.environ["INITIAL_LISTENER_EMAIL"] = "listener@example.com"
os.environ["INITIAL_LISTENER_PASSWORD"] = "listener-password"
os.environ["INITIAL_LISTENER_DISPLAY_NAME"] = "Listener"
os.environ["SESSION_TTL_HOURS"] = "24"
os.environ["AUDIO_PROCESSING_ENABLED"] = "false"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401 - registers models with Base.metadata
from app.db import Base, get_db
from app.main import app
from app.seed import seed_initial_admin

engine = create_engine(
    "sqlite+pysqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestingSessionLocal() as db:
        seed_initial_admin(db)
    yield


@pytest.fixture
def client():
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def db_session():
    with TestingSessionLocal() as session:
        yield session
