import { usePlayer } from "../player";
import {
  artStyle,
  formatTime,
  importStatusLabel,
  rangeStyle,
  trackInitials,
} from "../playerVisuals";
import {
  CloseIcon,
  ExpandIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
} from "./playerIcons";

export function PlayerBar() {
  const {
    state,
    currentTrack,
    toggle,
    next,
    previous,
    seek,
    setExpanded,
    clearQueue,
    dismissError,
    queuedImports,
  } = usePlayer();

  if (!currentTrack) {
    return null;
  }

  const isPending = Boolean(currentTrack.pending);
  const duration = state.duration || currentTrack.duration_seconds || 0;
  const position = Math.min(state.currentTime, duration);
  const canNext = state.currentIndex < state.queue.length - 1;
  const queueCount = state.queue.length + queuedImports.length;
  const importStatus = currentTrack.pending_status ?? state.importStatus;
  const importError = currentTrack.pending_error ?? state.importError;
  const error = importError ?? state.error;
  const status = importError
    ? "Import failed"
    : isPending
      ? importStatusLabel(importStatus)
      : state.error
        ? "Playback issue"
        : state.isPlaying
          ? "Now playing"
          : "Paused";

  return (
    <section
      className="player-bar"
      aria-label="Now playing"
      style={artStyle(currentTrack)}
    >
      <div className="player-bar-progress-line" aria-hidden="true">
        <span
          style={{
            width: `${duration > 0 ? (position / duration) * 100 : 0}%`,
          }}
        />
      </div>

      <button
        type="button"
        className={`player-bar-thumb ${state.isPlaying ? "is-playing" : ""}`}
        onClick={() => setExpanded(true)}
        aria-label="Open full player"
      >
        {isPending && currentTrack.thumbnail_url ? (
          <img
            className="player-bar-thumb-image"
            src={currentTrack.thumbnail_url}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <>
            <span className="player-bar-vinyl" />
            <span className="player-bar-initials">
              {trackInitials(currentTrack)}
            </span>
          </>
        )}
      </button>

      <div className="player-bar-meta">
        <span className="eyebrow player-bar-status">{status}</span>
        <strong className="player-bar-title" title={currentTrack.title}>
          {currentTrack.title}
        </strong>
        <span className="player-bar-artist">
          {currentTrack.artist_name}
          {currentTrack.album_title ? ` · ${currentTrack.album_title}` : ""}
        </span>
      </div>

      <div className="player-bar-transport">
        <button
          type="button"
          className="player-icon-button"
          onClick={previous}
          aria-label="Previous track"
          title="Previous"
          disabled={isPending}
        >
          <PreviousIcon size={18} />
        </button>
        <button
          type="button"
          className={`player-play-button ${isPending ? "is-pending" : ""}`}
          onClick={toggle}
          aria-label={isPending ? "Waiting for import" : state.isPlaying ? "Pause" : "Play"}
          title={isPending ? "Waiting for import" : state.isPlaying ? "Pause" : "Play"}
          disabled={isPending}
        >
          {isPending ? (
            <span className="player-loader" aria-hidden="true" />
          ) : state.isPlaying ? (
            <PauseIcon size={20} />
          ) : (
            <PlayIcon size={20} />
          )}
        </button>
        <button
          type="button"
          className="player-icon-button"
          onClick={next}
          aria-label="Next track"
          title="Next"
          disabled={isPending || !canNext}
        >
          <NextIcon size={18} />
        </button>
      </div>

      <div className="player-bar-scrub">
        <span className="player-time mono">{formatTime(position)}</span>
        <input
          className="player-range"
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

      <div className="player-bar-tools">
        <button
          type="button"
          className="player-queue-button"
          onClick={() => setExpanded(true)}
          aria-label={`Open queue, ${state.queue.length} tracks`}
          title="Queue"
        >
          <QueueIcon size={17} />
          <span>{queueCount}</span>
        </button>
        <button
          type="button"
          className="player-icon-button player-expand-button"
          onClick={() => setExpanded(true)}
          aria-label="Expand player"
          title="Expand"
        >
          <ExpandIcon size={18} />
        </button>
      </div>

      {error && (
        <div className="player-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="player-error-dismiss"
            onClick={isPending ? clearQueue : dismissError}
            aria-label={
              isPending ? "Dismiss failed import" : "Dismiss playback error"
            }
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
