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

import {
  createImportJob,
  discoverRadio,
  getImportJob,
  getTrack,
} from "./api";
import { ACTIVE_IMPORT_STATUSES } from "./importStatus";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type PlayerTrack,
} from "./playerState";
import {
  RECOMMENDATION_BATCH_SIZE,
  RECOMMENDATION_BUFFER_SIZE,
  addRecommendationHistoryEntry,
  addRecommendationRejection,
  createRecommendationHistoryEntry,
  recommendationKey,
  removeRecommendationHistoryTrack,
  replaceRecommendationHistoryTrack,
  selectRecommendationSeeds,
  shouldRejectSkippedTrack,
  updateRecommendationProgress,
  type RecommendationHistoryEntry,
  type RecommendationSeed,
} from "./recommendationSession";
import type {
  DiscoverRecommendation,
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
  queueExternalRecommendation: (
    recommendation: DiscoverRecommendation,
  ) => Promise<void>;
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
  const recommendationEnabledRef = useRef(false);
  const originalSongRef = useRef<RecommendationSeed | null>(null);
  const recommendationRequestRef = useRef(0);
  const recommendationInFlightRef = useRef(false);
  const recommendationHistoryRef = useRef<RecommendationHistoryEntry[]>([]);
  const recommendationOrderRef = useRef(0);
  const lastActiveTrackIdRef = useRef<string | null>(null);
  const failedRecommendationKeysRef = useRef<RecommendationSeed[]>([]);
  const rejectedRecommendationKeysRef = useRef<RecommendationSeed[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const queryClient = useQueryClient();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const resetRecommendationSession = useCallback(
    (track: PlayerTrack | null) => {
      recommendationRequestRef.current += 1;
      recommendationInFlightRef.current = false;
      recommendationHistoryRef.current = [];
      recommendationOrderRef.current = 0;
      lastActiveTrackIdRef.current = null;
      failedRecommendationKeysRef.current = [];
      originalSongRef.current = track
        ? { title: track.title, artist: track.artist_name }
        : null;
      recommendationEnabledRef.current = Boolean(track);

      if (track) {
        recommendationHistoryRef.current = [
          createRecommendationHistoryEntry(track, recommendationOrderRef.current),
        ];
        recommendationOrderRef.current += 1;
        lastActiveTrackIdRef.current = track.id;
      }
    },
    [],
  );

  const captureProgress = useCallback(
    (trackId: string, progressSeconds: number, durationSeconds: number) => {
      recommendationHistoryRef.current = updateRecommendationProgress(
        recommendationHistoryRef.current,
        trackId,
        progressSeconds,
        durationSeconds,
      );
    },
    [],
  );

  const captureCurrentProgress = useCallback(() => {
    const snapshot = stateRef.current;
    const current = snapshot.queue[snapshot.currentIndex];
    if (!current) {
      return;
    }
    captureProgress(
      current.id,
      snapshot.currentTime,
      snapshot.duration > 0
        ? snapshot.duration
        : current.duration_seconds,
    );
  }, [captureProgress]);

  const removeFailedRecommendation = useCallback((pendingId: string) => {
    const snapshot = stateRef.current;
    const index = snapshot.queue.findIndex(
      (track) => track.id === pendingId,
    );
    if (index === -1) {
      return;
    }
    const track = snapshot.queue[index];
    if (!track.pending) {
      return;
    }
    const title = track.title.trim();
    const artist = track.artist_name.trim();
    failedRecommendationKeysRef.current = [
      ...failedRecommendationKeysRef.current.filter(
        (item) =>
          item.title.toLowerCase() !== title.toLowerCase() ||
          item.artist.toLowerCase() !== artist.toLowerCase(),
      ),
      { title, artist },
    ].slice(-10);
    recommendationHistoryRef.current = removeRecommendationHistoryTrack(
      recommendationHistoryRef.current,
      pendingId,
    );
    dispatch({ type: "remove", index });
  }, []);

  const rejectTrack = useCallback((track: PlayerTrack) => {
    const title = track.title.trim();
    const artist = track.artist_name.trim();
    if (!title || !artist) {
      return;
    }
    rejectedRecommendationKeysRef.current = addRecommendationRejection(
      rejectedRecommendationKeysRef.current,
      { title, artist },
    );
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
    queryClient.invalidateQueries({ queryKey: ["tracks"], refetchType: "none" });
  }, [completedTrackQuery.data, pendingJobId, queryClient]);

  useEffect(() => {
    if (completedTrackQuery.isError && pendingJobId) {
      dispatch({
        type: "importFailed",
        error: "The imported recording could not be loaded.",
      });
    }
  }, [completedTrackQuery.isError, pendingJobId]);

  const startPendingQueryImport = useCallback(
    async (pendingId: string, title: string, artist: string) => {
      try {
        const job = await createImportJob(
          `${artist} ${title}`.trim(),
          undefined,
          true,
        );
        if (!aliveRef.current) {
          return;
        }
        dispatch({
          type: "setPendingJob",
          pendingId,
          jobId: job.id,
          status: job.status,
        });

        async function poll() {
          while (aliveRef.current) {
            let current;
            try {
              current = await getImportJob(job.id);
            } catch (error) {
              if (aliveRef.current) {
                dispatch({
                  type: "setPendingState",
                  pendingId,
                  status: "failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "The import status could not be loaded.",
                });
                removeFailedRecommendation(pendingId);
              }
              return;
            }
            if (!aliveRef.current) {
              return;
            }
            dispatch({
              type: "setPendingState",
              pendingId,
              status: current.status,
              error:
                current.status === "failed"
                  ? (current.error_message ?? "The import failed.")
                  : current.status === "cancelled"
                    ? "The import was cancelled."
                    : null,
            });

            if (current.status === "completed") {
              if (!current.track_id) {
                dispatch({
                  type: "setPendingState",
                  pendingId,
                  status: "failed",
                  error: "The imported recording could not be located.",
                });
                removeFailedRecommendation(pendingId);
                return;
              }
              try {
                const track = await getTrack(current.track_id);
                if (!aliveRef.current) {
                  return;
                }
                dispatch({ type: "replacePending", pendingId, track });
                queryClient.invalidateQueries({ queryKey: ["tracks"], refetchType: "none" });
              } catch (error) {
                dispatch({
                  type: "setPendingState",
                  pendingId,
                  status: "failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "The imported recording could not be loaded.",
                });
                removeFailedRecommendation(pendingId);
              }
              return;
            }

            if (
              current.status === "failed" ||
              current.status === "cancelled"
            ) {
              removeFailedRecommendation(pendingId);
              return;
            }

            await new Promise((resolve) =>
              window.setTimeout(resolve, 2000),
            );
          }
        }

        void poll();
      } catch (error) {
        if (aliveRef.current) {
          dispatch({
            type: "setPendingState",
            pendingId,
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "The import could not be requested.",
          });
          removeFailedRecommendation(pendingId);
        }
      }
    },
    [queryClient, removeFailedRecommendation],
  );

  const generateRecommendation = useCallback(
    async (seeds: RecommendationSeed[], requestId: number) => {
      if (!recommendationEnabledRef.current || seeds.length === 0) {
        return;
      }

      try {
        const snapshot = stateRef.current;
        const start = Math.max(snapshot.currentIndex, 0);
        const queueExclude = [
          ...snapshot.queue.slice(start),
          ...snapshot.queue.slice(0, start),
        ]
          .filter((track) => track.title.trim() && track.artist_name.trim())
          .slice(0, 50)
          .map((track) => ({
            title: track.title,
            artist: track.artist_name,
          }));
        const seenExclude = new Set<string>();
        const exclude = [
          ...rejectedRecommendationKeysRef.current,
          ...failedRecommendationKeysRef.current,
          ...queueExclude,
        ]
          .filter((item) => {
            const key = recommendationKey(item.title, item.artist);
            if (seenExclude.has(key)) {
              return false;
            }
            seenExclude.add(key);
            return true;
          })
          .slice(0, 50);
        const result = await discoverRadio(seeds, {
          limit: RECOMMENDATION_BATCH_SIZE,
          exclude,
        });
        if (
          !aliveRef.current ||
          requestId !== recommendationRequestRef.current ||
          !recommendationEnabledRef.current
        ) {
          return;
        }

        const queueSnapshot = stateRef.current;
        const existingIds = new Set(
          queueSnapshot.queue.map((track) => track.id),
        );
        const existingExternal = new Set(
          queueSnapshot.queue.map(
            (track) =>
              `${track.title.trim().toLowerCase()}|${track.artist_name.trim().toLowerCase()}`,
          ),
        );
        const rejectedKeys = new Set(
          rejectedRecommendationKeysRef.current.map((item) =>
            recommendationKey(item.title, item.artist),
          ),
        );
        const recommendation = result.recommendations.find((item) => {
          if (rejectedKeys.has(recommendationKey(item.title, item.artist))) {
            return false;
          }
          if (
            item.local_track &&
            rejectedKeys.has(
              recommendationKey(
                item.local_track.title,
                item.local_track.artist_name,
              ),
            )
          ) {
            return false;
          }
          if (item.local_track) {
            return !existingIds.has(item.local_track.id);
          }
          const key = `${item.title
            .trim()
            .toLowerCase()}|${item.artist.trim().toLowerCase()}`;
          return !existingExternal.has(key);
        });
        if (!recommendation) {
          return;
        }

        if (recommendation.local_track) {
          dispatch({
            type: "appendAuto",
            tracks: [{ ...recommendation.local_track, origin: "auto" }],
          });
          return;
        }

        const pendingId = `auto-import-${Date.now()}`;
        dispatch({
          type: "appendAuto",
          tracks: [
            {
              id: pendingId,
              title: recommendation.title,
              artist_name: recommendation.artist,
              album_title: null,
              release_year: null,
              duration_seconds: 0,
              mime_type: "audio/mpeg",
              source_type: "youtube",
              is_available: false,
              created_at: new Date().toISOString(),
              pending: true,
              origin: "auto",
              pending_status: null,
              pending_error: null,
            },
          ],
        });
        void startPendingQueryImport(
          pendingId,
          recommendation.title,
          recommendation.artist,
        );
      } catch {
        // Playback and the existing queue stay usable when Last.fm is down.
      }
    },
    [startPendingQueryImport],
  );

  const playTrack = useCallback(
    (track: Track, queue?: Track[]) => {
      resetRecommendationSession(track);
      dispatch({ type: "play", track, queue });
    },
    [resetRecommendationSession],
  );

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
      resetRecommendationSession(pendingTrack);
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
    [resetRecommendationSession],
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
              queryClient.invalidateQueries({ queryKey: ["tracks"], refetchType: "none" });
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

  const queueExternalRecommendation = useCallback(
    async (recommendation: DiscoverRecommendation) => {
      if (recommendation.local_track) {
        enqueue(recommendation.local_track);
        return;
      }
      const pendingId = `discover-import-${Date.now()}`;
      dispatch({
        type: "enqueue",
        track: {
          id: pendingId,
          title: recommendation.title,
          artist_name: recommendation.artist,
          album_title: null,
          release_year: null,
          duration_seconds: 0,
          mime_type: "audio/mpeg",
          source_type: "youtube",
          is_available: false,
          created_at: new Date().toISOString(),
          pending: true,
          pending_status: null,
          pending_error: null,
        },
      });
      void startPendingQueryImport(
        pendingId,
        recommendation.title,
        recommendation.artist,
      );
    },
    [enqueue, startPendingQueryImport],
  );

  const toggle = useCallback(() => {
    dispatch({ type: "toggle" });
  }, []);

  const next = useCallback(() => {
    const snapshot = stateRef.current;
    const current = snapshot.queue[snapshot.currentIndex];
    if (current?.pending && current.pending_status === "failed") {
      removeFailedRecommendation(current.id);
      return;
    }
    captureCurrentProgress();
    if (
      current &&
      shouldRejectSkippedTrack(current, recommendationHistoryRef.current)
    ) {
      rejectTrack(current);
    }
    const failedAheadIndex = snapshot.queue.findIndex(
      (track, index) =>
        index > snapshot.currentIndex &&
        track.pending &&
        track.pending_status === "failed",
    );
    if (failedAheadIndex !== -1) {
      removeFailedRecommendation(
        snapshot.queue[failedAheadIndex].id,
      );
      dispatch({ type: "next" });
      return;
    }
    dispatch({ type: "next" });
  }, [captureCurrentProgress, rejectTrack, removeFailedRecommendation]);

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
    captureCurrentProgress();
    dispatch({ type: "previous" });
  }, [captureCurrentProgress, seek, state.currentIndex, state.currentTime]);

  const playAt = useCallback(
    (index: number) => {
      captureCurrentProgress();
      dispatch({ type: "playAt", index });
    },
    [captureCurrentProgress],
  );

  const removeAt = useCallback(
    (index: number) => {
      const track = stateRef.current.queue[index];
      if (track?.pending && track.pending_status === "failed") {
        removeFailedRecommendation(track.id);
        return;
      }
      captureCurrentProgress();
      if (
        track &&
        shouldRejectSkippedTrack(track, recommendationHistoryRef.current)
      ) {
        rejectTrack(track);
      }
      dispatch({ type: "remove", index });
    },
    [captureCurrentProgress, rejectTrack, removeFailedRecommendation],
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      const index = state.queue.findIndex((track) => track.id === trackId);
      if (index !== -1) {
        const track = state.queue[index];
        if (track.pending && track.pending_status === "failed") {
          removeFailedRecommendation(trackId);
          return;
        }
        captureCurrentProgress();
        if (shouldRejectSkippedTrack(track, recommendationHistoryRef.current)) {
          rejectTrack(track);
        }
        dispatch({ type: "remove", index });
      }
    },
    [
      captureCurrentProgress,
      rejectTrack,
      removeFailedRecommendation,
      state.queue,
    ],
  );

  const clearQueue = useCallback(() => {
    resetRecommendationSession(null);
    dispatch({ type: "clear" });
  }, [resetRecommendationSession]);

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

  useEffect(() => {
    if (!currentTrack) {
      lastActiveTrackIdRef.current = null;
      return;
    }

    const previousTrackId = lastActiveTrackIdRef.current;
    if (previousTrackId === currentTrack.id) {
      return;
    }

    let history = recommendationHistoryRef.current;
    if (previousTrackId) {
      const previousEntry = history.find(
        (entry) => entry.track.id === previousTrackId,
      );
      if (previousEntry?.track.pending && !currentTrack.pending) {
        history = replaceRecommendationHistoryTrack(
          history,
          previousTrackId,
          currentTrack,
        );
      }
    }

    if (!originalSongRef.current) {
      originalSongRef.current = {
        title: currentTrack.title,
        artist: currentTrack.artist_name,
      };
      recommendationEnabledRef.current = true;
      recommendationRequestRef.current += 1;
    }

    if (!history.some((entry) => entry.track.id === currentTrack.id)) {
      history = addRecommendationHistoryEntry(
        history,
        createRecommendationHistoryEntry(
          currentTrack,
          recommendationOrderRef.current,
        ),
      );
      recommendationOrderRef.current += 1;
    }

    recommendationHistoryRef.current = history;
    lastActiveTrackIdRef.current = currentTrack.id;
  }, [currentTrack]);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }
    recommendationHistoryRef.current = updateRecommendationProgress(
      recommendationHistoryRef.current,
      currentTrack.id,
      state.currentTime,
      state.duration > 0 ? state.duration : currentTrack.duration_seconds,
    );
  }, [currentTrack, state.currentTime, state.duration]);

  useEffect(() => {
    if (
      !recommendationEnabledRef.current ||
      recommendationInFlightRef.current ||
      !currentTrack ||
      currentTrack.pending
    ) {
      return;
    }

    const snapshot = stateRef.current;
    const autoAhead = snapshot.queue
      .slice(snapshot.currentIndex + 1)
      .filter((track) => track.origin === "auto").length;
    if (autoAhead >= RECOMMENDATION_BUFFER_SIZE) {
      return;
    }

    const seeds = selectRecommendationSeeds(
      recommendationHistoryRef.current,
      originalSongRef.current,
    );
    if (seeds.length === 0) {
      return;
    }

    const requestId = recommendationRequestRef.current;
    recommendationInFlightRef.current = true;
    void generateRecommendation(seeds, requestId).finally(() => {
      if (requestId === recommendationRequestRef.current) {
        recommendationInFlightRef.current = false;
      }
    });
  }, [currentTrack, generateRecommendation, state.currentIndex, state.queue]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      state,
      currentTrack,
      playTrack,
      startImport,
      queueImport,
      queuedImports,
      dismissQueuedImport,
      queueExternalRecommendation,
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
      queueExternalRecommendation,
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
        onEnded={(event) => {
          const endedTrack =
            stateRef.current.queue[stateRef.current.currentIndex];
          if (endedTrack) {
            captureProgress(
              endedTrack.id,
              event.currentTarget.duration,
              event.currentTarget.duration,
            );
          }
          dispatch({ type: "ended" });
        }}
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
