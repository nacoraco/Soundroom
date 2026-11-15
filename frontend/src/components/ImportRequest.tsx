import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { getImportConfig, previewImportCandidates } from "../api";
import { usePlayer } from "../player";
import type { ImportPreviewCandidate } from "../types";
import { PlayIcon, PlusIcon } from "./playerIcons";

const EXTERNAL_PAGE_SIZE = 8;

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

function ExternalCandidateRow({
  candidate,
  index,
  maxMinutes,
  query,
  startIndex,
}: {
  candidate: ImportPreviewCandidate;
  index: number;
  maxMinutes: number;
  query: string;
  startIndex: number;
}) {
  const { startImport, queueImport, queuedImports } = usePlayer();
  const views = formatViews(candidate.view_count);
  const queueEntry = queuedImports.find(
    (entry) => entry.videoId === candidate.video_id,
  );
  const queueActive = Boolean(
    queueEntry &&
      queueEntry.status !== "failed" &&
      queueEntry.status !== "cancelled",
  );
  const number = String(startIndex + index + 1).padStart(2, "0");

  return (
    <li
      className={`external-track-row ${
        candidate.within_duration_limit ? "" : "is-disabled"
      }`}
    >
      <div className="track-play-surface external-track-surface">
        <span className="track-number mono">{number}</span>
        <span className="external-track-thumb" aria-hidden="true">
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
        </span>
        <span className="track-main">
          <strong>{candidate.title}</strong>
          <span>
            {candidate.artist}
            {candidate.uploader && candidate.uploader !== candidate.artist
              ? ` · ${candidate.uploader}`
              : ""}
          </span>
          <span className="track-play-count mono">
            YouTube
            {views ? ` · ${views}` : ""}
          </span>
        </span>
        <span className="track-duration mono">
          {formatDuration(candidate.duration_seconds)}
        </span>
      </div>
      <span className="track-actions external-track-actions">
        {candidate.within_duration_limit ? (
          <>
            <button
              type="button"
              className="track-action track-action-play"
              onClick={() => void startImport(query, candidate)}
              title="Play now"
              aria-label={`Play ${candidate.title}`}
            >
              <PlayIcon size={16} />
            </button>
            <button
              type="button"
              className="track-action track-action-quiet"
              onClick={() => void queueImport(query, candidate)}
              disabled={queueActive}
              title={
                queueEntry?.error
                  ? "Retry queue"
                  : queueActive
                    ? "Already queued"
                    : "Add to queue"
              }
              aria-label={`Queue ${candidate.title}`}
            >
              <PlusIcon size={18} />
            </button>
          </>
        ) : (
          <span className="external-track-limit mono">
            {candidate.duration_seconds === null
              ? "Length unknown"
              : `Over ${maxMinutes} min`}
          </span>
        )}
        <a
          className="external-track-link"
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
        >
          YouTube ↗
        </a>
      </span>
    </li>
  );
}

export function ImportRequest({
  query,
  hasLocalResults = false,
  embedded = false,
  startIndex = 0,
}: {
  query: string;
  hasLocalResults?: boolean;
  embedded?: boolean;
  startIndex?: number;
}) {
  const configQuery = useQuery({
    queryKey: ["import-config"],
    queryFn: getImportConfig,
  });

  const previewQuery = useInfiniteQuery({
    queryKey: ["import-preview", query],
    queryFn: ({ pageParam }) =>
      previewImportCandidates(query, {
        offset: pageParam,
        limit: EXTERNAL_PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
    enabled: Boolean(configQuery.data?.auto_rip_on_miss),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const config = configQuery.data;
  const preview = previewQuery.data?.pages[0];
  const candidates =
    previewQuery.data?.pages.flatMap((page) => page.candidates) ?? [];
  const uniqueCandidates = candidates.filter(
    (candidate, index, all) =>
      all.findIndex((item) => item.video_id === candidate.video_id) === index,
  );
  const maxMinutes =
    config?.max_track_minutes ?? preview?.max_track_minutes ?? 15;
  const hasEligibleCandidate = uniqueCandidates.some(
    (candidate) => candidate.within_duration_limit,
  );
  const externalSummary = previewQuery.isError
    ? "Search failed"
    : uniqueCandidates.length > 0
      ? `${uniqueCandidates.length} shown${
          previewQuery.hasNextPage ? " · more available" : ""
        }`
      : previewQuery.isLoading
        ? "Searching releases"
        : "No releases";

  if (configQuery.isLoading) {
    if (embedded) {
      return null;
    }
    return (
      <div className="import-request">
        <p className="muted">Checking import availability…</p>
      </div>
    );
  }

  if (configQuery.isError) {
    if (embedded) {
      return null;
    }
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
    if (embedded) {
      return null;
    }
    return (
      <div className="import-request">
        <p className="muted">Import availability is not available.</p>
      </div>
    );
  }

  if (!config.auto_rip_on_miss) {
    if (embedded) {
      return null;
    }
    return (
      <div className="import-request">
        <p className="muted">
          This recording is not in the library. Automatic import is disabled by
          the administrator.
        </p>
      </div>
    );
  }

  const statusRows = (
    <>
      {previewQuery.isLoading && (
        <li className="external-list-status" role="status">
          <span className="import-preview-pulse" aria-hidden="true" />
          <span>Searching YouTube for releases…</span>
        </li>
      )}

      {previewQuery.isError && (
        <li className="external-list-status is-error" role="alert">
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
        </li>
      )}

      {previewQuery.isFetchNextPageError && (
        <li className="external-list-status is-error" role="alert">
          <span>More releases could not be loaded.</span>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => previewQuery.fetchNextPage()}
          >
            Try again
          </button>
        </li>
      )}

      {!previewQuery.isLoading &&
        !previewQuery.isError &&
        preview &&
        uniqueCandidates.length === 0 && (
          <li className="external-list-status">
            <span>No external releases found for this query.</span>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => previewQuery.refetch()}
            >
              Search again
            </button>
          </li>
        )}
    </>
  );

  const candidateRows = uniqueCandidates.map((candidate, index) => (
    <ExternalCandidateRow
      candidate={candidate}
      index={index}
      key={candidate.video_id}
      maxMinutes={maxMinutes}
      query={query}
      startIndex={startIndex}
    />
  ));

  const footerRows = (
    <>
      {previewQuery.hasNextPage && (
        <li className="external-list-more">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => void previewQuery.fetchNextPage()}
            disabled={previewQuery.isFetchingNextPage}
          >
            {previewQuery.isFetchingNextPage
              ? "Loading more…"
              : "Load more releases"}
          </button>
          <span className="mono">
            {uniqueCandidates.length} shown
            {previewQuery.isFetchingNextPage ? " · loading" : ""}
          </span>
        </li>
      )}

      {uniqueCandidates.length > 0 && (
        <li className="external-list-note mono">
          Max {maxMinutes} min · Play opens the player · Queue downloads in the
          background
        </li>
      )}

      {!hasEligibleCandidate && uniqueCandidates.length > 0 && (
        <li className="external-list-status is-error">
          <span>
            Every external release is over the configured duration limit.
          </span>
        </li>
      )}
    </>
  );

  const rows = (
    <>
      {embedded && (
        <li className="external-list-divider">
          <span className="eyebrow">External / YouTube</span>
          <span className="mono">{externalSummary}</span>
        </li>
      )}
      {statusRows}
      {candidateRows}
      {footerRows}
    </>
  );

  if (embedded) {
    return rows;
  }

  return (
    <div className="import-request" aria-live="polite">
      <div className="import-request-head">
        <span className="eyebrow">External releases / YouTube</span>
      </div>

      {hasLocalResults ? (
        <p>
          Local matches are above. Preview other versions from YouTube, or
          queue one to download in the background.
        </p>
      ) : (
        <p>
          No local match. Press Play on the exact external release. The full
          player opens at 0:00 and starts automatically when the download is
          ready; Queue downloads it in the background.
        </p>
      )}

      <ul className="track-list external-track-list" aria-label="External releases">
        {rows}
      </ul>
    </div>
  );
}
