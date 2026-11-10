export interface NativeMediaUpdate {
  title: string;
  artist: string;
  album: string;
  duration: number;
  isPlaying: boolean;
  position: number;
}

interface NativeMediaAction {
  action: string;
}

interface NativeMediaListenerHandle {
  remove: () => Promise<void>;
}

interface NativeMediaPlugin {
  update: (options: NativeMediaUpdate) => Promise<void>;
  clear: () => Promise<void>;
  addListener: (
    eventName: "mediaAction",
    listener: (data: NativeMediaAction) => void,
  ) => NativeMediaListenerHandle | Promise<NativeMediaListenerHandle>;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
}

function getNativeMediaPlugin(): NativeMediaPlugin | null {
  const capacitor = (
    window as unknown as { Capacitor?: CapacitorGlobal }
  ).Capacitor;
  if (!capacitor?.isNativePlatform?.()) {
    return null;
  }
  const plugin = capacitor.Plugins?.NativeMediaSession;
  return (plugin as NativeMediaPlugin | undefined) ?? null;
}

export function hasNativeMediaSession(): boolean {
  return getNativeMediaPlugin() !== null;
}

export function updateNativeMediaSession(update: NativeMediaUpdate): void {
  void getNativeMediaPlugin()?.update(update).catch(() => undefined);
}

export function clearNativeMediaSession(): void {
  void getNativeMediaPlugin()?.clear().catch(() => undefined);
}

export async function addNativeMediaSessionListener(
  listener: (data: NativeMediaAction) => void,
): Promise<NativeMediaListenerHandle | null> {
  const plugin = getNativeMediaPlugin();
  if (!plugin) {
    return null;
  }
  return await plugin.addListener("mediaAction", listener);
}

if (getNativeMediaPlugin() !== null) {
  (
    window as unknown as { __soundroomWebNativeMediaBridge?: boolean }
  ).__soundroomWebNativeMediaBridge = true;
}
