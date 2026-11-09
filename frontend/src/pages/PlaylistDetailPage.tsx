import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  ApiError,
  addPlaylistItem,
  deletePlaylist,
  getPlaylist,
  listTracks,
  removePlaylistItem,
  reorderPlaylistItems,
  updatePlaylist,
} from "../api";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlayIcon,
  RemoveIcon,
} from "../components/playerIcons";
import { usePlayer } from "../player";
import { artStyle, formatTime, trackInitials } from "../playerVisuals";
import type { PlaylistDetail, PlaylistItem, Track } from "../types";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function PlaylistDetailPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playTrack, currentTrack } = usePlayer();
  const queryKey = ["playlist", playlistId] as const;

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const playlistQuery = useQuery({
    queryKey,
    queryFn: () => getPlaylist(playlistId as string),
    enabled: Boolean(playlistId),
    retry: false,
  });

  const playlist = playlistQuery.data;

  useEffect(() => {
    if (playlist) {
      setNameDraft(playlist.name);
    }
  }, [playlist?.name, playlist]);

  const trackSearchQuery = useQuery({
    queryKey: ["playlist-track-search", searchQuery],
    queryFn: () => listTracks({ q: searchQuery, page: 1 }),
    enabled: searchQuery.length >= 3,
  });

  const addMutation = useMutation({
    mutationFn: (track: Track) =>
      addPlaylistItem(playlistId as string, track.id),
    onSuccess: (detail, track) => {
      queryClient.setQueryData(queryKey, detail);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setNotice(`“${track.title}” added to the playlist.`);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (item: PlaylistItem) =>
      removePlaylistItem(playlistId as string, item.id),
    onSuccess: (detail, item) => {
      queryClient.setQueryData(queryKey, detail);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setNotice(`“${item.track.title}” removed from the playlist.`);
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      reorderPlaylistItems(playlistId as string, itemIds),
    onMutate: async (itemIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PlaylistDetail>(queryKey);
      if (previous) {
        const byId = new Map(previous.items.map((item) => [item.id, item]));
        const items = itemIds
          .map((id, index) => {
            const item = byId.get(id);
            return item ? { ...item, position: index } : null;
          })
          .filter((item): item is PlaylistItem => item !== null);
        queryClient.setQueryData<PlaylistDetail>(queryKey, {
          ...previous,
          items,
        });
      }
      return { previous };
    },
    onError: (mutationError, _itemIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      setNotice(errorMessage(mutationError, "The order could not be saved."));
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKey, detail);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) =>
      updatePlaylist(playlistId as string, { name }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKey, detail);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      setRenaming(false);
      setNotice("Playlist renamed.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePlaylist(playlistId as string),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      navigate("/playlists");
    },
  });

  if (playlistQuery.isLoading) {
    return (
      <section className="page">
        <p className="muted">Opening the playlist…</p>
      </section>
    );
  }

  if (playlistQuery.isError || !playlist) {
    const error = playlistQuery.error;
    return (
      <section className="page">
        <header className="page-header">
          <div className="page-title">
            <span className="eyebrow">Playlist / Unavailable</span>
            <h1>This shelf is not available.</h1>
          </div>
        </header>
        <p className="form-error" role="alert">
          {errorMessage(error, "This playlist does not exist or is not yours.")}
        </p>
        <Link className="button button-quiet" to="/playlists">
          Back to playlists
        </Link>
      </section>
    );
  }

  const items = playlist.items;
  const tracks = items.map((item) => item.track);
  const totalSeconds = tracks.reduce(
    (total, track) => total + track.duration_seconds,
    0,
  );
  const actionError =
    addMutation.error ??
    removeMutation.error ??
    reorderMutation.error ??
    renameMutation.error ??
    deleteMutation.error;

  function playAll() {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
    }
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNotice("The playlist needs a name.");
      return;
    }
    renameMutation.mutate(trimmed);
  }

  function handleDelete() {
    if (
      window.confirm(
        `Delete “${playlist?.name}”? The tracks stay in the library.`,
      )
    ) {
      deleteMutation.mutate();
    }
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      const next = [...ids];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorderMutation.mutate(next);
    }
    setDraggingId(null);
    setDragOverId(null);
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return;
    }
    const ids = items.map((item) => item.id);
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    reorderMutation.mutate(next);
  }

  return (
    <section className="page playlist-detail-page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">
            Playlist / {items.length}{" "}
            {items.length === 1 ? "recording" : "recordings"}
          </span>
          {renaming ? (
            <form className="playlist-rename" onSubmit={handleRename}>
              <input
                autoFocus
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={200}
                aria-label="Playlist name"
              />
              <button
                type="submit"
                className="button button-primary button-small"
                disabled={renameMutation.isPending}
              >
                Save
              </button>
              <button
                type="button"
                className="button button-quiet button-small"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <h1>{playlist.name}</h1>
          )}
        </div>
        <div className="page-aside playlist-detail-actions">
          <button
            type="button"
            className="button button-primary button-small"
            onClick={playAll}
            disabled={items.length === 0}
          >
            Play all
          </button>
          <button
            type="button"
            className="button button-quiet button-small"
            onClick={() => setRenaming(true)}
          >
            Rename
          </button>
          <button
            type="button"
            className="button button-quiet button-small playlist-danger-button"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            Delete
          </button>
        </div>
      </header>

      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {errorMessage(actionError, "The playlist action could not be completed.")}
        </p>
      )}

      <div className="playlist-detail-layout">
        <section className="panel playlist-items-panel">
          <div className="panel-head playlist-items-head">
            <div>
              <span className="eyebrow">Sequence</span>
              <h2>Recordings</h2>
            </div>
            <span className="mono muted">
              {formatTime(totalSeconds)} total
            </span>
          </div>

          {items.length === 0 ? (
            <div className="playlist-empty playlist-empty-compact">
              <span className="eyebrow">Nothing on this shelf</span>
              <h2>Add your first recording.</h2>
              <p>Search the library on the right to place a track here.</p>
            </div>
          ) : (
            <ol className="playlist-items">
              {items.map((item, index) => {
                const track = item.track;
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <li
                    className={`playlist-item ${
                      draggingId === item.id ? "is-dragging" : ""
                    } ${dragOverId === item.id ? "is-drop-target" : ""} ${
                      isCurrent ? "is-current-track" : ""
                    }`}
                    key={item.id}
                    style={artStyle(track)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverId(item.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(item.id);
                    }}
                  >
                    <span
                      className="playlist-drag-handle"
                      draggable={!reorderMutation.isPending}
                      onDragStart={(event) => {
                        setDraggingId(item.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                      aria-hidden="true"
                      title="Drag to reorder"
                    >
                      ::
                    </span>
                    <button
                      type="button"
                      className="playlist-item-play"
                      onClick={() => playTrack(track, tracks)}
                      aria-label={`Play ${track.title}`}
                    >
                      <span className="playlist-item-number mono">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="track-artwork" aria-hidden="true">
                        <span>{trackInitials(track)}</span>
                      </span>
                      <span className="playlist-item-copy">
                        <strong>{track.title}</strong>
                        <span>
                          {track.artist_name}
                          {track.album_title ? ` · ${track.album_title}` : ""}
                        </span>
                      </span>
                      <span className="playlist-item-duration mono">
                        {formatTime(track.duration_seconds)}
                      </span>
                    </button>
                    <span className="playlist-item-actions">
                      <button
                        type="button"
                        className="playlist-icon-button playlist-item-play-action"
                        onClick={() => playTrack(track, tracks)}
                        aria-label={`Play ${track.title}`}
                        title="Play now"
                      >
                        <PlayIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="playlist-icon-button"
                        onClick={() => moveItem(index, -1)}
                        disabled={index === 0 || reorderMutation.isPending}
                        aria-label={`Move ${track.title} up`}
                        title="Move up"
                      >
                        <ArrowUpIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className="playlist-icon-button"
                        onClick={() => moveItem(index, 1)}
                        disabled={
                          index === items.length - 1 ||
                          reorderMutation.isPending
                        }
                        aria-label={`Move ${track.title} down`}
                        title="Move down"
                      >
                        <ArrowDownIcon size={16} />
                      </button>
                      <button
                        type="button"
                        className="playlist-icon-button playlist-remove-button"
                        onClick={() => removeMutation.mutate(item)}
                        disabled={removeMutation.isPending}
                        aria-label={`Remove ${track.title} from playlist`}
                        title="Remove from playlist"
                      >
                        <RemoveIcon size={15} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="playlist-side">
          <section className="panel playlist-add-panel">
            <div className="panel-head">
              <span className="eyebrow">From the archive</span>
              <h2>Add a recording</h2>
            </div>
            <label className="field playlist-search-field">
              <span>Search by title or artist</span>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Start typing…"
                autoComplete="off"
              />
            </label>

            {searchQuery.length > 0 && searchQuery.length < 3 && (
              <p className="muted playlist-search-hint">
                Type at least 3 characters.
              </p>
            )}

            {searchQuery.length >= 3 && trackSearchQuery.isLoading && (
              <p className="muted playlist-search-hint">Searching…</p>
            )}

            {trackSearchQuery.data &&
              trackSearchQuery.data.items.length === 0 && (
                <p className="muted playlist-search-hint">
                  No recordings match this search.
                </p>
              )}

            {trackSearchQuery.data &&
              trackSearchQuery.data.items.length > 0 && (
                <div className="playlist-search-results">
                  {trackSearchQuery.data.items.map((track) => {
                    const alreadyAdded = items.some(
                      (item) => item.track.id === track.id,
                    );
                    return (
                      <div className="playlist-search-result" key={track.id}>
                        <span className="playlist-search-copy">
                          <strong>{track.title}</strong>
                          <span>
                            {track.artist_name} ·{" "}
                            {formatTime(track.duration_seconds)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() => addMutation.mutate(track)}
                          disabled={alreadyAdded || addMutation.isPending}
                        >
                          {alreadyAdded ? "Added" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

            {searchQuery.length === 0 && (
              <p className="playlist-search-hint muted">
                Search your library to add a track to this playlist.
              </p>
            )}
          </section>

          <section className="panel playlist-note-panel">
            <span className="eyebrow">A private shelf</span>
            <p>
              This playlist belongs only to you. Drag rows or use the arrows to
              change the running order.
            </p>
            <Link className="text-link" to="/playlists">
              Back to all playlists
            </Link>
          </section>
        </aside>
      </div>
    </section>
  );
}
