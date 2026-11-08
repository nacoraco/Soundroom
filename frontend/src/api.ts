import type {
  AppSettings,
  AppSettingsUpdateInput,
  AuthResponse,
  DiscoverResponse,
  ImportCandidateSelectionInput,
  ImportConfig,
  ImportJob,
  ImportJobStatus,
  ImportJobUpdateInput,
  ImportPreview,
  PlaylistCreateInput,
  PlaylistDetail,
  PlaylistSummary,
  Track,
  TrackPage,
  User,
  UserCreateInput,
  UserUpdateInput,
} from "./types";

let csrfToken: string | null = null;

export interface ApiErrorDetail {
  code?: string;
  message?: string;
  missing?: string[];
  metadata?: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    release_year?: number | null;
    duration_seconds?: number;
  };
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    const message =
      typeof detail === "string"
        ? detail
        : detail !== null &&
            typeof detail === "object" &&
            "message" in detail &&
            typeof (detail as { message?: unknown }).message === "string"
          ? (detail as { message: string }).message
          : "Request failed";
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const method = (init.method ?? "GET").toUpperCase();
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => null)) as {
    detail?: unknown;
  } | null;

  if (!response.ok) {
    throw new ApiError(response.status, data?.detail ?? "Request failed");
  }

  return data as T;
}

export async function fetchMe(): Promise<AuthResponse | null> {
  try {
    const data = await request<AuthResponse>("/api/auth/me");
    setCsrfToken(data.csrf_token);
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const data = await request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setCsrfToken(data.csrf_token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/api/auth/logout", { method: "POST" });
  } finally {
    setCsrfToken(null);
  }
}

export async function listUsers(): Promise<User[]> {
  return request<User[]>("/api/admin/users");
}

export async function createUser(input: UserCreateInput): Promise<User> {
  return request<User>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateUser(
  id: string,
  input: UserUpdateInput,
): Promise<User> {
  return request<User>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function listTracks({
  q,
  page = 1,
}: {
  q?: string;
  page?: number;
} = {}): Promise<TrackPage> {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return request<TrackPage>(`/api/tracks${query ? `?${query}` : ""}`);
}

export async function getTrack(id: string): Promise<Track> {
  return request<Track>(`/api/tracks/${id}`);
}

export async function uploadTrack(formData: FormData): Promise<Track> {
  return request<Track>("/api/tracks", {
    method: "POST",
    body: formData,
  });
}

export async function deleteTrack(id: string): Promise<void> {
  return request<void>(`/api/tracks/${id}`, { method: "DELETE" });
}

export async function discoverSimilar(
  seedTrackIds: string[],
): Promise<DiscoverResponse> {
  return request<DiscoverResponse>("/api/discover/similar", {
    method: "POST",
    body: JSON.stringify({ seed_track_ids: seedTrackIds }),
  });
}

export async function listPlaylists(): Promise<PlaylistSummary[]> {
  return request<PlaylistSummary[]>("/api/playlists");
}

export async function createPlaylist(
  input: PlaylistCreateInput,
): Promise<PlaylistDetail> {
  return request<PlaylistDetail>("/api/playlists", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(`/api/playlists/${id}`);
}

export async function updatePlaylist(
  id: string,
  input: PlaylistCreateInput,
): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(`/api/playlists/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  return request<void>(`/api/playlists/${id}`, { method: "DELETE" });
}

export async function addPlaylistItem(
  playlistId: string,
  trackId: string,
): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(`/api/playlists/${playlistId}/items`, {
    method: "POST",
    body: JSON.stringify({ track_id: trackId }),
  });
}

export async function removePlaylistItem(
  playlistId: string,
  itemId: string,
): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(
    `/api/playlists/${playlistId}/items/${itemId}`,
    { method: "DELETE" },
  );
}

export async function reorderPlaylistItems(
  playlistId: string,
  itemIds: string[],
): Promise<PlaylistDetail> {
  return request<PlaylistDetail>(
    `/api/playlists/${playlistId}/items/reorder`,
    {
      method: "PUT",
      body: JSON.stringify({ item_ids: itemIds }),
    },
  );
}

export async function getAppSettings(): Promise<AppSettings> {
  return request<AppSettings>("/api/admin/settings");
}

export async function updateAppSettings(
  input: AppSettingsUpdateInput,
): Promise<AppSettings> {
  return request<AppSettings>("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getImportConfig(): Promise<ImportConfig> {
  return request<ImportConfig>("/api/import-jobs/config");
}

export async function previewImportCandidates(
  query: string,
): Promise<ImportPreview> {
  return request<ImportPreview>(
    `/api/import-jobs/preview?q=${encodeURIComponent(query)}`,
  );
}

export async function createImportJob(
  query: string,
  candidate?: ImportCandidateSelectionInput,
): Promise<ImportJob> {
  return request<ImportJob>("/api/import-jobs", {
    method: "POST",
    body: JSON.stringify({ query, candidate }),
  });
}

export async function getImportJob(id: string): Promise<ImportJob> {
  return request<ImportJob>(`/api/import-jobs/${id}`);
}

export async function listImportJobs(
  status?: ImportJobStatus,
): Promise<ImportJob[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<ImportJob[]>(`/api/editor/import-jobs${query}`);
}

export async function updateImportJob(
  id: string,
  input: ImportJobUpdateInput,
): Promise<ImportJob> {
  return request<ImportJob>(`/api/editor/import-jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function approveImportJob(id: string): Promise<ImportJob> {
  return request<ImportJob>(`/api/editor/import-jobs/${id}/approve`, {
    method: "POST",
  });
}

export async function rejectImportJob(id: string): Promise<ImportJob> {
  return request<ImportJob>(`/api/editor/import-jobs/${id}/reject`, {
    method: "POST",
  });
}
