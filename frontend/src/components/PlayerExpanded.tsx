import { useEffect, useState } from "react";

import { usePlayer } from "../player";
import type { PlayerTrack } from "../playerState";
import {
  artStyle,
  formatTime,
  importStatusLabel,
  rangeStyle,
  trackInitials,
} from "../playerVisuals";
import {
  CloseIcon,
  MutedIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RemoveIcon,
  VolumeIcon,
} from "./playerIcons";

export function PlayerExpanded() {
  const {
    state,
    currentTrack,
    toggle,
    next,
    previous,
    seek,
    playAt,
    removeAt,
    clearQueue,
    setExpanded,
    setVolume,
    toggleMute,
    queuedImports,
    dismissQueuedImport,
  } = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);

  useEffect(() => {
    if (!queueOpen) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        setQueueOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [queueOpen]);

  if (!state.expanded || !currentTrack) {
    return null;
  }

  const isPending = Boolean(currentTrack.pending);
  const duration = state.duration || currentTrack.duration_seconds || 0;
  const position = Math.min(state.currentTime, duration);
  const canNext = state.currentIndex < state.queue.length - 1;
  const volumeValue = state.muted ? 0 : state.volume;
  const sourceLabel = isPending
    ? "Incoming YouTube pressing"
    : currentTrack.source_type === "youtube"
      ? "Imported pressing"
      : "Local pressing";

  const upcoming = state.queue
    .map((track, index) => ({ track, index }))
    .slice(state.currentIndex + 1);
  const manualUpcoming = upcoming.filter(
    ({ track }) => track.origin !== "auto",
  );
  const recommendedUpcoming = upcoming.filter(
    ({ track }) => track.origin === "auto",
  );

  function renderQueueItem(
    track: PlayerTrack,
    index: number,
    isCurrent: boolean,
  ) {
    const isFailedPending = Boolean(
      track.pending && track.pending_status === "failed",
    );
    return (
      <li
        className={`player-queue-item ${isCurrent ? "is-current" : ""}`}
        key={track.id}
      >
        <button
          type="button"
          className="player-queue-track"
          onClick={() => {
            if (isFailedPending) {
              removeAt(index);
              setQueueOpen(false);
              return;
            }
            playAt(index);
            setQueueOpen(false);
          }}
          aria-current={isCurrent ? "true" : undefined}
        >
          <span className="player-queue-index mono">
            {isCurrent ? (
              <span className="player-queue-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : (
              String(index + 1).padStart(2, "0")
            )}
          </span>
          <span className="player-queue-copy">
            <strong>{track.title}</strong>
            <span>
              {track.pending
                ? (track.pending_error ??
                  importStatusLabel(track.pending_status ?? null))
                : track.artist_name}
            </span>
          </span>
          <span className="player-queue-duration mono">
            {formatTime(track.duration_seconds)}
          </span>
        </button>
        {(!track.pending || isFailedPending) && (
          <button
            type="button"
            className="player-queue-remove"
            onClick={() => removeAt(index)}
            aria-label={
              isFailedPending
                ? `Skip ${track.title}`
                : `Remove ${track.title} from queue`
            }
            title={
              isFailedPending
                ? "Skip failed recommendation"
                : "Remove from queue"
            }
          >
            <RemoveIcon size={14} />
          </button>
        )}
      </li>
    );
  }

  return (
    <div
      className="player-expanded"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-expanded-title"
    >
      <div className="player-expanded-atmosphere" aria-hidden="true" />

      <header className="player-expanded-top">
        <div>
          <span className="eyebrow">
            {isPending ? "Soundroom / Importing" : "Soundroom / Now playing"}
          </span>
          <span className="player-expanded-serial mono">
            {isPending
              ? "INCOMING"
              : `SR–${String(currentTrack.id.slice(0, 4)).toUpperCase()}`}
          </span>
        </div>
        <button
          type="button"
          className="player-close"
          onClick={() => setExpanded(false)}
          aria-label="Close full player"
        >
          <span>Close</span>
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="player-expanded-grid">
        <section className="player-stage" aria-label="Current track">
          {isPending ? (
            <div className="player-art player-art-pending">
              {currentTrack.thumbnail_url ? (
                <img
                  src={currentTrack.thumbnail_url}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="player-art-pending-initials">
                  {trackInitials(currentTrack)}
                </span>
              )}
              <div className="player-art-pending-overlay">
                <span className="eyebrow">Incoming release</span>
                <span className="player-art-pending-status">
                  {importStatusLabel(
                    currentTrack.pending_status ?? state.importStatus,
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div
              className={`player-art ${state.isPlaying ? "is-playing" : ""}`}
              style={artStyle(currentTrack)}
            >
              <div className="player-art-disc" aria-hidden="true" />
              <div className="player-art-sleeve">
                <span className="player-art-code mono">
                  {currentTrack.source_type === "youtube"
                    ? "IMP / 01"
                    : "LOC / 01"}
                </span>
                <span className="player-art-initials">
                  {trackInitials(currentTrack)}
                </span>
                <span className="player-art-foot mono">{sourceLabel}</span>
              </div>
            </div>
          )}

          <div className="player-track-copy">
            <span className="eyebrow">{currentTrack.artist_name}</span>
            <h2 id="player-expanded-title">{currentTrack.title}</h2>
            <p>
              {currentTrack.album_title ?? "Soundroom archive"}
              {currentTrack.release_year
                ? ` · ${currentTrack.release_year}`
                : ""}
              {" · "}
              <span className="mono">{formatTime(duration)}</span>
            </p>
            {isPending && (
              <div className="player-import-state" role="status">
                <span className="player-loader" aria-hidden="true" />
                <span>
                  {importStatusLabel(
                    currentTrack.pending_status ?? state.importStatus,
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="player-expanded-scrub">
            <span className="player-time mono">{formatTime(position)}</span>
            <input
              className="player-range player-range-large"
              type="range"
              min={0}
              max={duration || 1}
              step={1}
              value={Math.min(position, duration || 1)}
              onChange={(event) => seek(Number(event.target.value))}
              style={rangeStyle(position, duration)}
              aria-label="Seek in track"
              disabled={isPending || duration <= 0}
            />
            <span className="player-time mono">{formatTime(duration)}</span>
          </div>

          <div className="player-expanded-controls">
            <button
              type="button"
              className="player-icon-button player-icon-large"
              onClick={previous}
              aria-label="Previous track"
              title="Previous"
              disabled={isPending}
            >
              <PreviousIcon size={22} />
            </button>
            <button
              type="button"
              className={`player-play-button player-play-large ${
                isPending ? "is-pending" : ""
              }`}
              onClick={toggle}
              aria-label={
                isPending
                  ? "Waiting for import"
                  : state.isPlaying
                    ? "Pause"
                    : "Play"
              }
              title={
                isPending
                  ? "Waiting for import"
                  : state.isPlaying
                    ? "Pause"
                    : "Play"
              }
              disabled={isPending}
            >
              {isPending ? (
                <span className="player-loader" aria-hidden="true" />
              ) : state.isPlaying ? (
                <PauseIcon size={26} />
              ) : (
                <PlayIcon size={26} />
              )}
            </button>
            <button
              type="button"
              className="player-icon-button player-icon-large"
              onClick={next}
              aria-label="Next track"
              title="Next"
              disabled={isPending || !canNext}
            >
              <NextIcon size={22} />
            </button>
          </div>

          <div className="player-expanded-tools">
            <div className="player-volume">
              <button
                type="button"
                className="player-icon-button"
                onClick={toggleMute}
                aria-label={state.muted ? "Unmute" : "Mute"}
                title={state.muted ? "Unmute" : "Mute"}
              >
                {state.muted ? <MutedIcon size={18} /> : <VolumeIcon size={18} />}
              </button>
              <input
                className="player-range player-volume-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volumeValue}
                onChange={(event) => setVolume(Number(event.target.value))}
                style={rangeStyle(volumeValue, 1)}
                aria-label="Volume"
              />
            </div>
            <span className="player-queue-count mono">
              {state.queue.length} in queue
            </span>
          </div>

          {(currentTrack.pending_error || state.importError || state.error) && (
            <div className="player-expanded-error" role="alert">
              <span>
                {currentTrack.pending_error ?? state.importError ?? state.error}
              </span>
              {(currentTrack.pending_error || state.importError) && (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={clearQueue}
                >
                  Dismiss import
                </button>
              )}
            </div>
          )}
        </section>

        {queueOpen && (
          <div
            className="player-queue-backdrop"
            onClick={() => setQueueOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          id="player-queue-panel"
          className={`player-queue ${queueOpen ? "is-open" : ""}`}
          aria-label="Playback queue"
        >
          <header className="player-queue-head">
            <div>
              <span className="eyebrow">The stack</span>
              <h3>{isPending ? "Incoming" : "Up next"}</h3>
            </div>
            <div className="player-queue-head-actions">
              <button
                type="button"
                className="player-queue-clear"
                onClick={clearQueue}
                aria-label="Clear queue"
              >
                Clear
              </button>
              <button
                type="button"
                className="player-queue-close"
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
              >
                <CloseIcon size={15} />
              </button>
            </div>
          </header>

          {state.queue.length === 0 ? (
            <p className="player-queue-empty">
              The queue is empty. Add a recording from the library.
            </p>
          ) : (
            <div className="player-queue-body">
              <section className="player-queue-section player-queue-now">
                <span className="player-queue-section-label mono">
                  Now playing
                </span>
                <ol className="player-queue-list">
                  {renderQueueItem(
                    currentTrack,
                    state.currentIndex,
                    true,
                  )}
                </ol>
              </section>

              {manualUpcoming.length > 0 && (
                <section className="player-queue-section">
                  <span className="player-queue-section-label mono">
                    Your queue
                  </span>
                  <ol className="player-queue-list">
                    {manualUpcoming.map(({ track, index }) =>
                      renderQueueItem(track, index, false),
                    )}
                  </ol>
                </section>
              )}

              {recommendedUpcoming.length > 0 && (
                <section className="player-queue-section player-queue-recommended">
                  <div className="player-queue-divider">
                    <span className="mono">Recommended</span>
                    <span className="player-queue-divider-count mono">
                      {recommendedUpcoming.length}
                    </span>
                  </div>
                  <ol className="player-queue-list">
                    {recommendedUpcoming.map(({ track, index }) =>
                      renderQueueItem(track, index, false),
                    )}
                  </ol>
                </section>
              )}
            </div>
          )}

          {queuedImports.length > 0 && (
            <div className="player-incoming">
              <span className="eyebrow">Downloading for queue</span>
              {queuedImports.map((entry) => (
                <div
                  className={`player-incoming-item ${
                    entry.error ? "has-error" : ""
                  }`}
                  key={entry.id}
                >
                  <span className="player-incoming-copy">
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.error ?? importStatusLabel(entry.status)}
                    </span>
                  </span>
                  {entry.error && (
                    <button
                      type="button"
                      className="player-queue-remove"
                      onClick={() => dismissQueuedImport(entry.id)}
                      aria-label={`Dismiss failed queue import ${entry.title}`}
                      title="Dismiss"
                    >
                      <RemoveIcon size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="player-queue-foot">
            <QueueIcon size={15} />
            <span className="mono">
              {isPending
                ? "Playback starts automatically when ready"
                : "Queue persists while you browse"}
            </span>
          </div>
        </aside>

        <button
          type="button"
          className="player-queue-fab"
          onClick={() => setQueueOpen(true)}
          aria-label={`Open queue, ${state.queue.length} tracks`}
          aria-controls="player-queue-panel"
          aria-expanded={queueOpen}
          title="Queue"
        >
          <QueueIcon size={20} />
          <span className="player-queue-fab-count">{state.queue.length}</span>
        </button>
      </div>
    </div>
  );
}
