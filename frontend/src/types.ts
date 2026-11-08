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
