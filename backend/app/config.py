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
    initial_listener_email: str = "listener@example.com"
    initial_listener_password: str = "listener-password"
    initial_listener_display_name: str = "Listener"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "laya"
    ollama_timeout_seconds: int = 30
    llm_confidence_threshold: float = 0.0
    lastfm_api_key: str = ""
    lastfm_base_url: str = "https://ws.audioscrobbler.com/2.0/"
    lastfm_timeout_seconds: float = 10.0
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
