import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createImportJob, getImportJob, getTrack } from "./api";
import { ACTIVE_IMPORT_STATUSES } from "./importStatus";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type PlayerTrack,
} from "./playerState";
import type {
  ImportJobStatus,
  ImportPreviewCandidate,
  Track,
} from "./types";

export interface QueuedImport {
  id: string;
  videoId: string;
  jobId: string | null;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  status: ImportJobStatus | null;
  error: string | null;
}

interface PlayerContextValue {
  state: PlayerState;
  currentTrack: PlayerTrack | null;
  playTrack: (track: Track, queue?: Track[]) => void;
  startImport: (
    query: string,
    candidate: ImportPreviewCandidate,
  ) => Promise<void>;
  queueImport: (
    query: string,
    candidate: ImportPreviewCandidate,
  ) => Promise<boolean>;
  queuedImports: QueuedImport[];
  dismissQueuedImport: (id: string) => void;
  enqueue: (track: Track) => boolean;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  playAt: (index: number) => void;
  removeAt: (index: number) => void;
  removeTrack: (trackId: string) => void;
  clearQueue: () => void;
  setExpanded: (expanded: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  dismissError: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);
  const [queuedImports, setQueuedImports] = useState<QueuedImport[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const importRequestRef = useRef(0);
  const aliveRef = useRef(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const currentTrack = state.queue[state.currentIndex] ?? null;
  const currentTrackId = currentTrack?.id ?? null;
  const currentSource =
    currentTrack && !currentTrack.pending
      ? `/api/tracks/${currentTrack.id}/stream`
      : null;
  const pendingJobId = currentTrack?.pending
    ? (currentTrack.import_job_id ?? null)
    : null;

  const importJobQuery = useQuery({
    queryKey: ["player-import-job", pendingJobId],
    queryFn: () => getImportJob(pendingJobId as string),
    enabled: Boolean(pendingJobId),
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.status;
      return status && ACTIVE_IMPORT_STATUSES.includes(status) ? 2000 : false;
    },
  });

  const completedTrackId =
    importJobQuery.data?.status === "completed"
      ? importJobQuery.data.track_id
      : null;

  const completedTrackQuery = useQuery({
    queryKey: ["track", completedTrackId],
    queryFn: () => getTrack(completedTrackId as string),
    enabled: Boolean(completedTrackId) && Boolean(pendingJobId),
  });

  useEffect(() => {
    if (!pendingJobId || !importJobQuery.data) {
      return;
    }
    dispatch({
      type: "importStatus",
      status: importJobQuery.data.status,
    });
    if (
      importJobQuery.data.status === "failed" ||
      importJobQuery.data.status === "cancelled"
    ) {
      dispatch({
        type: "importFailed",
        error:
          importJobQuery.data.error_message ??
          "The external release could not be imported.",
      });
    }
    if (
      importJobQuery.data.status === "completed" &&
      !importJobQuery.data.track_id
    ) {
      dispatch({
        type: "importFailed",
        error: "The imported recording could not be located.",
      });
    }
  }, [importJobQuery.data, pendingJobId]);

  useEffect(() => {
    if (!completedTrackQuery.data || !pendingJobId) {
      return;
    }
    dispatch({ type: "importCompleted", track: completedTrackQuery.data });
    queryClient.invalidateQueries({ queryKey: ["tracks"] });
  }, [completedTrackQuery.data, pendingJobId, queryClient]);

  useEffect(() => {
    if (completedTrackQuery.isError && pendingJobId) {
      dispatch({
        type: "importFailed",
        error: "The imported recording could not be loaded.",
      });
    }
  }, [completedTrackQuery.isError, pendingJobId]);

  const playTrack = useCallback((track: Track, queue?: Track[]) => {
    dispatch({ type: "play", track, queue });
  }, []);

  const startImport = useCallback(
    async (query: string, candidate: ImportPreviewCandidate) => {
      if (candidate.duration_seconds === null) {
        return;
      }
      const requestId = importRequestRef.current + 1;
      importRequestRef.current = requestId;
      const pendingTrack: PlayerTrack = {
        id: `import-${candidate.video_id}`,
        title: candidate.title,
        artist_name: candidate.artist,
        album_title: null,
        release_year: null,
        duration_seconds: candidate.duration_seconds,
        mime_type: "audio/mpeg",
        source_type: "youtube",
        is_available: false,
        created_at: new Date().toISOString(),
        pending: true,
        thumbnail_url: candidate.thumbnail_url,
      };
      dispatch({ type: "beginImport", track: pendingTrack });
      try {
        const job = await createImportJob(query, {
          video_id: candidate.video_id,
          title: candidate.title,
          artist: candidate.artist,
          duration_seconds: candidate.duration_seconds,
        });
        if (importRequestRef.current !== requestId) {
          return;
        }
        dispatch({ type: "importJob", jobId: job.id, status: job.status });
      } catch (error) {
        if (importRequestRef.current !== requestId) {
          return;
        }
        dispatch({
          type: "importFailed",
          error:
            error instanceof Error
              ? error.message
              : "The import could not be requested.",
        });
      }
    },
    [],
  );

  const queueImport = useCallback(
    async (query: string, candidate: ImportPreviewCandidate) => {
      if (candidate.duration_seconds === null) {
        return false;
      }
      const isActive = (entry: QueuedImport) =>
        entry.status === null ||
        ACTIVE_IMPORT_STATUSES.includes(entry.status);
      if (
        queuedImports.some(
          (entry) =>
            entry.videoId === candidate.video_id && isActive(entry),
        )
      ) {
        return false;
      }

      const localId = `queue-${candidate.video_id}-${Date.now()}`;
      const entry: QueuedImport = {
        id: localId,
        videoId: candidate.video_id,
        jobId: null,
        title: candidate.title,
        artist: candidate.artist,
        thumbnailUrl: candidate.thumbnail_url,
        status: null,
        error: null,
      };
      setQueuedImports((current) => [
        ...current.filter((item) => item.videoId !== candidate.video_id),
        entry,
      ]);

      const updateEntry = (
        updater: (current: QueuedImport) => QueuedImport,
      ) => {
        setQueuedImports((current) =>
          current.map((item) => (item.id === localId ? updater(item) : item)),
        );
      };

      async function poll(localId: string, jobId: string) {
        while (aliveRef.current) {
          let job;
          try {
            job = await getImportJob(jobId);
          } catch (error) {
            if (!aliveRef.current) {
              return;
            }
            updateEntry((current) => ({
              ...current,
              status: "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "The import status could not be loaded.",
            }));
            return;
          }
          if (!aliveRef.current) {
            return;
          }
          updateEntry((current) => ({
            ...current,
            status: job.status,
            error:
              job.status === "failed"
                ? (job.error_message ?? "The import failed.")
                : job.status === "cancelled"
                  ? "The import was cancelled."
                  : null,
          }));

          if (job.status === "completed") {
            if (!job.track_id) {
              updateEntry((current) => ({
                ...current,
                status: "failed",
                error: "The imported recording could not be located.",
              }));
              return;
            }
            try {
              const track = await getTrack(job.track_id);
              if (!aliveRef.current) {
                return;
              }
              dispatch({ type: "enqueue", track });
              setQueuedImports((current) =>
                current.filter((item) => item.id !== localId),
              );
              queryClient.invalidateQueries({ queryKey: ["tracks"] });
            } catch (error) {
              updateEntry((current) => ({
                ...current,
                status: "failed",
                error:
                  error instanceof Error
                    ? error.message
                    : "The imported recording could not be loaded.",
              }));
            }
            return;
          }

          if (job.status === "failed" || job.status === "cancelled") {
            return;
          }

          await new Promise((resolve) =>
            window.setTimeout(resolve, 2000),
          );
        }
      }

      try {
        const job = await createImportJob(query, {
          video_id: candidate.video_id,
          title: candidate.title,
          artist: candidate.artist,
          duration_seconds: candidate.duration_seconds,
        });
        if (!aliveRef.current) {
          return false;
        }
        updateEntry((current) => ({
          ...current,
          jobId: job.id,
          status: job.status,
        }));
        void poll(localId, job.id);
        return true;
      } catch (error) {
        if (aliveRef.current) {
          updateEntry((current) => ({
            ...current,
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "The import could not be requested.",
          }));
        }
        return false;
      }
    },
    [queryClient, queuedImports],
  );

  const dismissQueuedImport = useCallback((id: string) => {
    setQueuedImports((current) => current.filter((item) => item.id !== id));
  }, []);

  const enqueue = useCallback(
    (track: Track) => {
      if (state.queue.some((queued) => queued.id === track.id)) {
        return false;
      }
      dispatch({ type: "enqueue", track });
      return true;
    },
    [state.queue],
  );

  const toggle = useCallback(() => {
    dispatch({ type: "toggle" });
  }, []);

  const next = useCallback(() => {
    dispatch({ type: "next" });
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(time)) {
      audio.currentTime = Math.max(0, time);
    }
    dispatch({ type: "seek", time });
  }, []);

  const previous = useCallback(() => {
    if (state.currentIndex <= 0 || state.currentTime > 3) {
      seek(0);
      return;
    }
    dispatch({ type: "previous" });
  }, [seek, state.currentIndex, state.currentTime]);

  const playAt = useCallback((index: number) => {
    dispatch({ type: "playAt", index });
  }, []);

  const removeAt = useCallback((index: number) => {
    dispatch({ type: "remove", index });
  }, []);

  const removeTrack = useCallback(
    (trackId: string) => {
      const index = state.queue.findIndex((track) => track.id === trackId);
      if (index !== -1) {
        dispatch({ type: "remove", index });
      }
    },
    [state.queue],
  );

  const clearQueue = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  const setExpanded = useCallback((expanded: boolean) => {
    dispatch({ type: "expanded", expanded });
  }, []);

  const setVolume = useCallback((volume: number) => {
    dispatch({ type: "volume", volume });
  }, []);

  const toggleMute = useCallback(() => {
    dispatch({ type: "muted", muted: !state.muted });
  }, [state.muted]);

  const dismissError = useCallback(() => {
    dispatch({ type: "error", error: null });
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!currentSource) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const absoluteSource = new URL(currentSource, window.location.href).href;
    if (audio.src !== absoluteSource) {
      audio.src = currentSource;
      audio.load();
    }

    audio.currentTime = 0;
    if (state.isPlaying) {
      void audio.play().catch(() => undefined);
    }
  }, [currentSource, currentTrackId, state.playToken]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || currentTrack.pending) {
      return;
    }
    if (state.isPlaying) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [currentTrack, state.isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = state.volume;
    audio.muted = state.muted;
  }, [state.muted, state.volume]);

  useEffect(() => {
    if (!state.expanded) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [setExpanded, state.expanded]);

  useEffect(() => {
    if (
      !("mediaSession" in navigator) ||
      !currentTrack ||
      currentTrack.pending
    ) {
      return;
    }

    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist_name,
        album: currentTrack.album_title ?? "Soundroom",
        artwork: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      });
    }

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => dispatch({ type: "setPlaying", playing: true })],
      ["pause", () => dispatch({ type: "setPlaying", playing: false })],
      ["previoustrack", previous],
      ["nexttrack", next],
      [
        "seekbackward",
        (details) =>
          seek(
            (audioRef.current?.currentTime ?? 0) - (details.seekOffset ?? 10),
          ),
      ],
      [
        "seekforward",
        (details) =>
          seek(
            (audioRef.current?.currentTime ?? 0) + (details.seekOffset ?? 10),
          ),
      ],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") {
            seek(details.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported actions vary by browser.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore actions the browser does not support.
        }
      }
    };
  }, [currentTrack, next, previous, seek]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = state.isPlaying
        ? "playing"
        : "paused";
    }
  }, [state.isPlaying]);

  useEffect(() => {
    if (
      !("mediaSession" in navigator) ||
      !currentTrack ||
      currentTrack.pending ||
      !("setPositionState" in navigator.mediaSession)
    ) {
      return;
    }
    const duration =
      state.duration > 0 ? state.duration : currentTrack.duration_seconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(state.currentTime, 0), duration),
      });
    } catch {
      // Some browsers reject position updates before metadata is ready.
    }
  }, [currentTrack, state.currentTime, state.duration]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      state,
      currentTrack,
      playTrack,
      startImport,
      queueImport,
      queuedImports,
      dismissQueuedImport,
      enqueue,
      toggle,
      next,
      previous,
      seek,
      playAt,
      removeAt,
      removeTrack,
      clearQueue,
      setExpanded,
      setVolume,
      toggleMute,
      dismissError,
    }),
    [
      clearQueue,
      currentTrack,
      dismissError,
      dismissQueuedImport,
      enqueue,
      next,
      playAt,
      playTrack,
      previous,
      queueImport,
      queuedImports,
      removeAt,
      removeTrack,
      seek,
      setExpanded,
      setVolume,
      startImport,
      state,
      toggle,
      toggleMute,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        className="player-audio"
        preload="metadata"
        onDurationChange={(event) =>
          dispatch({
            type: "duration",
            duration: event.currentTarget.duration,
          })
        }
        onLoadedMetadata={(event) =>
          dispatch({
            type: "duration",
            duration: event.currentTarget.duration,
          })
        }
        onTimeUpdate={(event) =>
          dispatch({
            type: "time",
            time: event.currentTarget.currentTime,
            duration: event.currentTarget.duration,
          })
        }
        onEnded={() => dispatch({ type: "ended" })}
        onError={() => {
          if (currentTrack) {
            dispatch({
              type: "error",
              error: "This recording could not be played.",
            });
          }
        }}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside PlayerProvider");
  }
  return context;
}
