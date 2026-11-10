import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute, EditorRoute, ProtectedRoute } from "./auth";
import { AppLayout } from "./components/AppLayout";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { ImportJobsPage } from "./pages/ImportJobsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlaylistDetailPage } from "./pages/PlaylistDetailPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { LoginPage } from "./pages/LoginPage";
import { UploadPage } from "./pages/UploadPage";
import { PlayerProvider } from "./player";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route
                  path="/playlists/:playlistId"
                  element={<PlaylistDetailPage />}
                />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route element={<EditorRoute />}>
                  <Route path="/upload" element={<UploadPage />} />
                  <Route path="/imports" element={<ImportJobsPage />} />
                </Route>
                <Route element={<AdminRoute />}>
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                  <Route
                    path="/people"
                    element={<Navigate to="/admin/users" replace />}
                  />
                  <Route
                    path="/admin/settings"
                    element={<AdminSettingsPage />}
                  />
                </Route>
              </Route>
            </Route>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Routes>
        </BrowserRouter>
      </PlayerProvider>
    </QueryClientProvider>
  );
}
