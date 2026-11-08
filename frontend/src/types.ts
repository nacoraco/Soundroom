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
