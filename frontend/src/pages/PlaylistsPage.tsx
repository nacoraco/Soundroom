import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError, createPlaylist, listPlaylists } from "../api";

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function PlaylistsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playlistsQuery = useQuery({
    queryKey: ["playlists"],
    queryFn: listPlaylists,
  });

  const createMutation = useMutation({
    mutationFn: createPlaylist,
    onSuccess: (playlist) => {
      setName("");
      setError(null);
      setNotice(`“${playlist.name}” is ready.`);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (mutationError) => {
      setNotice(null);
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "The playlist could not be created.",
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice(null);
      setError("Give the playlist a name first.");
      return;
    }
    setError(null);
    createMutation.mutate({ name: trimmed });
  }

  const playlists = playlistsQuery.data ?? [];

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Listening room / Playlists</span>
          <h1>Your private shelves</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Collection</span>
          <span>
            {playlists.length}{" "}
            {playlists.length === 1 ? "playlist" : "playlists"}
          </span>
        </div>
      </header>

      <div className="playlists-layout">
        <section className="panel playlist-create-panel">
          <div className="panel-head">
            <span className="eyebrow">New shelf</span>
            <h2>Make a playlist</h2>
          </div>
          <p className="playlist-panel-copy">
            Group recordings for a mood, a night, or a path through the
            archive.
          </p>
          <form onSubmit={handleSubmit} className="playlist-create-form">
            <label className="field">
              <span>Playlist name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Late night, Sunday morning…"
                maxLength={200}
                autoComplete="off"
                aria-invalid={Boolean(error)}
              />
            </label>
            <button
              type="submit"
              className="button button-primary button-block"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create playlist"}
            </button>
          </form>
          {notice && (
            <p className="form-success" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="playlist-collection">
          <div className="playlist-collection-head">
            <div>
              <span className="eyebrow">Shelves</span>
              <h2>Playlists</h2>
            </div>
            <span className="mono muted">
              {playlists.length === 0
                ? "Nothing filed yet"
                : "Only you can see these"}
            </span>
          </div>

          {playlistsQuery.isLoading && (
            <p className="muted">Opening your shelves…</p>
          )}
          {playlistsQuery.isError && (
            <p className="form-error" role="alert">
              Playlists could not be loaded.
            </p>
          )}

          {!playlistsQuery.isLoading &&
            !playlistsQuery.isError &&
            playlists.length === 0 && (
              <div className="playlist-empty">
                <span className="eyebrow">The shelf is empty</span>
                <h2>Begin with one record.</h2>
                <p>
                  Create a playlist, then add recordings from its search panel.
                  Lists stay private to your account.
                </p>
              </div>
            )}

          {playlists.length > 0 && (
            <div className="playlist-grid">
              {playlists.map((playlist, index) => (
                <Link
                  className="playlist-card"
                  key={playlist.id}
                  to={`/playlists/${playlist.id}`}
                >
                  <span className="playlist-card-index mono">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2>{playlist.name}</h2>
                  <span className="playlist-card-meta mono">
                    {playlist.item_count}{" "}
                    {playlist.item_count === 1 ? "recording" : "recordings"} ·{" "}
                    {formatDuration(playlist.total_duration_seconds)}
                  </span>
                  <span className="playlist-card-foot">
                    <span className="mono">
                      Updated {formatDate(playlist.updated_at)}
                    </span>
                    <span aria-hidden="true">Open ↗</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
