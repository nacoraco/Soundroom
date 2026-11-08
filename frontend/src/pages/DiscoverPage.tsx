import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  ApiError,
  addPlaylistItem,
  createPlaylist,
  discoverSimilar,
  listTracks,
} from "../api";
import { usePlayer } from "../player";
import { formatTime } from "../playerVisuals";
import type { DiscoverRecommendation, Track } from "../types";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function matchPercent(recommendation: DiscoverRecommendation): number {
  if (recommendation.seed_count <= 0) {
    return 0;
  }
  return Math.min(
    100,
    Math.round(
      (recommendation.score / recommendation.seed_count) * 100,
    ),
  );
}

export function DiscoverPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { playTrack, enqueue } = usePlayer();
  const [seeds, setSeeds] = useState<Track[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!nameTouched && seeds[0]) {
      setPlaylistName(`Similar to ${seeds[0].title}`);
    }
  }, [nameTouched, seeds]);

  const searchQueryResult = useQuery({
    queryKey: ["discover-track-search", searchQuery],
    queryFn: () => listTracks({ q: searchQuery, page: 1 }),
    enabled: searchQuery.length >= 3,
  });

  const discoverMutation = useMutation({
    mutationFn: () => discoverSimilar(seeds.map((track) => track.id)),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const recommendations = discoverMutation.data?.recommendations ?? [];
      if (recommendations.length === 0) {
        throw new Error("There are no recommendations to save.");
      }
      const playlist = await createPlaylist({
        name: playlistName.trim() || "Similar discoveries",
      });
      for (const recommendation of recommendations) {
        await addPlaylistItem(playlist.id, recommendation.track.id);
      }
      return playlist;
    },
    onSuccess: (playlist) => {
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      navigate(`/playlists/${playlist.id}`);
    },
  });

  const recommendations = discoverMutation.data?.recommendations ?? [];
  const resultTracks = recommendations.map(
    (recommendation) => recommendation.track,
  );
  const canAddSeed = seeds.length < 3;

  function addSeed(track: Track) {
    if (
      !canAddSeed ||
      seeds.some((seed) => seed.id === track.id)
    ) {
      return;
    }
    discoverMutation.reset();
    setSeeds((current) => [...current, track]);
  }

  function removeSeed(trackId: string) {
    discoverMutation.reset();
    setSeeds((current) => current.filter((track) => track.id !== trackId));
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Discovery / Adjacent frequencies</span>
          <h1>Discover similar</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Method</span>
          <span>Last.fm similarity · local catalog only</span>
        </div>
      </header>

      <div className="discover-layout">
        <section className="panel discover-seed-panel">
          <div className="panel-head">
            <span className="eyebrow">Starting points</span>
            <h2>Choose 1–3 records</h2>
          </div>
          <p className="discover-panel-copy">
            Pick the records that set the direction. A fourth seed is not
            allowed.
          </p>

          {seeds.length > 0 && (
            <ul className="discover-seed-list" aria-label="Selected seeds">
              {seeds.map((track, index) => (
                <li className="discover-seed" key={track.id}>
                  <span className="discover-seed-index mono">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="discover-seed-copy">
                    <strong>{track.title}</strong>
                    <span>{track.artist_name}</span>
                  </span>
                  <button
                    type="button"
                    className="discover-seed-remove"
                    onClick={() => removeSeed(track.id)}
                    aria-label={`Remove ${track.title} as a seed`}
                    title="Remove seed"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="field discover-search-field">
            <span>Search the local library</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Title or artist"
              autoComplete="off"
            />
          </label>

          {searchQuery.length > 0 && searchQuery.length < 3 && (
            <p className="discover-hint muted">
              Type at least 3 characters.
            </p>
          )}

          {searchQuery.length >= 3 && searchQueryResult.isLoading && (
            <p className="discover-hint muted">Searching the archive…</p>
          )}

          {searchQueryResult.data && (
            <div className="discover-search-results">
              {searchQueryResult.data.items.map((track) => {
                const selected = seeds.some((seed) => seed.id === track.id);
                return (
                  <div className="discover-search-result" key={track.id}>
                    <span className="discover-search-copy">
                      <strong>{track.title}</strong>
                      <span>
                        {track.artist_name} ·{" "}
                        {formatTime(track.duration_seconds)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() => addSeed(track)}
                      disabled={selected || !canAddSeed}
                    >
                      {selected ? "Selected" : canAddSeed ? "Add seed" : "Limit 3"}
                    </button>
                  </div>
                );
              })}
              {searchQueryResult.data.items.length === 0 && (
                <p className="discover-hint muted">
                  No recordings match this search.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className="button button-primary button-block discover-find-button"
            onClick={() => discoverMutation.mutate()}
            disabled={seeds.length === 0 || discoverMutation.isPending}
          >
            {discoverMutation.isPending ? "Reading similarity…" : "Find similar"}
          </button>
        </section>

        <section className="panel discover-results-panel">
          <div className="panel-head discover-results-head">
            <div>
              <span className="eyebrow">Recommendations</span>
              <h2>Adjacent records</h2>
            </div>
            <span className="mono muted">
              {recommendations.length > 0
                ? `${recommendations.length} / 20`
                : "Local only"}
            </span>
          </div>

          {seeds.length === 0 && (
            <div className="discover-empty">
              <span className="eyebrow">Start with a record</span>
              <h2>Choose a seed from the library.</h2>
              <p>
                Add one to three recordings and we will look for adjacent
                music that is already available here. No downloads are
                triggered.
              </p>
              <Link className="button button-quiet" to="/library">
                Browse the library
              </Link>
            </div>
          )}

          {seeds.length > 0 && (
            <p className="discover-note">
              Searching against the local archive. Last.fm is used only for
              similarity metadata; its availability never affects playback.
            </p>
          )}

          {discoverMutation.isError && (
            <div className="form-error discover-error" role="alert">
              <span>
                {errorMessage(
                  discoverMutation.error,
                  "Recommendations could not be loaded.",
                )}
              </span>
              <button
                type="button"
                className="button button-quiet button-small"
                onClick={() => discoverMutation.mutate()}
              >
                Try again
              </button>
            </div>
          )}

          {discoverMutation.isPending && (
            <p className="muted">Listening for adjacent frequencies…</p>
          )}

          {discoverMutation.data && recommendations.length === 0 && (
            <div className="discover-empty discover-empty-result">
              <span className="eyebrow">No local matches</span>
              <h2>Nothing adjacent found in the archive.</h2>
              <p>
                Try different seeds, or search the library for a recording you
                want to listen to. Nothing will be imported automatically.
              </p>
              <Link className="button button-quiet" to="/library">
                Go to search
              </Link>
            </div>
          )}

          {recommendations.length > 0 && (
            <>
              <ol className="discover-list">
                {recommendations.map((recommendation, index) => {
                  const percent = matchPercent(recommendation);
                  return (
                    <li className="discover-item" key={recommendation.track.id}>
                      <span className="discover-item-index mono">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="discover-item-copy">
                        <strong>{recommendation.track.title}</strong>
                        <span>{recommendation.track.artist_name}</span>
                      </span>
                      <span className="discover-match">
                        <strong>{percent}%</strong>
                        <span className="mono">
                          {recommendation.seed_count}{" "}
                          {recommendation.seed_count === 1 ? "seed" : "seeds"}
                        </span>
                      </span>
                      <span className="discover-item-actions">
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() =>
                            playTrack(recommendation.track, resultTracks)
                          }
                        >
                          Play
                        </button>
                        <button
                          type="button"
                          className="button button-quiet button-small"
                          onClick={() => enqueue(recommendation.track)}
                        >
                          + Queue
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>

              <form className="discover-save" onSubmit={handleSave}>
                <label className="field">
                  <span>Save recommendation as a playlist</span>
                  <input
                    value={playlistName}
                    onChange={(event) => {
                      setNameTouched(true);
                      setPlaylistName(event.target.value);
                    }}
                    maxLength={200}
                    placeholder="Name this discovery"
                  />
                </label>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={
                    saveMutation.isPending ||
                    !playlistName.trim()
                  }
                >
                  {saveMutation.isPending ? "Saving…" : "Save as playlist"}
                </button>
              </form>
              {saveMutation.isError && (
                <p className="form-error" role="alert">
                  {errorMessage(
                    saveMutation.error,
                    "The playlist could not be saved.",
                  )}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
