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

export interface ImportJobUpdateInput {
  candidate_title?: string;
  candidate_artist?: string;
}
