import type { ImportJobStatus, Track } from "./types";

export interface PlayerTrack extends Track {
  pending?: boolean;
  import_job_id?: string;
  thumbnail_url?: string | null;
}

export interface PlayerState {
  queue: PlayerTrack[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  expanded: boolean;
  error: string | null;
  importStatus: ImportJobStatus | null;
  importError: string | null;
  playToken: number;
}

export type PlayerAction =
  | { type: "play"; track: PlayerTrack; queue?: PlayerTrack[] }
  | { type: "playAt"; index: number }
  | { type: "enqueue"; track: PlayerTrack }
  | { type: "beginImport"; track: PlayerTrack }
  | { type: "importJob"; jobId: string; status: ImportJobStatus }
  | { type: "importStatus"; status: ImportJobStatus }
  | { type: "importFailed"; error: string }
  | { type: "importCompleted"; track: Track }
  | { type: "toggle" }
  | { type: "setPlaying"; playing: boolean }
  | { type: "next" }
  | { type: "previous" }
  | { type: "ended" }
  | { type: "seek"; time: number }
  | { type: "time"; time: number; duration: number }
  | { type: "duration"; duration: number }
  | { type: "remove"; index: number }
  | { type: "clear" }
  | { type: "expanded"; expanded: boolean }
  | { type: "volume"; volume: number }
  | { type: "muted"; muted: boolean }
  | { type: "error"; error: string | null };

export const initialPlayerState: PlayerState = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  expanded: false,
  error: null,
  importStatus: null,
  importError: null,
  playToken: 0,
};

function uniqueTracks(tracks: PlayerTrack[]): PlayerTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) {
      return false;
    }
    seen.add(track.id);
    return true;
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(Math.max(value, minimum), maximum);
}

function durationFor(track: PlayerTrack, duration: number): number {
  return Number.isFinite(duration) && duration > 0
    ? duration
    : Math.max(track.duration_seconds, 0);
}

function currentTrackOf(state: PlayerState): PlayerTrack | null {
  return state.queue[state.currentIndex] ?? null;
}

function isPending(state: PlayerState): boolean {
  return Boolean(currentTrackOf(state)?.pending);
}

function withIndex(
  state: PlayerState,
  queue: PlayerTrack[],
  index: number,
  isPlaying = state.isPlaying,
): PlayerState {
  const track = queue[index];
  return {
    ...state,
    queue,
    currentIndex: index,
    isPlaying: Boolean(track) && !track.pending && isPlaying,
    currentTime: 0,
    duration: track ? durationFor(track, track.duration_seconds) : 0,
    error: null,
    playToken: state.playToken,
    expanded: Boolean(track) && state.expanded,
  };
}

export function playerReducer(
  state: PlayerState,
  action: PlayerAction,
): PlayerState {
  switch (action.type) {
    case "play": {
      const sourceQueue = uniqueTracks(
        action.queue && action.queue.length > 0 ? action.queue : [action.track],
      );
      const requestedIndex = sourceQueue.findIndex(
        (track) => track.id === action.track.id,
      );
      const queue =
        requestedIndex === -1 ? [...sourceQueue, action.track] : sourceQueue;
      const index = requestedIndex === -1 ? queue.length - 1 : requestedIndex;
      return {
        ...withIndex(state, queue, index, true),
        playToken: state.playToken + 1,
        expanded: state.expanded,
        importStatus: null,
        importError: null,
      };
    }

    case "playAt": {
      if (action.index < 0 || action.index >= state.queue.length) {
        return state;
      }
      return {
        ...withIndex(state, state.queue, action.index, true),
        playToken: state.playToken + 1,
        importStatus: null,
        importError: null,
      };
    }

    case "enqueue": {
      if (state.queue.some((track) => track.id === action.track.id)) {
        return state;
      }
      const queue = [...state.queue, action.track];
      if (state.currentIndex === -1) {
        return {
          ...state,
          queue,
          currentIndex: 0,
          duration: durationFor(action.track, action.track.duration_seconds),
          currentTime: 0,
          error: null,
        };
      }
      return { ...state, queue };
    }

    case "beginImport": {
      const track = { ...action.track, pending: true };
      return {
        ...state,
        queue: [track],
        currentIndex: 0,
        isPlaying: false,
        currentTime: 0,
        duration: Math.max(track.duration_seconds, 0),
        expanded: true,
        error: null,
        importStatus: null,
        importError: null,
      };
    }

    case "importJob":
      if (!isPending(state)) {
        return state;
      }
      return {
        ...state,
        queue: state.queue.map((track, index) =>
          index === state.currentIndex
            ? {
                ...track,
                import_job_id: action.jobId,
              }
            : track,
        ),
        importStatus: action.status,
        importError: null,
      };

    case "importStatus":
      if (!isPending(state)) {
        return state;
      }
      return { ...state, importStatus: action.status };

    case "importFailed":
      if (!isPending(state)) {
        return state;
      }
      return {
        ...state,
        isPlaying: false,
        importError: action.error,
      };

    case "importCompleted": {
      if (!isPending(state)) {
        return state;
      }
      const queue = state.queue.map((track, index) =>
        index === state.currentIndex ? action.track : track,
      );
      return {
        ...state,
        queue,
        isPlaying: true,
        currentTime: 0,
        duration: Math.max(action.track.duration_seconds, 0),
        importStatus: "completed",
        importError: null,
        playToken: state.playToken + 1,
      };
    }

    case "toggle":
      if (state.currentIndex === -1 || isPending(state)) {
        return state;
      }
      return { ...state, isPlaying: !state.isPlaying, error: null };

    case "setPlaying":
      if (
        state.currentIndex === -1 ||
        isPending(state) ||
        state.isPlaying === action.playing
      ) {
        return state;
      }
      return { ...state, isPlaying: action.playing };

    case "next":
      if (
        isPending(state) ||
        state.currentIndex < 0 ||
        state.currentIndex >= state.queue.length - 1
      ) {
        return state;
      }
      return withIndex(state, state.queue, state.currentIndex + 1);

    case "previous":
      if (state.currentIndex < 0 || isPending(state)) {
        return state;
      }
      if (state.currentIndex === 0) {
        return { ...state, currentTime: 0 };
      }
      return withIndex(state, state.queue, state.currentIndex - 1);

    case "ended":
      if (state.currentIndex < state.queue.length - 1) {
        return withIndex(state, state.queue, state.currentIndex + 1, true);
      }
      return { ...state, isPlaying: false, currentTime: state.duration };

    case "seek": {
      if (state.currentIndex === -1 || isPending(state)) {
        return state;
      }
      const maximum = state.duration > 0 ? state.duration : state.currentTime;
      return {
        ...state,
        currentTime: clamp(action.time, 0, maximum),
        error: null,
      };
    }

    case "time": {
      if (state.currentIndex === -1 || isPending(state)) {
        return state;
      }
      const duration =
        Number.isFinite(action.duration) && action.duration > 0
          ? action.duration
          : state.duration;
      return {
        ...state,
        currentTime: clamp(action.time, 0, duration || action.time),
        duration,
      };
    }

    case "duration":
      if (
        state.currentIndex === -1 ||
        isPending(state) ||
        !Number.isFinite(action.duration) ||
        action.duration <= 0
      ) {
        return state;
      }
      return { ...state, duration: action.duration };

    case "remove": {
      if (action.index < 0 || action.index >= state.queue.length) {
        return state;
      }
      const queue = state.queue.filter((_, index) => index !== action.index);
      if (queue.length === 0) {
        return {
          ...initialPlayerState,
          volume: state.volume,
          muted: state.muted,
        };
      }
      if (action.index > state.currentIndex) {
        return { ...state, queue };
      }
      if (action.index < state.currentIndex) {
        return { ...state, queue, currentIndex: state.currentIndex - 1 };
      }
      const nextIndex = Math.min(action.index, queue.length - 1);
      return withIndex(state, queue, nextIndex);
    }

    case "clear":
      return {
        ...initialPlayerState,
        volume: state.volume,
        muted: state.muted,
      };

    case "expanded":
      if (state.currentIndex === -1 && action.expanded) {
        return state;
      }
      return { ...state, expanded: action.expanded };

    case "volume":
      return {
        ...state,
        volume: clamp(action.volume, 0, 1),
        muted: false,
      };

    case "muted":
      return { ...state, muted: action.muted };

    case "error":
      return {
        ...state,
        error: action.error,
        isPlaying: action.error ? false : state.isPlaying,
      };

    default:
      return state;
  }
}
