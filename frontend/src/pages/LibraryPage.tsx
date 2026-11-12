import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { deleteTrack, listTracks } from "../api";
import { useAuth } from "../auth";
import { ImportRequest } from "../components/ImportRequest";
import {
  CloseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../components/playerIcons";
import { usePlayer } from "../player";
import { artStyle, trackInitials } from "../playerVisuals";
import type { Track } from "../types";

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function pageNumber(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function LibraryPage() {
  const { data: auth } = useAuth();
  const { playTrack, enqueue, currentTrack, removeTrack } = usePlayer();
  const queryClient = useQueryClient();
  const user = auth?.user;
  const canEdit = user?.role === "editor" || user?.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const page = pageNumber(searchParams.get("page"));
  const [input, setInput] = useState(query);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setInput((current) => (current.trim() === query ? current : query));
  }, [query]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === query) {
      return;
    }
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams();
      if (trimmed) {
        next.set("q", trimmed);
      }
      setSearchParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, query, setSearchParams]);

  const tooShort = query.length > 0 && query.length < 3;
  const isSearching = query.length >= 3;
  const tracksQuery = useQuery({
    queryKey: ["tracks", query, page, "most_played"],
    queryFn: () =>
      listTracks({
        q: query || undefined,
        page,
        sort: "most_played",
      }),
    enabled: !tooShort,
    placeholderData: keepPreviousData,
  });

  const tracks = tracksQuery.data?.items ?? [];
  const total = tracksQuery.data?.total ?? 0;
  const pageSize = tracksQuery.data?.page_size ?? 20;
  const totalPages = tracksQuery.data?.total_pages ?? 0;
  const firstResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = (page - 1) * pageSize + tracks.length;
  const showResults =
    !tooShort &&
    !tracksQuery.isError &&
    !tracksQuery.isLoading &&
    tracks.length > 0;
  const showEmptySearch =
    !tooShort &&
    !tracksQuery.isError &&
    !tracksQuery.isLoading &&
    !tracksQuery.isFetching &&
    isSearching &&
    total === 0;
  const showEmptyLibrary =
    !tooShort &&
    !tracksQuery.isError &&
    !tracksQuery.isLoading &&
    !tracksQuery.isFetching &&
    !isSearching &&
    total === 0;

  useEffect(() => {
    if (
      tracksQuery.data &&
      tracksQuery.data.total_pages > 0 &&
      page > tracksQuery.data.total_pages
    ) {
      const next = new URLSearchParams();
      if (query) {
        next.set("q", query);
      }
      next.set("page", String(tracksQuery.data.total_pages));
      setSearchParams(next, { replace: true });
    }
  }, [page, query, setSearchParams, tracksQuery.data]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    const next = new URLSearchParams();
    if (trimmed) {
      next.set("q", trimmed);
    }
    setSearchParams(next, { replace: true });
  }

  function clearSearch() {
    setInput("");
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage > 1) {
      next.set("page", String(nextPage));
    } else {
      next.delete("page");
    }
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleTrackAction(action: "play" | "queue", track: Track) {
    if (action === "play") {
      playTrack(track);
      setNotice(`Playing “${track.title}”.`);
      return;
    }
    const added = enqueue(track);
    setNotice(
      added
        ? `“${track.title}” added to the queue.`
        : `“${track.title}” is already in the queue.`,
    );
  }

  const deleteMutation = useMutation({
    mutationFn: (track: Track) => deleteTrack(track.id),
    onSuccess: (_data, track) => {
      removeTrack(track.id);
      queryClient.invalidateQueries({ queryKey: ["tracks"] });
      setNotice(`“${track.title}” was deleted from the server.`);
    },
    onError: (mutationError, track) => {
      setNotice(
        mutationError instanceof Error
          ? mutationError.message
          : `“${track.title}” could not be deleted.`,
      );
    },
  });

  function handleDeleteTrack(track: Track) {
    const confirmed = window.confirm(
      `Delete “${track.title}” from the server?\n\nThe audio file will be removed permanently.`,
    );
    if (confirmed) {
      deleteMutation.mutate(track);
    }
  }

  let statusText = `${total} ${
    total === 1 ? "recording" : "recordings"
  } in the archive`;
  if (tracksQuery.isLoading) {
    statusText = "Opening the shelves…";
  } else if (tooShort) {
    statusText = "Type at least 3 characters to search.";
  } else if (tracksQuery.isFetching) {
    statusText = "Searching the shelves…";
  } else if (isSearching) {
    statusText = `${total} ${total === 1 ? "match" : "matches"} for “${query}”`;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Archive / Library</span>
          <h1>Your listening room</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Signed in</span>
          <span>{user?.email}</span>
        </div>
      </header>

      <section className="search-deck" aria-label="Search the library">
        <form className="search-form" role="search" onSubmit={applySearch}>
          <div className="search-field">
            <span className="search-prefix mono" aria-hidden="true">
              <span className="search-prefix-label">Search /</span>
              <span className="search-prefix-icon">
                <SearchIcon size={18} />
              </span>
            </span>
            <input
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Title or artist"
              aria-label="Search by title or artist"
              aria-describedby="search-status"
              autoComplete="off"
            />
            {input && (
              <button
                type="button"
                className="search-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                <CloseIcon size={16} />
            </button>
            )}
          </div>
          <button
            type="submit"
            className="button button-primary search-submit"
            aria-label="Search library"
          >
            <span className="search-submit-label">Search</span>
            <span className="search-submit-icon">
              <SearchIcon size={20} />
            </span>
          </button>
        </form>
        <div className="search-meta">
          <span className="eyebrow">Local catalog</span>
          <span
            className="search-help"
            id="search-status"
            aria-live="polite"
          >
            {statusText}
          </span>
        </div>
      </section>

      {tooShort && (
        <div className="panel search-hint" role="status">
          <span className="eyebrow">Search / Minimum three characters</span>
          <h2>Keep typing.</h2>
          <p>Search starts at three characters. Try a track title or artist.</p>
        </div>
      )}

      {!tooShort && tracksQuery.isLoading && (
        <div className="panel">
          <p className="muted">Opening the shelves…</p>
        </div>
      )}

      {!tooShort && tracksQuery.isError && (
        <div className="form-error" role="alert">
          The library could not be loaded.
        </div>
      )}

      {showEmptySearch && (
        <div className="panel search-empty">
          <span className="eyebrow">Search / No matches</span>
          <h2 className="search-query">
            No matches for “{query}”.
          </h2>
          <p>Try another title or artist, or browse the full archive.</p>
          <ImportRequest query={query} />
          <button
            type="button"
            className="button button-quiet"
            onClick={clearSearch}
          >
            Clear search
          </button>
        </div>
      )}

      {showEmptyLibrary && (
        <div className="library-hero">
          <div className="sleeve-stage" aria-hidden="true">
            <div className="sleeve-record" />
            <div className="sleeve">
              <span className="sleeve-code">SR–001</span>
              <span className="sleeve-title">Personal archive</span>
              <span className="sleeve-foot">33⅓ RPM · Stereo</span>
            </div>
          </div>

          <div className="library-copy">
            <span className="eyebrow">Shelf 01 / Empty</span>
            <h2>The shelves are waiting.</h2>
            <p>
              Search and playback are ready. Add the first recording and the
              room will fill up from there; playlists arrive in the next
              movement.
            </p>

            <ul className="coming-list" aria-label="Coming next">
              <li>
                <span className="mono">01</span>
                <span>Play and queue</span>
                <span className="mono muted">Ready</span>
              </li>
              <li>
                <span className="mono">02</span>
                <span>Build playlists</span>
                <span className="mono muted">Next</span>
              </li>
              <li>
                <span className="mono">03</span>
                <span>Discover similar</span>
                <span className="mono muted">Later</span>
              </li>
            </ul>

            {canEdit ? (
              <div className="library-actions">
                <Link to="/upload" className="button button-primary">
                  Add a recording
                </Link>
                <p className="role-note">
                  As an editor, you can add the first recording to the archive.
                </p>
              </div>
            ) : (
              <p className="role-note">
                Your administrator will add recordings to the archive.
              </p>
            )}
          </div>
        </div>
      )}

      {showResults && (
        <section className="track-index">
          <div className="track-index-head">
            <div>
              <span className="eyebrow">
                Shelf 01 / {total} {total === 1 ? "recording" : "recordings"}
              </span>
              <h2>
                {isSearching ? `Results for “${query}”` : "Most played"}
              </h2>
            </div>
            {canEdit && (
              <Link
                to="/upload"
                className="button button-primary button-small"
              >
                Add recording
              </Link>
            )}
          </div>

          <div className="track-range">
            <span className="mono">
              Showing {firstResult}–{lastResult} of {total}
            </span>
            {totalPages > 1 && (
              <span className="mono">
                Page {page} / {totalPages}
              </span>
            )}
          </div>

          <ol className="track-list">
            {tracks.map((track, index) => (
              <li
                className={
                  currentTrack?.id === track.id ? "is-current-track" : undefined
                }
                key={track.id}
                style={artStyle(track)}
              >
                <button
                  type="button"
                  className="track-play-surface"
                  onClick={() => handleTrackAction("play", track)}
                  aria-label={`Play ${track.title}`}
                >
                  <span className="track-number mono">
                    {String((page - 1) * pageSize + index + 1).padStart(2, "0")}
                  </span>
                  <span className="track-artwork" aria-hidden="true">
                    <span>{trackInitials(track)}</span>
                  </span>
                  <span className="track-main">
                    <strong>{track.title}</strong>
                    <span>
                      {track.artist_name}
                      {track.album_title ? ` · ${track.album_title}` : ""}
                    </span>
                    {track.play_count ? (
                      <span className="track-play-count mono">
                        {track.play_count} play
                        {track.play_count === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </span>
                  <span className="track-duration mono">
                    {formatDuration(track.duration_seconds)}
                  </span>
                </button>
                <span className="track-actions">
                  <button
                    type="button"
                    className="track-action track-action-play"
                    onClick={() => handleTrackAction("play", track)}
                    title="Play now"
                    aria-label={`Play ${track.title}`}
                  >
                    <PlayIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="track-action track-action-quiet"
                    onClick={() => handleTrackAction("queue", track)}
                    title="Add to queue"
                    aria-label={`Add ${track.title} to queue`}
                  >
                    <PlusIcon size={18} />
                  </button>
                  {user?.role === "admin" && (
                    <button
                      type="button"
                      className="track-action track-action-danger"
                      onClick={() => handleDeleteTrack(track)}
                      disabled={deleteMutation.isPending}
                      title="Delete from server"
                      aria-label={`Delete ${track.title} from server`}
                    >
                      <TrashIcon size={17} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {notice && (
            <p className="track-notice" role="status">
              {notice}
            </p>
          )}

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Library pages">
              <button
                type="button"
                className="button button-quiet"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="mono">
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </nav>
          )}

          <p className="role-note">
            Playback continues while you browse. Open the console below for the
            full queue.
          </p>
        </section>
      )}

      {showResults && isSearching && page === 1 && (
        <section className="panel external-results">
          <ImportRequest query={query} hasLocalResults />
        </section>
      )}
    </section>
  );
}
