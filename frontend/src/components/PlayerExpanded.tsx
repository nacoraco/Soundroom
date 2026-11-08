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
  } = usePlayer();

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
                  {importStatusLabel(state.importStatus)}
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
                <span>{importStatusLabel(state.importStatus)}</span>
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

          {(state.importError || state.error) && (
            <div className="player-expanded-error" role="alert">
              <span>{state.importError ?? state.error}</span>
              {state.importError && (
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

        <aside className="player-queue" aria-label="Playback queue">
          <header className="player-queue-head">
            <div>
              <span className="eyebrow">The stack</span>
              <h3>{isPending ? "Incoming" : "Up next"}</h3>
            </div>
            <button
              type="button"
              className="player-queue-clear"
              onClick={clearQueue}
              aria-label="Clear queue"
            >
              Clear
            </button>
          </header>

          {state.queue.length === 0 ? (
            <p className="player-queue-empty">
              The queue is empty. Add a recording from the library.
            </p>
          ) : (
            <ol className="player-queue-list">
              {state.queue.map((track, index) => {
                const isCurrent = index === state.currentIndex;
                return (
                  <li
                    className={`player-queue-item ${isCurrent ? "is-current" : ""}`}
                    key={track.id}
                  >
                    <button
                      type="button"
                      className="player-queue-track"
                      onClick={() => playAt(index)}
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
                        <span>{track.artist_name}</span>
                      </span>
                      <span className="player-queue-duration mono">
                        {formatTime(track.duration_seconds)}
                      </span>
                    </button>
                    {!track.pending && (
                      <button
                        type="button"
                        className="player-queue-remove"
                        onClick={() => removeAt(index)}
                        aria-label={`Remove ${track.title} from queue`}
                        title="Remove from queue"
                      >
                        <RemoveIcon size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
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
      </div>
    </div>
  );
}
