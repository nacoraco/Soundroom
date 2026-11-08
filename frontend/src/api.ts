import type {
  AuthResponse,
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

export async function uploadTrack(formData: FormData): Promise<Track> {
  return request<Track>("/api/tracks", {
    method: "POST",
    body: formData,
  });
}
