export type Role = "listener" | "editor" | "admin";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  csrf_token: string;
}

export interface UserCreateInput {
  email: string;
  display_name: string;
  password: string;
  role: "listener" | "editor";
}

export interface UserUpdateInput {
  display_name?: string;
  role?: "listener" | "editor";
  is_active?: boolean;
}

export type TrackSource = "upload" | "youtube";

export interface Track {
  id: string;
  title: string;
  artist_name: string;
  album_title: string | null;
  release_year: number | null;
  duration_seconds: number;
  mime_type: string;
  source_type: TrackSource;
  is_available: boolean;
  recording_key: string;
  play_count?: number;
  last_played_at?: string | null;
  created_at: string;
}

export interface TrackPage {
  items: Track[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export type ImportJobStatus =
  | "queued"
  | "searching"
  | "downloading"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";

export interface ImportJob {
  id: string;
  query_text: string;
  normalized_query: string;
  status: ImportJobStatus;
  candidate_url: string | null;
  candidate_title: string | null;
  candidate_artist: string | null;
  candidate_duration_seconds: number | null;
  source_artist: string | null;
  source_title: string | null;
  expected_duration_seconds: number | null;
  recording_key: string | null;
  track_id: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ImportConfig {
  auto_rip_on_miss: boolean;
  max_track_minutes: number;
}

export interface ImportPreviewCandidate {
  video_id: string;
  url: string;
  title: string;
  artist: string;
  uploader: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  thumbnail_url: string | null;
  within_duration_limit: boolean;
}

export interface ImportPreview {
  query: string;
  max_track_minutes: number;
  candidates: ImportPreviewCandidate[];
}

export interface ImportCandidateSelectionInput {
  video_id: string;
  title: string;
  artist: string;
  duration_seconds: number;
}

export interface AppSettings {
  auto_rip_on_miss: boolean;
  llm_auto_approve: boolean;
  max_track_minutes: number;
  updated_at: string;
}

export interface AppSettingsUpdateInput {
  auto_rip_on_miss: boolean;
  llm_auto_approve: boolean;
  max_track_minutes: number;
}

export interface LlmStatus {
  available: boolean;
  model: string;
  base_url: string;
  detail: string | null;
}

export interface ImportJobUpdateInput {
  candidate_title?: string;
  candidate_artist?: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  item_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem {
  id: string;
  position: number;
  track: Track;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  items: PlaylistItem[];
}

export interface PlaylistCreateInput {
  name: string;
}

export interface DiscoverRecommendation {
  title: string;
  artist: string;
  local_track: Track | null;
  score: number;
  seed_count: number;
}

export interface DiscoverResponse {
  seeds: string[];
  recommendations: DiscoverRecommendation[];
}

export type DiscoveryLevel = "familiar" | "balanced" | "adventurous";

export interface RadioRecommendation {
  title: string;
  artist: string;
  recording_key: string;
  local_track: Track | null;
  score: number;
  seed_count: number;
  expected_duration_seconds: number | null;
  reason: string | null;
  sources: string[];
}

export interface RadioBatch {
  recommendations: RadioRecommendation[];
  seed_count: number;
  qualified_seed_count: number;
  discovery_level: DiscoveryLevel;
  exhausted: boolean;
}

export interface RadioSession {
  enabled: boolean;
  discovery_level: DiscoveryLevel;
  seed_track: Track | null;
  qualified_seed_count: number;
}

export interface RadioSessionUpdateInput {
  seed_track_id?: string;
  discovery_level?: DiscoveryLevel;
  reset_seed?: boolean;
}

export interface RadioFeedbackInput {
  recording_key?: string;
  track_id?: string;
  title?: string;
  artist?: string;
  verdict: "reject" | "like" | "clear";
  reason?: "skip" | "remove" | "not_now" | "never" | "failed" | "manual";
}

export interface RadioListenInput {
  track_id: string;
  played_seconds: number;
  duration_seconds: number;
  skipped: boolean;
  source: "radio" | "manual" | "playlist";
  started_at?: string;
}

export interface RadioListenResult {
  completion_ratio: number;
  qualified: boolean;
}

export type QueueItemStatus = "ready" | "pending" | "failed";
export type QueueItemSource = "radio" | "manual";

export interface QueueItem {
  id: string;
  position: number;
  status: QueueItemStatus;
  source: QueueItemSource;
  recording_key: string;
  title: string;
  artist: string;
  video_id: string | null;
  expected_duration_seconds: number | null;
  import_job_id: string | null;
  import_status: ImportJobStatus | null;
  error_message: string | null;
  reason: string | null;
  track: Track | null;
}

export interface QueueState {
  revision: number;
  current_item_id: string | null;
  current_index: number;
  is_playing: boolean;
  position_seconds: number;
  needs_refill: boolean;
  radio_exhausted: boolean;
  qualified_seed_count: number;
  items: QueueItem[];
}

export interface QueueImportInput {
  query: string;
  candidate?: ImportCandidateSelectionInput;
  play_now: boolean;
  source_artist?: string;
  source_title?: string;
  expected_duration_seconds?: number;
  recording_key?: string;
}
