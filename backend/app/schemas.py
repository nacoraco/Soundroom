from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import RipJobStatus, TrackSource, UserRole


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    display_name: str
    role: UserRole
    is_active: bool
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class AuthResponse(BaseModel):
    user: UserOut
    csrf_token: str


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=256)
    role: UserRole = UserRole.listener

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Display name is required")
        return value

    @field_validator("role")
    @classmethod
    def only_listener_or_editor(cls, value: UserRole) -> UserRole:
        if value is UserRole.admin:
            raise ValueError("Admin role cannot be assigned to new users")
        return value


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: UserRole | None = None
    is_active: bool | None = None

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Display name cannot be empty")
        return value

    @field_validator("role")
    @classmethod
    def only_listener_or_editor(cls, value: UserRole | None) -> UserRole | None:
        if value is UserRole.admin:
            raise ValueError("Admin role cannot be assigned")
        return value


class TrackOut(BaseModel):
    id: UUID
    title: str
    artist_name: str
    album_title: str | None
    release_year: int | None
    duration_seconds: int
    mime_type: str
    source_type: TrackSource
    is_available: bool
    created_at: datetime


class TrackPage(BaseModel):
    items: list[TrackOut]
    page: int
    page_size: int
    total: int
    total_pages: int


class AppSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auto_rip_on_miss: bool
    llm_auto_approve: bool
    max_track_minutes: int
    updated_at: datetime


class AppSettingsUpdate(BaseModel):
    auto_rip_on_miss: bool
    llm_auto_approve: bool = False
    max_track_minutes: int = Field(ge=1, le=1440)


class ImportJobCreate(BaseModel):
    query: str = Field(min_length=3, max_length=300)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Enter at least 3 characters")
        return value


class ImportJobConfig(BaseModel):
    auto_rip_on_miss: bool
    max_track_minutes: int


class ImportJobUpdate(BaseModel):
    candidate_title: str | None = Field(default=None, min_length=1, max_length=300)
    candidate_artist: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("candidate_title", "candidate_artist")
    @classmethod
    def strip_candidate_value(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class ImportJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    query_text: str
    normalized_query: str
    status: RipJobStatus
    candidate_url: str | None
    candidate_title: str | None
    candidate_artist: str | None
    candidate_duration_seconds: int | None
    track_id: UUID | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
