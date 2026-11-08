from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Soundroom API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://soundroom:soundroom@localhost:5432/soundroom"
    app_secret_key: str = "dev-secret-change-me"
    frontend_origin: str = "http://localhost:5173"
    session_cookie_name: str = "soundroom_session"
    session_ttl_hours: int = 168
    cookie_secure: bool = False
    initial_admin_email: str = "admin@example.com"
    initial_admin_password: str = "change-me-now"
    initial_admin_display_name: str = "Administrator"
    max_upload_mb: int = 50
    media_storage_path: str = "./data/audio"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
