import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { fetchMe, login, logout } from "./api";
import type { AuthResponse } from "./types";

const AUTH_KEY = ["auth"] as const;

export function useAuth() {
  return useQuery<AuthResponse | null>({
    queryKey: AUTH_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: (data) => {
      queryClient.setQueryData(AUTH_KEY, data);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      queryClient.setQueryData(AUTH_KEY, null);
      queryClient.removeQueries({ queryKey: ["admin-users"] });
      queryClient.removeQueries({ queryKey: ["app-settings"] });
      queryClient.removeQueries({ queryKey: ["import-config"] });
      queryClient.removeQueries({ queryKey: ["import-jobs"] });
      queryClient.removeQueries({ queryKey: ["import-job"] });
    },
  });
}

export function ProtectedRoute() {
  const location = useLocation();
  const { data, isLoading } = useAuth();

  if (isLoading) {
    return <div className="page-loading">Loading…</div>;
  }

  if (!data?.user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <Outlet />;
}

export function AdminRoute() {
  const { data } = useAuth();

  if (data?.user.role !== "admin") {
    return <Navigate to="/library" replace />;
  }

  return <Outlet />;
}

export function EditorRoute() {
  const { data } = useAuth();

  if (data?.user.role !== "editor" && data?.user.role !== "admin") {
    return <Navigate to="/library" replace />;
  }

  return <Outlet />;
}
