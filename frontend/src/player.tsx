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
  cancelImportJob,
  createImportJob,
  getImportJob,
  getRadioBatch,
  getRadioSession,
  getTrack,
  postRadioFeedback,
  postRadioListen,
  updateRadioSession,
} from "./api";
import { ACTIVE_IMPORT_STATUSES } from "./importStatus";
import {
  addNativeMediaSessionListener,
  clearNativeMediaSession,
  updateNativeMediaSession,
} from "./nativeMediaSession";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type PlayerTrack,
} from "./playerState";
import {
  MAX_RECOMMENDATION_EXCLUDE,
  RECOMMENDATION_BATCH_SIZE,
  RECOMMENDATION_BUFFER_SIZE,
  addRecommendationHistoryEntry,
  createRecommendationHistoryEntry,
  recommendationKey,
  removeRecommendationHistoryTrack,
  replaceRecommendationHistoryTrack,
  shouldRejectSkippedTrack,
  updateRecommendationProgress,
  type RecommendationHistoryEntry,
} from "./recommendationSession";
import type {
  DiscoverRecommendation,
  DiscoveryLevel,
  ImportJobStatus,
  ImportPreviewCandidate,
  RadioRecommendation,
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
  radioExhausted: boolean;
  discoveryLevel: DiscoveryLevel;
  setDiscoveryLevel: (level: DiscoveryLevel) => void;
  canUndoSkip: boolean;
  undoLastSkip: () => void;
  dismissRecommendation: (
    track: PlayerTrack,
    mode: "not_now" | "never",
  ) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);
  const [queuedImports, setQueuedImports] = useState<QueuedImport[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const switchingSourceRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const userPausedRef = useRef(false);
  const interruptedRef = useRef(false);
  const lastPlayTokenRef = useRef(state.playToken);
  const lastNativePositionUpdateRef = useRef(0);
  const importRequestRef = useRef(0);
  const aliveRef = useRef(true);
  const [radioExhausted, setRadioExhausted] = useState(false);
  const [radioFetchTick, setRadioFetchTick] = useState(0);
  const [canUndoSkip, setCanUndoSkip] = useState(false);
  const lastSkippedRef = useRef<PlayerTrack | null>(null);
  const [discoveryLevel, setDiscoveryLevelState] =
    useState<DiscoveryLevel>("balanced");
  const radioRequestRef = useRef(0);
  const radioInFlightRef = useRef(false);
  const radioEmptyRetriesRef = useRef(0);
  const radioReserveRef = useRef<RadioRecommendation[]>([]);
  const importStartingRef = useRef<Set<string>>(new Set());
  const cancelledPendingRef = useRef<Set<string>>(new Set());
  const radioPendingSequenceRef = useRef(0);
  const recommendationHistoryRef = useRef<RecommendationHistoryEntry[]>([]);
  const recommendationOrderRef = useRef(0);
  const lastActiveTrackIdRef = useRef<string | null>(null);
  const sessionFailedKeysRef = useRef<Set<string>>(new Set());
  const sessionRejectedKeysRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;
  const queryClient = useQueryClient();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    dispatch({ type: "dedupeAuto" });
  }, [state.queue]);

  useEffect(() => {
    let cancelled = false;
    void getRadioSession()
      .then((session) => {
        if (cancelled) {
          return;
        }
        setDiscoveryLevelState(session.discovery_level);
      })
      .catch(() => {
        // The radio still works locally if the session endpoint is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetRecommendationSession = useCallback(
    (track: PlayerTrack | null) => {
      radioRequestRef.current += 1;
      radioInFlightRef.current = false;
      radioEmptyRetriesRef.current = 0;
      radioReserveRef.current = [];
      setRadioExhausted(false);
      lastSkippedRef.current = null;
      setCanUndoSkip(false);
      recommendationHistoryRef.current = [];
      recommendationOrderRef.current = 0;
      lastActiveTrackIdRef.current = null;

      if (track) {
        recommendationHistoryRef.current = [
          createRecommendationHistoryEntry(
            track,
            recommendationOrderRef.current,
          ),
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

  const cancelPendingImport = useCallback((track: PlayerTrack) => {
    if (!track.pending) {
      return;
    }
    cancelledPendingRef.current.add(track.id);
    if (!track.import_job_id) {
      return;
    }
    void cancelImportJob(track.import_job_id).catch(() => {
      // The worker may already have finished; nothing else to do.
    });
  }, []);

  const sendListen = useCallback(
    (track: PlayerTrack, progressSeconds: number, durationSeconds: number) => {
      if (track.pending || !track.recording_key) {
        return;
      }
      const duration = Math.max(
        durationSeconds,
        track.duration_seconds,
        0,
      );
      if (duration <= 0) {
        return;
      }
      const played = Math.max(
        0,
        Math.min(progressSeconds, duration),
      );
      void postRadioListen({
        track_id: track.id,
        played_seconds: Math.round(played),
        duration_seconds: Math.round(duration),
        skipped: played / duration < 0.9,
        source: track.origin === "auto" ? "radio" : "manual",
      }).catch(() => {
        // Listening history is best-effort; playback must not be blocked.
      });
    },
    [],
  );

  const forgiveRecommendation = useCallback(
    (track: PlayerTrack | Track) => {
      const pending = (track as PlayerTrack).pending;
      if (pending) {
        return;
      }
      const key =
        track.recording_key ||
        recommendationKey(track.artist_name, track.title);
      if (!key) {
        return;
      }
      sessionRejectedKeysRef.current.delete(key);
      const skipped = lastSkippedRef.current;
      if (skipped) {
        const skippedKey =
          skipped.recording_key ||
          recommendationKey(skipped.artist_name, skipped.title);
        if (skippedKey === key) {
          lastSkippedRef.current = null;
          setCanUndoSkip(false);
        }
      }
      void postRadioFeedback({
        recording_key: key,
        track_id: track.id,
        title: track.title,
        artist: track.artist_name,
        verdict: "clear",
      }).catch(() => {
        // The local session unblock still applies.
      });
    },
    [],
  );

  const flushCurrentListen = useCallback(() => {
    const snapshot = stateRef.current;
    const current = snapshot.queue[snapshot.currentIndex];
    if (!current || current.pending) {
      return;
    }
    captureCurrentProgress();
    const entry = recommendationHistoryRef.current.find(
      (item) => item.track.id === current.id,
    );
    sendListen(
      current,
      entry?.progressSeconds ?? snapshot.currentTime,
      entry?.durationSeconds ?? snapshot.duration,
    );
  }, [captureCurrentProgress, sendListen]);

  const removeFailedRecommendation = useCallback(
    (pendingId: string) => {
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
      const key =
        track.recording_key || recommendationKey(title, artist);
      const intentionallyCancelled =
        cancelledPendingRef.current.delete(pendingId);
      if (!intentionallyCancelled) {
        sessionFailedKeysRef.current.add(key);
        void postRadioFeedback({
          recording_key: key,
          title,
          artist,
          verdict: "reject",
          reason: "failed",
        }).catch(() => {
          // The local block still prevents the same failed track from returning.
        });
      }
      recommendationHistoryRef.current = removeRecommendationHistoryTrack(
        recommendationHistoryRef.current,
        pendingId,
      );
      dispatch({ type: "remove", index });
    },
    [],
  );

  const rejectTrack = useCallback(
    (track: PlayerTrack, reason: "skip" | "remove" = "skip") => {
      if (track.origin !== "auto") {
        return;
      }
      const title = track.title.trim();
      const artist = track.artist_name.trim();
      if (!title || !artist) {
        return;
      }
      const key =
        track.recording_key || recommendationKey(title, artist);
      sessionRejectedKeysRef.current.add(key);
      lastSkippedRef.current = track;
      setCanUndoSkip(true);
      void postRadioFeedback({
        recording_key: key,
        track_id: track.pending ? undefined : track.id,
        title,
        artist,
        verdict: "reject",
        reason,
      }).catch(() => {
        // Keep the local session rejection even if the server is unreachable.
      });
    },
    [],
  );

  const undoLastSkip = useCallback(() => {
    const track = lastSkippedRef.current;
    if (!track) {
      return;
    }
    lastSkippedRef.current = null;
    setCanUndoSkip(false);
    const key =
      track.recording_key ||
      recommendationKey(track.artist_name, track.title);
    sessionRejectedKeysRef.current.delete(key);
    cancelledPendingRef.current.delete(track.id);
    void postRadioFeedback({
      recording_key: key,
      track_id: track.pending ? undefined : track.id,
      title: track.title,
      artist: track.artist_name,
      verdict: "clear",
    }).catch(() => {
      // The local unblock still applies for this session.
    });
    const alreadyQueued = stateRef.current.queue.some(
      (item) =>
        (item.recording_key ||
          recommendationKey(item.artist_name, item.title)) === key,
    );
    if (!alreadyQueued) {
      dispatch({
        type: "appendAuto",
        tracks: [
          {
            ...track,
            origin: "auto",
            import_job_id: undefined,
            pending_status: null,
            pending_error: null,
          },
        ],
      });
    }
    setRadioExhausted(false);
  }, []);

  const dismissRecommendation = useCallback(
    (track: PlayerTrack, mode: "not_now" | "never") => {
      if (track.origin !== "auto") {
        return;
      }
      const key =
        track.recording_key ||
        recommendationKey(track.artist_name, track.title);
      sessionRejectedKeysRef.current.add(key);
      void postRadioFeedback({
        recording_key: key,
        track_id: track.pending ? undefined : track.id,
        title: track.title,
        artist: track.artist_name,
        verdict: "reject",
        reason: mode,
      }).catch(() => {
        // The local block still applies even if the server is unreachable.
      });
      const snapshot = stateRef.current;
      const index = snapshot.queue.findIndex((item) => item.id === track.id);
      if (index === -1) {
        return;
      }
      if (track.pending) {
        cancelPendingImport(track);
      }
      dispatch({ type: "remove", index });
    },
    [cancelPendingImport],
  );

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
    async (
      pendingId: string,
      title: string,
      artist: string,
      options?: {
        expectedDurationSeconds?: number | null;
        recordingKey?: string;
      },
    ) => {
      try {
        const job = await createImportJob(
          `${artist} ${title}`.trim(),
          undefined,
          {
            forceLlmApproval: true,
            sourceArtist: artist,
            sourceTitle: title,
            expectedDurationSeconds:
              options?.expectedDurationSeconds ?? undefined,
            recordingKey: options?.recordingKey,
          },
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
              if (current.status === "cancelled") {
                cancelledPendingRef.current.add(pendingId);
              }
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

  const ensureNextAutoImport = useCallback(() => {
    const snapshot = stateRef.current;
    const ahead = snapshot.queue
      .slice(snapshot.currentIndex + 1)
      .filter((track) => track.origin === "auto");
    const hasActiveImport = ahead.some(
      (track) =>
        track.pending &&
        (Boolean(track.import_job_id) ||
          Boolean(
            track.pending_status &&
              ACTIVE_IMPORT_STATUSES.includes(track.pending_status),
          )),
    );
    if (hasActiveImport) {
      return;
    }
    const next = ahead.find(
      (track) =>
        track.pending && !track.import_job_id && !track.pending_error,
    );
    if (!next || importStartingRef.current.has(next.id)) {
      return;
    }
    importStartingRef.current.add(next.id);
    void startPendingQueryImport(
      next.id,
      next.title,
      next.artist_name,
      {
        expectedDurationSeconds: next.expected_duration_seconds,
        recordingKey: next.recording_key,
      },
    ).finally(() => {
      importStartingRef.current.delete(next.id);
    });
  }, [startPendingQueryImport]);

  const fillRadioBuffer = useCallback(() => {
    const snapshot = stateRef.current;
    let autoAhead = snapshot.queue
      .slice(snapshot.currentIndex + 1)
      .filter((track) => track.origin === "auto").length;
    if (autoAhead >= RECOMMENDATION_BUFFER_SIZE) {
      ensureNextAutoImport();
      return;
    }

    const occupied = new Set<string>([
      ...snapshot.queue.map(
        (track) =>
          track.recording_key ||
          recommendationKey(track.artist_name, track.title),
      ),
      ...recommendationHistoryRef.current.map(
        (entry) =>
          entry.track.recording_key ||
          recommendationKey(entry.track.artist_name, entry.track.title),
      ),
      ...sessionRejectedKeysRef.current,
      ...sessionFailedKeysRef.current,
    ]);
    const existingIds = new Set(
      snapshot.queue.map((track) => track.id),
    );
    const appended: PlayerTrack[] = [];

    while (
      autoAhead < RECOMMENDATION_BUFFER_SIZE &&
      radioReserveRef.current.length > 0
    ) {
      const recommendation = radioReserveRef.current.shift();
      if (!recommendation) {
        break;
      }
      const key =
        recommendation.recording_key ||
        recommendationKey(recommendation.artist, recommendation.title);
      if (
        !key ||
        occupied.has(key) ||
        sessionRejectedKeysRef.current.has(key) ||
        sessionFailedKeysRef.current.has(key)
      ) {
        continue;
      }
      occupied.add(key);

      if (recommendation.local_track) {
        if (existingIds.has(recommendation.local_track.id)) {
          continue;
        }
        appended.push({
          ...recommendation.local_track,
          origin: "auto",
          recommendation_reason: recommendation.reason,
        });
      } else {
        appended.push({
          id: `auto-import-${Date.now()}-${radioPendingSequenceRef.current++}`,
          title: recommendation.title,
          artist_name: recommendation.artist,
          album_title: null,
          release_year: null,
          duration_seconds:
            recommendation.expected_duration_seconds ?? 0,
          mime_type: "audio/mpeg",
          source_type: "youtube",
          is_available: false,
          recording_key: key,
          created_at: new Date().toISOString(),
          pending: true,
          origin: "auto",
          pending_status: null,
          pending_error: null,
          expected_duration_seconds:
            recommendation.expected_duration_seconds,
          source_artist: recommendation.artist,
          source_title: recommendation.title,
          recommendation_reason: recommendation.reason,
        });
      }
      autoAhead += 1;
    }

    if (appended.length > 0) {
      dispatch({ type: "appendAuto", tracks: appended });
    } else if (radioReserveRef.current.length === 0) {
      setRadioFetchTick((value) => value + 1);
    }
    ensureNextAutoImport();
  }, [ensureNextAutoImport]);

  const fetchRadioBatch = useCallback(
    async (requestId: number) => {
      const snapshot = stateRef.current;
      const exclude = Array.from(
        new Set<string>([
          ...snapshot.queue.map(
            (track) =>
              track.recording_key ||
              recommendationKey(track.artist_name, track.title),
          ),
          ...recommendationHistoryRef.current.map(
            (entry) =>
              entry.track.recording_key ||
              recommendationKey(entry.track.artist_name, entry.track.title),
          ),
          ...sessionRejectedKeysRef.current,
          ...sessionFailedKeysRef.current,
        ]),
      )
        .filter(Boolean)
        .slice(0, MAX_RECOMMENDATION_EXCLUDE);

      const current = snapshot.queue[snapshot.currentIndex];
      const seedTrackId =
        current && !current.pending && current.origin !== "auto"
          ? current.id
          : undefined;

      try {
        const result = await getRadioBatch({
          limit: RECOMMENDATION_BATCH_SIZE,
          exclude,
          seedTrackId,
        });
        if (
          !aliveRef.current ||
          requestId !== radioRequestRef.current
        ) {
          return;
        }

        const queueSnapshot = stateRef.current;
        const existingIds = new Set(
          queueSnapshot.queue.map((track) => track.id),
        );
        const blocked = new Set(exclude);
        const reserve = result.recommendations.filter((recommendation) => {
          const key =
            recommendation.recording_key ||
            recommendationKey(
              recommendation.artist,
              recommendation.title,
            );
          if (!key || blocked.has(key)) {
            return false;
          }
          if (
            recommendation.local_track &&
            existingIds.has(recommendation.local_track.id)
          ) {
            return false;
          }
          return true;
        });
        if (
          reserve.length === 0 &&
          !result.exhausted &&
          result.recommendations.length > 0 &&
          radioEmptyRetriesRef.current < 2
        ) {
          radioEmptyRetriesRef.current += 1;
          setRadioExhausted(false);
          setRadioFetchTick((value) => value + 1);
          return;
        }
        radioEmptyRetriesRef.current = 0;
        radioReserveRef.current = reserve;
        setRadioExhausted(result.exhausted && reserve.length === 0);
        fillRadioBuffer();
      } catch {
        // Playback and the existing queue stay usable when Last.fm is down.
      }
    },
    [fillRadioBuffer],
  );

  const playTrack = useCallback(
    (track: Track, queue?: Track[]) => {
      flushCurrentListen();
      forgiveRecommendation(track);
      resetRecommendationSession(track);
      dispatch({ type: "play", track, queue });
      void updateRadioSession({ seed_track_id: track.id }).catch(() => {
        // The next batch can still use recent listening history.
      });
    },
    [flushCurrentListen, forgiveRecommendation, resetRecommendationSession],
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
        recording_key: recommendationKey(
          candidate.artist,
          candidate.title,
        ),
        created_at: new Date().toISOString(),
        pending: true,
        thumbnail_url: candidate.thumbnail_url,
      };
      flushCurrentListen();
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
    [flushCurrentListen, resetRecommendationSession],
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
          recording_key: recommendationKey(
            recommendation.artist,
            recommendation.title,
          ),
          source_artist: recommendation.artist,
          source_title: recommendation.title,
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
    const snapshot = stateRef.current;
    userPausedRef.current = snapshot.isPlaying;
    interruptedRef.current = false;
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
      const target = stateRef.current.queue[index];
      if (target) {
        forgiveRecommendation(target);
      }
      captureCurrentProgress();
      dispatch({ type: "playAt", index });
    },
    [captureCurrentProgress, forgiveRecommendation],
  );

  const removeAt = useCallback(
    (index: number) => {
      const snapshot = stateRef.current;
      const track = snapshot.queue[index];
      if (track?.pending && track.pending_status === "failed") {
        removeFailedRecommendation(track.id);
        return;
      }
      const isCurrent = index === snapshot.currentIndex;
      captureCurrentProgress();
      if (isCurrent) {
        if (
          track &&
          shouldRejectSkippedTrack(track, recommendationHistoryRef.current)
        ) {
          rejectTrack(track, "skip");
        }
      } else if (track?.pending) {
        cancelPendingImport(track);
      }
      dispatch({ type: "remove", index });
    },
    [
      cancelPendingImport,
      captureCurrentProgress,
      rejectTrack,
      removeFailedRecommendation,
    ],
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      const snapshot = stateRef.current;
      const index = snapshot.queue.findIndex((track) => track.id === trackId);
      if (index !== -1) {
        const track = snapshot.queue[index];
        if (track.pending && track.pending_status === "failed") {
          removeFailedRecommendation(trackId);
          return;
        }
        const isCurrent = index === snapshot.currentIndex;
        captureCurrentProgress();
        if (isCurrent) {
          if (
            shouldRejectSkippedTrack(
              track,
              recommendationHistoryRef.current,
            )
          ) {
            rejectTrack(track, "skip");
          }
        } else if (track.pending) {
          cancelPendingImport(track);
        }
        dispatch({ type: "remove", index });
      }
    },
    [
      cancelPendingImport,
      captureCurrentProgress,
      rejectTrack,
      removeFailedRecommendation,
    ],
  );

  const clearQueue = useCallback(() => {
    flushCurrentListen();
    const snapshot = stateRef.current;
    for (const track of snapshot.queue) {
      if (track.pending) {
        cancelPendingImport(track);
      }
    }
    resetRecommendationSession(null);
    dispatch({ type: "clear" });
  }, [
    cancelPendingImport,
    flushCurrentListen,
    resetRecommendationSession,
  ]);

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

  const setDiscoveryLevel = useCallback((level: DiscoveryLevel) => {
    setDiscoveryLevelState(level);
    setRadioExhausted(false);
    radioRequestRef.current += 1;
    radioEmptyRetriesRef.current = 0;
    radioReserveRef.current = [];
    void updateRadioSession({ discovery_level: level }).catch(() => {
      // The next successful request will persist the chosen level.
    });
  }, []);

  const requestPlay = useCallback((audio: HTMLAudioElement) => {
    const generation = sourceGenerationRef.current;
    let attempt: Promise<void> | undefined;
    try {
      attempt = audio.play();
    } catch {
      return;
    }
    if (!attempt) {
      return;
    }
    attempt
      .then(() => {
        if (sourceGenerationRef.current === generation) {
          switchingSourceRef.current = false;
        }
      })
      .catch((error: unknown) => {
        if (sourceGenerationRef.current !== generation) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        switchingSourceRef.current = false;
        interruptedRef.current = false;
        if (
          error instanceof DOMException &&
          error.name === "NotAllowedError"
        ) {
          dispatch({ type: "setPlaying", playing: false });
          dispatch({
            type: "error",
            error: "Playback was paused by the browser. Tap play to resume.",
          });
        }
      });
  }, []);

  const startSource = useCallback(
    (track: PlayerTrack) => {
      const audio = audioRef.current;
      if (!audio || track.pending) {
        return;
      }
      const source = `/api/tracks/${track.id}/stream`;
      const absoluteSource = new URL(source, window.location.href).href;
      if (audio.src === absoluteSource) {
        try {
          audio.currentTime = 0;
        } catch {
          // Metadata may not be loaded yet; the new source starts at zero.
        }
      } else {
        switchingSourceRef.current = true;
        sourceGenerationRef.current += 1;
        audio.src = source;
      }
      requestPlay(audio);
    },
    [requestPlay],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!currentSource) {
      switchingSourceRef.current = false;
      sourceGenerationRef.current += 1;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const absoluteSource = new URL(currentSource, window.location.href).href;
    if (audio.src !== absoluteSource) {
      switchingSourceRef.current = true;
      sourceGenerationRef.current += 1;
      audio.src = currentSource;
    }

    if (state.playToken !== lastPlayTokenRef.current) {
      lastPlayTokenRef.current = state.playToken;
      if (audio.src === absoluteSource) {
        try {
          audio.currentTime = 0;
        } catch {
          // Metadata may not be loaded yet; the new source starts at zero.
        }
      }
    }

    if (state.isPlaying) {
      requestPlay(audio);
    }
  }, [currentSource, currentTrackId, state.playToken, requestPlay]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || currentTrack.pending) {
      return;
    }
    if (state.isPlaying) {
      requestPlay(audio);
    } else {
      audio.pause();
    }
  }, [currentTrack, state.isPlaying, requestPlay]);

  useEffect(() => {
    const syncPlaybackWithAudio = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      const audio = audioRef.current;
      const snapshot = stateRef.current;
      const track = snapshot.queue[snapshot.currentIndex];
      if (!audio || !track || track.pending) {
        return;
      }
      if (
        !userPausedRef.current &&
        (snapshot.isPlaying || interruptedRef.current) &&
        audio.paused &&
        !audio.ended
      ) {
        requestPlay(audio);
      } else if (!snapshot.isPlaying && !audio.paused) {
        audio.pause();
      }
    };

    document.addEventListener("visibilitychange", syncPlaybackWithAudio);
    window.addEventListener("focus", syncPlaybackWithAudio);
    window.addEventListener("pageshow", syncPlaybackWithAudio);
    return () => {
      document.removeEventListener("visibilitychange", syncPlaybackWithAudio);
      window.removeEventListener("focus", syncPlaybackWithAudio);
      window.removeEventListener("pageshow", syncPlaybackWithAudio);
    };
  }, [requestPlay]);

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
      [
        "play",
        () => {
          const audio = audioRef.current;
          userPausedRef.current = false;
          interruptedRef.current = false;
          if (audio && audio.src) {
            requestPlay(audio);
          }
          dispatch({ type: "setPlaying", playing: true });
        },
      ],
      [
        "pause",
        () => {
          userPausedRef.current = true;
          interruptedRef.current = false;
          audioRef.current?.pause();
          dispatch({ type: "setPlaying", playing: false });
        },
      ],
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
  }, [currentTrack, next, previous, requestPlay, seek]);

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
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    void addNativeMediaSessionListener(({ action }) => {
      if (action === "play") {
        const audio = audioRef.current;
        userPausedRef.current = false;
        interruptedRef.current = false;
        if (audio && audio.src) {
          requestPlay(audio);
        }
        dispatch({ type: "setPlaying", playing: true });
      } else if (action === "pause") {
        userPausedRef.current = true;
        interruptedRef.current = false;
        audioRef.current?.pause();
        dispatch({ type: "setPlaying", playing: false });
      } else if (action === "next") {
        next();
      } else if (action === "previous") {
        previous();
      } else if (action.startsWith("seek:")) {
        const milliseconds = Number(action.slice("seek:".length));
        if (Number.isFinite(milliseconds)) {
          seek(milliseconds / 1000);
        }
      }
    }).then((result) => {
      if (cancelled) {
        void result?.remove();
        return;
      }
      handle = result;
    });

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [next, previous, requestPlay, seek]);

  useEffect(() => {
    if (!currentTrack || currentTrack.pending) {
      clearNativeMediaSession();
      return;
    }
    const duration =
      state.duration > 0 ? state.duration : currentTrack.duration_seconds;
    updateNativeMediaSession({
      title: currentTrack.title,
      artist: currentTrack.artist_name,
      album: currentTrack.album_title ?? "Soundroom",
      duration: Number.isFinite(duration) ? duration : 0,
      isPlaying: state.isPlaying,
      position: Math.max(state.currentTime, 0),
    });
  }, [currentTrack, state.duration, state.isPlaying]);

  useEffect(() => {
    if (
      !currentTrack ||
      currentTrack.pending ||
      !state.isPlaying ||
      state.currentTime <= 0
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastNativePositionUpdateRef.current < 5000) {
      return;
    }
    lastNativePositionUpdateRef.current = now;
    const duration =
      state.duration > 0 ? state.duration : currentTrack.duration_seconds;
    updateNativeMediaSession({
      title: currentTrack.title,
      artist: currentTrack.artist_name,
      album: currentTrack.album_title ?? "Soundroom",
      duration: Number.isFinite(duration) ? duration : 0,
      isPlaying: state.isPlaying,
      position: Math.max(state.currentTime, 0),
    });
  }, [
    currentTrack,
    state.currentTime,
    state.duration,
    state.isPlaying,
  ]);

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
      } else if (previousEntry && !previousEntry.track.pending) {
        sendListen(
          previousEntry.track,
          previousEntry.progressSeconds,
          previousEntry.durationSeconds,
        );
      }
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
  }, [currentTrack, sendListen]);

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
    ensureNextAutoImport();
  }, [currentTrack, ensureNextAutoImport, state.currentIndex, state.queue]);

  useEffect(() => {
    if (
      radioInFlightRef.current ||
      radioExhausted ||
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
    if (
      radioReserveRef.current.length + autoAhead >
      RECOMMENDATION_BUFFER_SIZE
    ) {
      fillRadioBuffer();
      return;
    }

    const requestId = radioRequestRef.current;
    radioInFlightRef.current = true;
    void fetchRadioBatch(requestId).finally(() => {
      if (requestId === radioRequestRef.current) {
        radioInFlightRef.current = false;
      }
    });
  }, [
    currentTrack,
    discoveryLevel,
    fetchRadioBatch,
    fillRadioBuffer,
    radioExhausted,
    radioFetchTick,
    state.currentIndex,
    state.queue,
  ]);

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
      radioExhausted,
      discoveryLevel,
      setDiscoveryLevel,
      canUndoSkip,
      undoLastSkip,
      dismissRecommendation,
    }),
    [
      canUndoSkip,
      clearQueue,
      currentTrack,
      discoveryLevel,
      dismissError,
      dismissRecommendation,
      undoLastSkip,
      dismissQueuedImport,
      enqueue,
      next,
      playAt,
      playTrack,
      previous,
      queueExternalRecommendation,
      queueImport,
      queuedImports,
      radioExhausted,
      removeAt,
      removeTrack,
      seek,
      setDiscoveryLevel,
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
        preload="auto"
        playsInline
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
        onPlay={() => {
          switchingSourceRef.current = false;
          userPausedRef.current = false;
          interruptedRef.current = false;
          dispatch({ type: "setPlaying", playing: true });
          dispatch({ type: "error", error: null });
        }}
        onPlaying={() => {
          switchingSourceRef.current = false;
        }}
        onPause={() => {
          const audio = audioRef.current;
          if (!audio || switchingSourceRef.current || audio.ended) {
            return;
          }
          if (
            audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            audio.currentTime <= 0.05
          ) {
            return;
          }
          if (
            Number.isFinite(audio.duration) &&
            audio.currentTime >= audio.duration - 0.5
          ) {
            return;
          }
          const wasPlaying = stateRef.current.isPlaying;
          dispatch({ type: "setPlaying", playing: false });
          if (wasPlaying && !userPausedRef.current) {
            interruptedRef.current = true;
          }
        }}
        onCanPlay={() => {
          const audio = audioRef.current;
          if (
            audio &&
            !userPausedRef.current &&
            (stateRef.current.isPlaying || interruptedRef.current) &&
            audio.paused &&
            !audio.ended
          ) {
            requestPlay(audio);
          }
        }}
        onEnded={(event) => {
          const snapshot = stateRef.current;
          const endedTrack = snapshot.queue[snapshot.currentIndex];
          if (endedTrack) {
            captureProgress(
              endedTrack.id,
              event.currentTarget.duration,
              event.currentTarget.duration,
            );
          }
          interruptedRef.current = false;
          const nextTrack = snapshot.queue[snapshot.currentIndex + 1];
          if (nextTrack && !nextTrack.pending) {
            startSource(nextTrack);
          }
          dispatch({ type: "ended" });
        }}
        onError={() => {
          switchingSourceRef.current = false;
          interruptedRef.current = false;
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
