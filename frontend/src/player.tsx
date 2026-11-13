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
  advanceQueue as advanceServerQueue,
  clearQueue as clearServerQueue,
  enqueueQueueTracks,
  getQueue,
  getRadioSession,
  importQueueTrack,
  playQueue,
  playQueueItem,
  postRadioFeedback,
  postRadioListen,
  refillQueue,
  removeQueueItem,
  updateQueueState,
  updateRadioSession,
} from "./api";
import { useAuth } from "./auth";
import {
  addNativePlaybackListener,
  getNativeState,
  isNativePlaybackAvailable,
  nextNative,
  pauseNative,
  playNative,
  previousNative,
  seekNative,
  updateNativeQueue,
  type NativeItemChanged,
  type NativePlaybackEvent,
  type NativePlaybackState,
  type NativeQueueItem,
} from "./nativePlayback";
import {
  initialPlayerState,
  playerReducer,
  type PlayerState,
  type PlayerTrack,
} from "./playerState";
import {
  addRecommendationHistoryEntry,
  createRecommendationHistoryEntry,
  recommendationKey,
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
  QueueItem,
  QueueState,
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

function queueItemToPlayerTrack(item: QueueItem): PlayerTrack {
  const origin = item.source === "radio" ? "auto" : "manual";
  if (item.track) {
    return {
      ...item.track,
      queue_item_id: item.id,
      origin,
      recommendation_reason: item.reason,
      expected_duration_seconds: item.expected_duration_seconds,
      pending: false,
      pending_status: item.import_status,
      import_job_id: item.import_job_id ?? undefined,
    };
  }
  return {
    id: `queue-pending-${item.id}`,
    queue_item_id: item.id,
    title: item.title,
    artist_name: item.artist,
    album_title: null,
    release_year: null,
    duration_seconds: item.expected_duration_seconds ?? 0,
    mime_type: "audio/mpeg",
    source_type: "youtube",
    is_available: false,
    recording_key: item.recording_key,
    created_at: new Date().toISOString(),
    pending: true,
    origin,
    pending_status: item.import_status,
    pending_error: item.error_message,
    expected_duration_seconds: item.expected_duration_seconds,
    source_artist: item.artist,
    source_title: item.title,
    recommendation_reason: item.reason,
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const switchingSourceRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const userPausedRef = useRef(false);
  const interruptedRef = useRef(false);
  const lastPlayTokenRef = useRef(state.playToken);
  const [radioExhausted, setRadioExhausted] = useState(false);
  const [canUndoSkip, setCanUndoSkip] = useState(false);
  const lastSkippedRef = useRef<PlayerTrack | null>(null);
  const [discoveryLevel, setDiscoveryLevelState] =
    useState<DiscoveryLevel>("balanced");
  const recommendationHistoryRef = useRef<RecommendationHistoryEntry[]>([]);
  const recommendationOrderRef = useRef(0);
  const lastActiveTrackIdRef = useRef<string | null>(null);
  const sessionRejectedKeysRef = useRef<Set<string>>(new Set());
  const refillInFlightRef = useRef(false);
  const refillCooldownRef = useRef(0);
  const lastQueueStatePushRef = useRef(0);
  const queueMutationRef = useRef(0);
  const queueMutationSeqRef = useRef(0);
  const lastAppliedRevisionRef = useRef(-1);
  const lastHydratedCurrentRef = useRef<string | null>(null);
  const resumePositionRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const queryClient = useQueryClient();
  const { data: authData } = useAuth();
  const signedIn = Boolean(authData?.user);
  const wasSignedInRef = useRef(false);
  const nativePlayback = isNativePlaybackAvailable();
  const nativeQueueSignatureRef = useRef("");
  const nativeEndedHandledRef = useRef(false);
  const nativeInitializedRef = useRef(false);
  const [nativeReady, setNativeReady] = useState(false);

  const queueQuery = useQuery({
    queryKey: ["queue"],
    queryFn: getQueue,
    enabled: signedIn,
    refetchInterval: signedIn ? 2000 : false,
  });

  useEffect(() => {
    if (signedIn) {
      wasSignedInRef.current = true;
      return;
    }
    if (!wasSignedInRef.current) {
      return;
    }
    wasSignedInRef.current = false;
    queryClient.removeQueries({ queryKey: ["queue"] });
    dispatch({ type: "clear" });
  }, [queryClient, signedIn]);

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

  const syncQueueState = useCallback(
    (queueState: QueueState, applyPlayback = false) => {
      lastAppliedRevisionRef.current = Math.max(
        lastAppliedRevisionRef.current,
        queueState.revision,
      );
      if (queueState.current_item_id !== lastHydratedCurrentRef.current) {
        lastHydratedCurrentRef.current = queueState.current_item_id;
        resumePositionRef.current = Math.max(
          0,
          queueState.position_seconds,
        );
      }
      queryClient.setQueryData(["queue"], queueState);
      dispatch({
        type: "hydrate",
        tracks: queueState.items.map(queueItemToPlayerTrack),
        currentQueueItemId: queueState.current_item_id,
        isPlaying: queueState.is_playing,
        applyPlayback,
      });
      setRadioExhausted(queueState.radio_exhausted);
    },
    [queryClient],
  );

  const beginQueueMutation = useCallback(() => {
    queueMutationRef.current += 1;
    queueMutationSeqRef.current += 1;
    return queueMutationSeqRef.current;
  }, []);

  const endQueueMutation = useCallback(() => {
    queueMutationRef.current = Math.max(0, queueMutationRef.current - 1);
    if (queueMutationRef.current === 0) {
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    }
  }, [queryClient]);

  const runQueueMutation = useCallback(
    async (
      mutation: () => Promise<QueueState>,
      applyPlayback = false,
    ) => {
      const sequence = beginQueueMutation();
      try {
        const nextState = await mutation();
        if (sequence === queueMutationSeqRef.current) {
          syncQueueState(nextState, applyPlayback);
        }
        return nextState;
      } finally {
        endQueueMutation();
      }
    },
    [beginQueueMutation, endQueueMutation, syncQueueState],
  );

  useEffect(() => {
    if (queueMutationRef.current > 0) {
      return;
    }
    if (
      queueQuery.data &&
      queueQuery.data.revision >= lastAppliedRevisionRef.current
    ) {
      syncQueueState(queueQuery.data);
      queryClient.invalidateQueries({
        queryKey: ["tracks"],
        refetchType: "none",
      });
    }
  }, [queryClient, queueQuery.data, syncQueueState]);

  useEffect(() => {
    const queueState = queueQuery.data;
    if (!queueState || refillInFlightRef.current) {
      return;
    }
    const hasFailed = queueState.items.some(
      (item) => item.status === "failed",
    );
    if (!queueState.needs_refill && !hasFailed) {
      return;
    }
    if (queueState.radio_exhausted && !hasFailed) {
      return;
    }
    if (Date.now() < refillCooldownRef.current) {
      return;
    }
    refillInFlightRef.current = true;
    void runQueueMutation(() => refillQueue())
      .catch(() => {
        refillCooldownRef.current = Date.now() + 30_000;
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["queue"] });
        }, 30_000);
      })
      .finally(() => {
        refillInFlightRef.current = false;
      });
  }, [
    queryClient,
    queueQuery.data?.items,
    queueQuery.data?.needs_refill,
    queueQuery.data?.radio_exhausted,
    queueQuery.data?.revision,
    runQueueMutation,
  ]);

  useEffect(() => {
    const track = state.queue[state.currentIndex];
    if (!signedIn || !track || track.pending || !track.queue_item_id) {
      return;
    }
    const now = Date.now();
    if (now - lastQueueStatePushRef.current < 5000) {
      return;
    }
    lastQueueStatePushRef.current = now;
    void updateQueueState({
      current_item_id: track.queue_item_id,
      is_playing: state.isPlaying,
      position_seconds: Math.round(state.currentTime),
    }).catch(() => {
      // Playback state sync is best-effort.
    });
  }, [
    signedIn,
    state.currentIndex,
    state.currentTime,
    state.isPlaying,
    state.queue,
  ]);

  useEffect(() => {
    const track = state.queue[state.currentIndex];
    if (!signedIn || !track || track.pending || !track.queue_item_id) {
      return;
    }
    void updateQueueState({
      current_item_id: track.queue_item_id,
      is_playing: state.isPlaying,
      position_seconds: Math.round(state.currentTime),
    }).catch(() => {
      // Playback state sync is best-effort.
    });
  }, [signedIn, state.isPlaying]);

  useEffect(() => {
    if (
      !nativePlayback ||
      nativeInitializedRef.current ||
      state.queue.length === 0
    ) {
      return;
    }
    nativeInitializedRef.current = true;
    void getNativeState()
      .then((nativeState) => {
        if (!nativeState?.queueItemId) {
          return;
        }
        const snapshot = stateRef.current;
        const index = snapshot.queue.findIndex(
          (track) => track.queue_item_id === nativeState.queueItemId,
        );
        if (index === -1) {
          return;
        }
        if (index !== snapshot.currentIndex) {
          dispatch({ type: "playAt", index });
        }
        void updateQueueState({
          current_item_id: nativeState.queueItemId,
          is_playing: nativeState.isPlaying,
          position_seconds: Math.round(nativeState.position),
        }).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        setNativeReady(true);
      });
  }, [nativePlayback, state.queue.length]);

  useEffect(() => {
    if (!nativePlayback || !nativeReady) {
      return;
    }
    const snapshot = stateRef.current;
    const current = snapshot.queue[snapshot.currentIndex];
    if (!current || current.pending || !current.queue_item_id) {
      if (nativeQueueSignatureRef.current !== "") {
        nativeQueueSignatureRef.current = "";
        void pauseNative().catch(() => undefined);
      }
      return;
    }
    const readyItems = snapshot.queue.filter(
      (track) =>
        !track.pending &&
        track.is_available &&
        Boolean(track.queue_item_id),
    );
    const signature = `${readyItems
      .map((track) => track.queue_item_id)
      .join("|")}#${current.queue_item_id}`;
    if (signature === nativeQueueSignatureRef.current) {
      return;
    }
    nativeQueueSignatureRef.current = signature;
    const items: NativeQueueItem[] = readyItems.map((track) => ({
      mediaId: track.queue_item_id as string,
      queueItemId: track.queue_item_id as string,
      trackId: track.id,
      streamUrl: new URL(
        `/api/tracks/${track.id}/stream`,
        window.location.origin,
      ).href,
      title: track.title,
      artist: track.artist_name,
      album: track.album_title ?? "",
      durationMs: Math.round(track.duration_seconds * 1000),
    }));
    const currentIndex = items.findIndex(
      (item) => item.mediaId === current.queue_item_id,
    );
    if (currentIndex === -1) {
      return;
    }
    void updateNativeQueue(
      items,
      current.queue_item_id as string,
      snapshot.currentTime,
      snapshot.isPlaying,
    ).catch(() => {
      nativeQueueSignatureRef.current = "";
    });
  }, [
    nativePlayback,
    nativeReady,
    state.currentIndex,
    state.currentTime,
    state.isPlaying,
    state.queue,
  ]);

  const resetRecommendationSession = useCallback(
    (track: PlayerTrack | null) => {
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
      beginQueueMutation();
      void postRadioFeedback({
        recording_key: key,
        track_id: track.pending ? undefined : track.id,
        title,
        artist,
        verdict: "reject",
        reason,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["queue"] }))
        .catch(() => {
          // Keep the local session rejection even if the server is unreachable.
        })
        .finally(endQueueMutation);
    },
    [beginQueueMutation, endQueueMutation, queryClient],
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
    void postRadioFeedback({
      recording_key: key,
      track_id: track.pending ? undefined : track.id,
      title: track.title,
      artist: track.artist_name,
      verdict: "clear",
    })
      .then(() => {
        if (!track.pending) {
          void runQueueMutation(() =>
            enqueueQueueTracks([track.id]),
          );
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ["queue"] });
      })
      .catch(() => {
        // The local unblock still applies for this session.
      });
    setRadioExhausted(false);
  }, [queryClient, runQueueMutation]);

  const dismissRecommendation = useCallback(
    (track: PlayerTrack, mode: "not_now" | "never") => {
      if (track.origin !== "auto") {
        return;
      }
      const key =
        track.recording_key ||
        recommendationKey(track.artist_name, track.title);
      sessionRejectedKeysRef.current.add(key);
      beginQueueMutation();
      void postRadioFeedback({
        recording_key: key,
        track_id: track.pending ? undefined : track.id,
        title: track.title,
        artist: track.artist_name,
        verdict: "reject",
        reason: mode,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ["queue"] }))
        .catch(() => {
          // The local block still applies even if the server is unreachable.
        })
        .finally(endQueueMutation);
      const snapshot = stateRef.current;
      const index = snapshot.queue.findIndex(
        (item) => item.queue_item_id === track.queue_item_id,
      );
      if (index !== -1) {
        dispatch({ type: "remove", index });
      }
    },
    [beginQueueMutation, endQueueMutation, queryClient],
  );

  const currentTrack = state.queue[state.currentIndex] ?? null;
  const currentTrackId = currentTrack?.id ?? null;
  const currentSource =
    currentTrack && !currentTrack.pending
      ? `/api/tracks/${currentTrack.id}/stream`
      : null;
  const playTrack = useCallback(
    (track: Track, queueTracks?: Track[]) => {
      flushCurrentListen();
      forgiveRecommendation(track);
      const tracks =
        queueTracks && queueTracks.length > 0
          ? queueTracks
          : [track];
      resetRecommendationSession(track);
      dispatch({ type: "play", track, queue: tracks });
      void runQueueMutation(
        () =>
          playQueue({
            track_ids: tracks.map((item) => item.id),
            start_track_id: track.id,
          }),
        true,
      ).catch(() => {
        // Keep the optimistic local queue if the server is unreachable.
      });
    },
    [
      flushCurrentListen,
      forgiveRecommendation,
      resetRecommendationSession,
      runQueueMutation,
    ],
  );

  const startImport = useCallback(
    async (query: string, candidate: ImportPreviewCandidate) => {
      const duration = candidate.duration_seconds;
      if (duration === null) {
        return;
      }
      try {
        await runQueueMutation(
          () =>
            importQueueTrack({
              query,
              candidate: {
                video_id: candidate.video_id,
                title: candidate.title,
                artist: candidate.artist,
                duration_seconds: duration,
              },
              play_now: true,
              source_artist: candidate.artist,
              source_title: candidate.title,
              expected_duration_seconds: duration,
            }),
          true,
        );
      } catch {
        // The import request failed; leave the queue unchanged.
      }
    },
    [runQueueMutation],
  );

  const queueImport = useCallback(
    async (query: string, candidate: ImportPreviewCandidate) => {
      const duration = candidate.duration_seconds;
      if (duration === null) {
        return false;
      }
      try {
        await runQueueMutation(() =>
          importQueueTrack({
            query,
            candidate: {
              video_id: candidate.video_id,
              title: candidate.title,
              artist: candidate.artist,
              duration_seconds: duration,
            },
            play_now: false,
            source_artist: candidate.artist,
            source_title: candidate.title,
            expected_duration_seconds: duration,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [runQueueMutation],
  );

  const queuedImports = useMemo<QueuedImport[]>(
    () =>
      (queueQuery.data?.items ?? [])
        .filter((item) => item.video_id && item.status !== "ready")
        .map((item) => ({
          id: item.id,
          videoId: item.video_id as string,
          jobId: item.import_job_id,
          title: item.title,
          artist: item.artist,
          thumbnailUrl: null,
          status: item.import_status,
          error: item.error_message,
        })),
    [queueQuery.data],
  );

  const dismissQueuedImport = useCallback(
    (id: string) => {
      const item = queueQuery.data?.items.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      void runQueueMutation(() => removeQueueItem(item.id)).catch(() => {
        // The queue poll will reconcile.
      });
    },
    [queueQuery.data, runQueueMutation],
  );

  const enqueue = useCallback(
    (track: Track) => {
      if (stateRef.current.queue.some((item) => item.id === track.id)) {
        return false;
      }
      dispatch({ type: "enqueue", track });
      void runQueueMutation(() =>
        enqueueQueueTracks([track.id]),
      ).catch(() => {
        // Keep the optimistic queue if the server is unreachable.
      });
      return true;
    },
    [runQueueMutation],
  );

  const queueExternalRecommendation = useCallback(
    async (recommendation: DiscoverRecommendation) => {
      try {
        await runQueueMutation(() =>
          importQueueTrack({
            query: `${recommendation.artist} ${recommendation.title}`.trim(),
            play_now: false,
            source_artist: recommendation.artist,
            source_title: recommendation.title,
          }),
        );
      } catch {
        // The recommendation stays in Discover if the import fails.
      }
    },
    [runQueueMutation],
  );

  const toggle = useCallback(() => {
    const snapshot = stateRef.current;
    if (nativePlayback) {
      const playing = !snapshot.isPlaying;
      userPausedRef.current = !playing;
      interruptedRef.current = false;
      dispatch({ type: "setPlaying", playing });
      void (playing ? playNative() : pauseNative()).catch(() => undefined);
      return;
    }
    userPausedRef.current = snapshot.isPlaying;
    interruptedRef.current = false;
    dispatch({ type: "toggle" });
  }, [nativePlayback]);

  const next = useCallback(() => {
    const snapshot = stateRef.current;
    const current = snapshot.queue[snapshot.currentIndex];
    if (!current) {
      return;
    }
    if (nativePlayback) {
      captureCurrentProgress();
      void nextNative().catch(() => undefined);
      return;
    }
    captureCurrentProgress();
    const shouldReject =
      current.origin === "auto" &&
      shouldRejectSkippedTrack(current, recommendationHistoryRef.current);
    dispatch({ type: "next" });
    if (shouldReject) {
      rejectTrack(current, "skip");
      return;
    }
    void runQueueMutation(() => advanceServerQueue("next"), true).catch(
      () => {
        // The queue poll will reconcile.
      },
    );
  }, [
    captureCurrentProgress,
    nativePlayback,
    rejectTrack,
    runQueueMutation,
  ]);

  const seek = useCallback(
    (time: number) => {
      if (nativePlayback) {
        dispatch({ type: "seek", time });
        void seekNative(Math.max(0, time)).catch(() => undefined);
        return;
      }
      const audio = audioRef.current;
      if (audio && Number.isFinite(time)) {
        audio.currentTime = Math.max(0, time);
      }
      dispatch({ type: "seek", time });
    },
    [nativePlayback],
  );

  const previous = useCallback(() => {
    if (nativePlayback) {
      if (state.currentTime > 3) {
        seek(0);
      } else {
        captureCurrentProgress();
        void previousNative().catch(() => undefined);
      }
      return;
    }
    if (state.currentTime > 3) {
      seek(0);
      return;
    }
    captureCurrentProgress();
    dispatch({ type: "previous" });
    void runQueueMutation(
      () => advanceServerQueue("previous"),
      true,
    ).catch(() => {
      // The queue poll will reconcile.
    });
  }, [
    captureCurrentProgress,
    nativePlayback,
    runQueueMutation,
    seek,
    state.currentTime,
  ]);

  const playAt = useCallback(
    (index: number) => {
      const target = stateRef.current.queue[index];
      if (target) {
        forgiveRecommendation(target);
      }
      captureCurrentProgress();
      dispatch({ type: "playAt", index });
      if (target?.queue_item_id) {
        void runQueueMutation(
          () => playQueueItem(target.queue_item_id as string),
          true,
        ).catch(() => {
          // The queue poll will reconcile.
        });
      }
    },
    [captureCurrentProgress, forgiveRecommendation, runQueueMutation],
  );

  const removeAt = useCallback(
    (index: number) => {
      const snapshot = stateRef.current;
      const track = snapshot.queue[index];
      const isCurrent = index === snapshot.currentIndex;
      captureCurrentProgress();
      const shouldReject =
        isCurrent &&
        track !== undefined &&
        track.origin === "auto" &&
        shouldRejectSkippedTrack(
          track,
          recommendationHistoryRef.current,
        );
      dispatch({ type: "remove", index });
      if (shouldReject && track) {
        rejectTrack(track, "skip");
        return;
      }
      if (track?.queue_item_id) {
        void runQueueMutation(
          () => removeQueueItem(track.queue_item_id as string),
          true,
        ).catch(() => {
          // The queue poll will reconcile.
        });
      }
    },
    [captureCurrentProgress, rejectTrack, runQueueMutation],
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      const snapshot = stateRef.current;
      const index = snapshot.queue.findIndex(
        (track) =>
          track.id === trackId || track.queue_item_id === trackId,
      );
      if (index !== -1) {
        const track = snapshot.queue[index];
        const isCurrent = index === snapshot.currentIndex;
        captureCurrentProgress();
        const shouldReject =
          isCurrent &&
          track.origin === "auto" &&
          shouldRejectSkippedTrack(
            track,
            recommendationHistoryRef.current,
          );
        dispatch({ type: "remove", index });
        if (shouldReject) {
          rejectTrack(track, "skip");
          return;
        }
        if (track.queue_item_id) {
          void runQueueMutation(
            () => removeQueueItem(track.queue_item_id as string),
            true,
          ).catch(() => {
            // The queue poll will reconcile.
          });
        }
      }
    },
    [captureCurrentProgress, rejectTrack, runQueueMutation],
  );

  const clearQueue = useCallback(() => {
    flushCurrentListen();
    resetRecommendationSession(null);
    dispatch({ type: "clear" });
    void runQueueMutation(() => clearServerQueue(), true).catch(() => {
      // The queue poll will reconcile.
    });
  }, [flushCurrentListen, resetRecommendationSession, runQueueMutation]);

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

  const setDiscoveryLevel = useCallback(
    (level: DiscoveryLevel) => {
      setDiscoveryLevelState(level);
      setRadioExhausted(false);
      void updateRadioSession({ discovery_level: level })
        .then(() =>
          queryClient.invalidateQueries({ queryKey: ["queue"] }),
        )
        .catch(() => {
          // The next successful request will persist the chosen level.
        });
    },
    [queryClient],
  );

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
      if (nativePlayback) {
        return;
      }
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
    [nativePlayback, requestPlay],
  );

  useEffect(() => {
    if (nativePlayback) {
      return;
    }
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
  }, [
    currentSource,
    currentTrackId,
    nativePlayback,
    requestPlay,
    state.playToken,
  ]);

  useEffect(() => {
    if (nativePlayback) {
      return;
    }
    const audio = audioRef.current;
    if (!audio || !currentTrack || currentTrack.pending) {
      return;
    }
    if (state.isPlaying) {
      requestPlay(audio);
    } else {
      audio.pause();
    }
  }, [currentTrack, nativePlayback, state.isPlaying, requestPlay]);

  useEffect(() => {
    if (nativePlayback) {
      return;
    }
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
  }, [nativePlayback, requestPlay]);

  useEffect(() => {
    if (nativePlayback) {
      return;
    }
    const interval = window.setInterval(() => {
      const audio = audioRef.current;
      const snapshot = stateRef.current;
      if (
        !audio ||
        !audio.src ||
        audio.ended ||
        switchingSourceRef.current ||
        userPausedRef.current
      ) {
        return;
      }
      if (
        audio.paused &&
        (snapshot.isPlaying || interruptedRef.current)
      ) {
        requestPlay(audio);
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [nativePlayback, requestPlay]);

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
      nativePlayback ||
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
  }, [currentTrack, nativePlayback, next, previous, requestPlay, seek]);

  useEffect(() => {
    if (nativePlayback) {
      return;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = state.isPlaying
        ? "playing"
        : "paused";
    }
  }, [nativePlayback, state.isPlaying]);

  useEffect(() => {
    if (
      nativePlayback ||
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
  }, [
    currentTrack,
    nativePlayback,
    state.currentTime,
    state.duration,
  ]);

  const handleNativeState = useCallback(
    (nativeState: NativePlaybackState) => {
      dispatch({ type: "duration", duration: nativeState.duration });
      dispatch({
        type: "time",
        time: nativeState.position,
        duration: nativeState.duration,
      });
      if (nativeState.isPlaying !== stateRef.current.isPlaying) {
        dispatch({ type: "setPlaying", playing: nativeState.isPlaying });
      }
      if (nativeState.ended) {
        if (!nativeEndedHandledRef.current) {
          nativeEndedHandledRef.current = true;
          void runQueueMutation(
            () => advanceServerQueue("next"),
            true,
          ).catch(() => undefined);
        }
      } else {
        nativeEndedHandledRef.current = false;
      }
    },
    [runQueueMutation],
  );

  const handleNativeItemChanged = useCallback(
    (change: NativeItemChanged) => {
      const snapshot = stateRef.current;
      const index = snapshot.queue.findIndex(
        (track) => track.queue_item_id === change.queueItemId,
      );
      if (index === -1) {
        return;
      }
      const previous =
        snapshot.queue.find(
          (track) => track.queue_item_id === change.previousQueueItemId,
        ) ?? snapshot.queue[snapshot.currentIndex];
      const shouldReject =
        previous !== undefined &&
        previous.origin === "auto" &&
        change.previousDuration > 0 &&
        change.previousPosition / change.previousDuration < 0.5;
      if (index !== snapshot.currentIndex) {
        dispatch({ type: "playAt", index });
      }
      const sync = updateQueueState({
        current_item_id: change.queueItemId,
        is_playing: true,
        position_seconds: 0,
      }).catch(() => undefined);
      if (shouldReject && previous) {
        void sync.then(() => {
          rejectTrack(previous, "skip");
        });
      }
    },
    [rejectTrack],
  );

  useEffect(() => {
    if (!nativePlayback) {
      return;
    }
    let disposed = false;
    let handle: { remove: () => Promise<void> } | null = null;
    void addNativePlaybackListener((event: NativePlaybackEvent) => {
      if (disposed) {
        return;
      }
      if (event.type === "state") {
        handleNativeState(event.state);
      } else if (event.type === "itemChanged") {
        handleNativeItemChanged(event.change);
      } else if (event.type === "error") {
        dispatch({ type: "error", error: event.message });
      }
    }).then((result) => {
      if (disposed) {
        void result?.remove();
        return;
      }
      handle = result;
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, [handleNativeItemChanged, handleNativeState, nativePlayback]);

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
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          dispatch({
            type: "duration",
            duration: audio.duration,
          });
          if (resumePositionRef.current > 0) {
            const target = Math.min(
              resumePositionRef.current,
              Math.max(0, audio.duration - 0.5),
            );
            try {
              audio.currentTime = target;
            } catch {
              // Metadata is not ready; start from the beginning.
            }
            resumePositionRef.current = 0;
            dispatch({ type: "seek", time: target });
          }
        }}
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
          void runQueueMutation(
            () => advanceServerQueue("next"),
            true,
          ).catch(() => {
            // The queue poll will reconcile.
          });
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
