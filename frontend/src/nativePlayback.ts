export interface NativeQueueItem {
  mediaId: string;
  queueItemId: string;
  trackId: string;
  streamUrl: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

export interface NativePlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
  currentIndex: number;
  mediaId: string;
  queueItemId: string;
  ended: boolean;
}

export interface NativeItemChanged {
  mediaId: string;
  queueItemId: string;
  index: number;
  previousMediaId: string;
  previousQueueItemId: string;
  previousPosition: number;
  previousDuration: number;
  reason: number;
}

export type NativePlaybackEvent =
  | { type: "state"; state: NativePlaybackState }
  | { type: "itemChanged"; change: NativeItemChanged }
  | { type: "error"; message: string };

interface NativeListenerHandle {
  remove: () => Promise<void>;
}

interface NativePlaybackPlugin {
  setQueue: (options: {
    items: NativeQueueItem[];
    startIndex: number;
    position: number;
    playWhenReady: boolean;
  }) => Promise<void>;
  updateQueue: (options: {
    items: NativeQueueItem[];
    currentMediaId: string;
    position: number;
    playWhenReady: boolean;
  }) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (options: { position: number }) => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => Promise<NativePlaybackState>;
  addListener: (
    eventName: "playbackState" | "itemChanged" | "playbackError",
    listener: (data: unknown) => void,
  ) => NativeListenerHandle | Promise<NativeListenerHandle>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function getNativePlaybackPlugin(): NativePlaybackPlugin | null {
  const capacitor = (
    window as unknown as { Capacitor?: CapacitorGlobal }
  ).Capacitor;
  if (!capacitor?.isNativePlatform?.()) {
    return null;
  }
  const plugin = capacitor.Plugins?.NativePlayback;
  return (plugin as NativePlaybackPlugin | undefined) ?? null;
}

export function isNativePlaybackAvailable(): boolean {
  return getNativePlaybackPlugin() !== null;
}

export async function setNativeQueue(
  items: NativeQueueItem[],
  startIndex: number,
  position: number,
  playWhenReady: boolean,
): Promise<void> {
  await getNativePlaybackPlugin()?.setQueue({
    items,
    startIndex,
    position,
    playWhenReady,
  });
}

export async function updateNativeQueue(
  items: NativeQueueItem[],
  currentMediaId: string,
  position: number,
  playWhenReady: boolean,
): Promise<void> {
  await getNativePlaybackPlugin()?.updateQueue({
    items,
    currentMediaId,
    position,
    playWhenReady,
  });
}

export async function playNative(): Promise<void> {
  await getNativePlaybackPlugin()?.play();
}

export async function pauseNative(): Promise<void> {
  await getNativePlaybackPlugin()?.pause();
}

export async function seekNative(positionSeconds: number): Promise<void> {
  await getNativePlaybackPlugin()?.seek({ position: positionSeconds });
}

export async function nextNative(): Promise<void> {
  await getNativePlaybackPlugin()?.next();
}

export async function previousNative(): Promise<void> {
  await getNativePlaybackPlugin()?.previous();
}

export async function stopNative(): Promise<void> {
  await getNativePlaybackPlugin()?.stop();
}

export async function getNativeState(): Promise<NativePlaybackState | null> {
  const plugin = getNativePlaybackPlugin();
  if (!plugin) {
    return null;
  }
  return await plugin.getState();
}

export async function addNativePlaybackListener(
  listener: (event: NativePlaybackEvent) => void,
): Promise<NativeListenerHandle | null> {
  const plugin = getNativePlaybackPlugin();
  if (!plugin) {
    return null;
  }
  const handles: NativeListenerHandle[] = [];
  handles.push(
    await Promise.resolve(
      plugin.addListener("playbackState", (data) => {
        listener({ type: "state", state: data as NativePlaybackState });
      }),
    ),
  );
  handles.push(
    await Promise.resolve(
      plugin.addListener("itemChanged", (data) => {
        listener({ type: "itemChanged", change: data as NativeItemChanged });
      }),
    ),
  );
  handles.push(
    await Promise.resolve(
      plugin.addListener("playbackError", (data) => {
        const payload = data as { message?: string };
        listener({
          type: "error",
          message: payload?.message ?? "Playback error",
        });
      }),
    ),
  );
  return {
    remove: async () => {
      for (const handle of handles) {
        await handle.remove();
      }
    },
  };
}
