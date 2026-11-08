import { useQuery } from "@tanstack/react-query";

import { getImportConfig, previewImportCandidates } from "../api";
import { usePlayer } from "../player";
import { PlayIcon } from "./playerIcons";

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "length unknown";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatViews(count: number | null): string | null {
  if (count === null) {
    return null;
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
  }
  return `${count} views`;
}

export function ImportRequest({ query }: { query: string }) {
  const { startImport } = usePlayer();
  const configQuery = useQuery({
    queryKey: ["import-config"],
    queryFn: getImportConfig,
  });

  const previewQuery = useQuery({
    queryKey: ["import-preview", query],
    queryFn: () => previewImportCandidates(query),
    enabled: Boolean(configQuery.data?.auto_rip_on_miss),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const config = configQuery.data;
  const preview = previewQuery.data;
  const maxMinutes = config?.max_track_minutes ?? preview?.max_track_minutes ?? 15;
  const hasEligibleCandidate = Boolean(
    preview?.candidates.some((candidate) => candidate.within_duration_limit),
  );

  if (configQuery.isLoading) {
    return (
      <div className="import-request">
        <p className="muted">Checking import availability…</p>
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="import-request">
        <p className="muted">
          Import availability could not be checked. The recording is not in the
          library.
        </p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="import-request">
        <p className="muted">Import availability is not available.</p>
      </div>
    );
  }

  if (!config.auto_rip_on_miss) {
    return (
      <div className="import-request">
        <p className="muted">
          This recording is not in the library. Automatic import is disabled by
          the administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="import-request" aria-live="polite">
      <div className="import-request-head">
        <span className="eyebrow">Missing recording</span>
      </div>

      <p>
        No local match. Press Play on the exact external release. The full
        player opens at 0:00 and starts automatically when the download is
        ready.
      </p>

      {previewQuery.isLoading && (
        <div className="import-preview-state">
          <span className="import-preview-pulse" aria-hidden="true" />
          <span>Searching YouTube for releases…</span>
        </div>
      )}

      {previewQuery.isError && (
        <div className="import-preview-state import-preview-error">
          <span>
            {previewQuery.error instanceof Error
              ? previewQuery.error.message
              : "External releases could not be loaded."}
          </span>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => previewQuery.refetch()}
          >
            Try again
          </button>
        </div>
      )}

      {preview && preview.candidates.length === 0 && (
        <div className="import-preview-state">
          <span>No external releases found for this query.</span>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => previewQuery.refetch()}
          >
            Search again
          </button>
        </div>
      )}

      {preview && preview.candidates.length > 0 && (
        <>
          <ul className="import-candidates" aria-label="External releases">
            {preview.candidates.map((candidate, index) => {
              const views = formatViews(candidate.view_count);
              return (
                <li className="import-candidate-row" key={candidate.video_id}>
                  <div
                    className={`import-candidate ${
                      candidate.within_duration_limit ? "" : "is-disabled"
                    }`}
                  >
                    <span className="import-candidate-thumb">
                      {candidate.thumbnail_url ? (
                        <img
                          src={candidate.thumbnail_url}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                      <span className="import-candidate-index mono">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <span className="import-candidate-copy">
                      <strong>{candidate.title}</strong>
                      <span className="import-candidate-meta">
                        {candidate.artist}
                        {candidate.uploader &&
                        candidate.uploader !== candidate.artist
                          ? ` · ${candidate.uploader}`
                          : ""}
                      </span>
                      <span className="import-candidate-stats mono">
                        {formatDuration(candidate.duration_seconds)}
                        {views ? ` · ${views}` : ""}
                      </span>
                    </span>
                    {candidate.within_duration_limit ? (
                      <button
                        type="button"
                        className="import-candidate-play"
                        onClick={() => void startImport(query, candidate)}
                        aria-label={`Play ${candidate.title}`}
                      >
                        <PlayIcon size={13} />
                        Play
                      </button>
                    ) : (
                      <span className="import-candidate-state mono">
                        {candidate.duration_seconds === null
                          ? "Length unknown"
                          : `Over ${maxMinutes} min`}
                      </span>
                    )}
                  </div>
                  <a
                    className="import-candidate-link"
                    href={candidate.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    YouTube ↗
                  </a>
                </li>
              );
            })}
          </ul>

          <p className="import-preview-note mono">
            Max {maxMinutes} min · opens the player and starts when ready
          </p>

          {!hasEligibleCandidate && (
            <p className="form-error">
              Every external release is over the configured duration limit.
            </p>
          )}
        </>
      )}
    </div>
  );
}
