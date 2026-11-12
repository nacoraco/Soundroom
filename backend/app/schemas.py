from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import DiscoveryLevel, RipJobStatus, TrackSource, UserRole
from .recommendations import (
    MAX_RECOMMENDATION_EXCLUDE,
    MAX_RECOMMENDATION_HISTORY,
)


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
    recording_key: str = ""
    play_count: int = 0
    last_played_at: datetime | None = None
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


class LlmStatusOut(BaseModel):
    available: bool
    model: str
    base_url: str
    detail: str | None = None


class ImportCandidateSelection(BaseModel):
    video_id: str = Field(
        min_length=11,
        max_length=11,
        pattern=r"^[A-Za-z0-9_-]{11}$",
    )
    title: str = Field(min_length=1, max_length=300)
    artist: str = Field(min_length=1, max_length=200)
    duration_seconds: int = Field(ge=1, le=86400)

    @field_validator("title", "artist")
    @classmethod
    def strip_selection_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value cannot be empty")
        return value


class ImportJobCreate(BaseModel):
    query: str = Field(min_length=3, max_length=300)
    candidate: ImportCandidateSelection | None = None
    force_llm_approval: bool = False
    source_artist: str | None = Field(default=None, max_length=200)
    source_title: str | None = Field(default=None, max_length=300)
    expected_duration_seconds: int | None = Field(
        default=None, ge=1, le=86400
    )
    recording_key: str | None = Field(default=None, max_length=400)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Enter at least 3 characters")
        return value

    @field_validator("source_artist", "source_title", "recording_key")
    @classmethod
    def strip_source_value(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ImportPreviewCandidate(BaseModel):
    video_id: str
    url: str
    title: str
    artist: str
    uploader: str | None
    duration_seconds: int | None
    view_count: int | None
    thumbnail_url: str | None
    within_duration_limit: bool


class ImportPreview(BaseModel):
    query: str
    max_track_minutes: int
    candidates: list[ImportPreviewCandidate]


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
    source_artist: str | None = None
    source_title: str | None = None
    expected_duration_seconds: int | None = None
    recording_key: str | None = None
    force_llm_approval: bool
    track_id: UUID | None
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Playlist name is required")
        return value


class PlaylistUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Playlist name is required")
        return value


class PlaylistItemCreate(BaseModel):
    track_id: UUID


class PlaylistReorder(BaseModel):
    item_ids: list[UUID] = Field(min_length=1, max_length=1000)


class PlaylistItemOut(BaseModel):
    id: UUID
    position: int
    track: TrackOut


class PlaylistSummary(BaseModel):
    id: UUID
    name: str
    item_count: int
    total_duration_seconds: int
    created_at: datetime
    updated_at: datetime


class PlaylistDetail(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    updated_at: datetime
    items: list[PlaylistItemOut]

class DiscoverRequest(BaseModel):
    seed_track_ids: list[UUID] = Field(min_length=1, max_length=3)

    @field_validator("seed_track_ids")
    @classmethod
    def unique_seed_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("Seed tracks must be unique")
        return value


class DiscoverRecommendation(BaseModel):
    title: str
    artist: str
    local_track: TrackOut | None
    score: float
    seed_count: int


class DiscoverResponse(BaseModel):
    seeds: list[UUID]
    recommendations: list[DiscoverRecommendation]


class RadioSeed(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    artist: str = Field(min_length=1, max_length=200)

    @field_validator("title", "artist")
    @classmethod
    def strip_radio_seed(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Seed metadata cannot be empty")
        return value


class RadioRequest(BaseModel):
    seeds: list[RadioSeed] = Field(
        min_length=1,
        max_length=MAX_RECOMMENDATION_HISTORY,
    )
    limit: int = Field(default=1, ge=1, le=20)
    exclude: list[RadioSeed] = Field(
        default_factory=list,
        max_length=MAX_RECOMMENDATION_EXCLUDE,
    )


class RadioResponse(BaseModel):
    recommendations: list[DiscoverRecommendation]


class RadioSessionUpdate(BaseModel):
    seed_track_id: UUID | None = None
    discovery_level: DiscoveryLevel | None = None
    reset_seed: bool = False


class RadioSessionOut(BaseModel):
    enabled: bool
    discovery_level: DiscoveryLevel
    seed_track: TrackOut | None
    qualified_seed_count: int


class RadioNextRequest(BaseModel):
    limit: int = Field(default=10, ge=1, le=20)
    exclude: list[str] = Field(default_factory=list, max_length=200)
    discovery_level: DiscoveryLevel | None = None
    seed_track_id: UUID | None = None


class RadioRecommendationOut(BaseModel):
    title: str
    artist: str
    recording_key: str
    local_track: TrackOut | None
    score: float
    seed_count: int
    expected_duration_seconds: int | None
    reason: str | None
    sources: list[str]


class RadioNextResponse(BaseModel):
    recommendations: list[RadioRecommendationOut]
    seed_count: int
    qualified_seed_count: int
    discovery_level: DiscoveryLevel
    exhausted: bool


class RadioFeedbackCreate(BaseModel):
    recording_key: str | None = Field(default=None, max_length=400)
    track_id: UUID | None = None
    title: str | None = Field(default=None, max_length=300)
    artist: str | None = Field(default=None, max_length=200)
    verdict: str = Field(pattern=r"^(reject|like|clear)$")
    reason: str | None = Field(
        default=None,
        pattern=r"^(skip|remove|not_now|never|failed|manual)$",
    )

    @field_validator("recording_key", "title", "artist")
    @classmethod
    def strip_feedback_value(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class RadioListenCreate(BaseModel):
    track_id: UUID
    played_seconds: int = Field(ge=0, le=86400)
    duration_seconds: int = Field(ge=1, le=86400)
    skipped: bool = False
    source: str = Field(default="radio", pattern=r"^(radio|manual|playlist)$")
    started_at: datetime | None = None


class RadioListenOut(BaseModel):
    completion_ratio: float
    qualified: bool
