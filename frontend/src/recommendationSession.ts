import type { PlayerTrack } from "./playerState";

export const MAX_RECOMMENDATION_HISTORY = 10;
export const RECOMMENDATION_COMPLETION_THRESHOLD = 0.5;
export const RECOMMENDATION_BATCH_SIZE = 1;
export const RECOMMENDATION_BUFFER_SIZE = 2;
export const MAX_RECOMMENDATION_SEEDS = MAX_RECOMMENDATION_HISTORY;
export const MAX_RECOMMENDATION_REJECTIONS = 100;
const TRAILING_BRACKETS = /\s*[([][^)\]]*[)\]]\s*$/;

export interface RecommendationSeed {
  title: string;
  artist: string;
}

export interface RecommendationHistoryEntry {
  track: PlayerTrack;
  progressSeconds: number;
  durationSeconds: number;
  order: number;
}

export function createRecommendationHistoryEntry(
  track: PlayerTrack,
  order: number,
  progressSeconds = 0,
  durationSeconds = Math.max(track.duration_seconds, 0),
): RecommendationHistoryEntry {
  return {
    track,
    progressSeconds: Math.max(0, progressSeconds),
    durationSeconds: Math.max(0, durationSeconds),
    order,
  };
}

export function addRecommendationHistoryEntry(
  history: RecommendationHistoryEntry[],
  entry: RecommendationHistoryEntry,
): RecommendationHistoryEntry[] {
  if (history.some((item) => item.track.id === entry.track.id)) {
    return history;
  }
  const next = [...history, entry];
  return next.length > MAX_RECOMMENDATION_HISTORY
    ? next.slice(next.length - MAX_RECOMMENDATION_HISTORY)
    : next;
}

export function updateRecommendationProgress(
  history: RecommendationHistoryEntry[],
  trackId: string,
  progressSeconds: number,
  durationSeconds: number,
): RecommendationHistoryEntry[] {
  let changed = false;
  const next = history.map((entry) => {
    if (entry.track.id !== trackId) {
      return entry;
    }
    const progress = Math.max(
      entry.progressSeconds,
      Math.max(0, progressSeconds),
    );
    const duration =
      durationSeconds > 0 ? durationSeconds : entry.durationSeconds;
    if (
      progress === entry.progressSeconds &&
      duration === entry.durationSeconds
    ) {
      return entry;
    }
    changed = true;
    return { ...entry, progressSeconds: progress, durationSeconds: duration };
  });
  return changed ? next : history;
}

export function removeRecommendationHistoryTrack(
  history: RecommendationHistoryEntry[],
  trackId: string,
): RecommendationHistoryEntry[] {
  return history.filter((entry) => entry.track.id !== trackId);
}

export function replaceRecommendationHistoryTrack(
  history: RecommendationHistoryEntry[],
  previousTrackId: string,
  track: PlayerTrack,
): RecommendationHistoryEntry[] {
  const index = history.findIndex(
    (entry) => entry.track.id === previousTrackId,
  );
  if (index === -1) {
    return history;
  }
  const duplicateIndex = history.findIndex(
    (entry) => entry.track.id === track.id,
  );
  if (duplicateIndex !== -1 && duplicateIndex !== index) {
    return history.filter((_, entryIndex) => entryIndex !== index);
  }
  const next = [...history];
  next[index] = {
    ...next[index],
    track,
    durationSeconds: Math.max(
      next[index].durationSeconds,
      Math.max(track.duration_seconds, 0),
    ),
  };
  return next;
}

export function recommendationCompletion(
  entry: RecommendationHistoryEntry,
): number {
  if (entry.durationSeconds <= 0) {
    return 0;
  }
  return entry.progressSeconds / entry.durationSeconds;
}

function stripTrailingBrackets(value: string): string {
  let result = value.trim();
  let previous = "";
  while (previous !== result) {
    previous = result;
    result = result.replace(TRAILING_BRACKETS, "").trim();
  }
  return result;
}

function compactMetadata(value: string): string {
  return normalizeRecommendationText(value).replace(/ /g, "");
}

export function normalizeRecommendationText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function cleanRecommendationMetadata(
  artist: string,
  title: string,
): { title: string; artist: string } {
  const cleanedArtist = artist.trim();
  const cleanedTitle = stripTrailingBrackets(title);

  if (cleanedTitle.includes(" - ")) {
    const [prefix, suffix] = cleanedTitle.split(" - ", 2);
    const cleanedPrefix = prefix.trim();
    const cleanedSuffix = stripTrailingBrackets(suffix);
    const prefixCompact = compactMetadata(cleanedPrefix);
    const artistCompact = compactMetadata(cleanedArtist);
    if (
      cleanedPrefix &&
      cleanedSuffix &&
      prefixCompact &&
      artistCompact &&
      (prefixCompact.includes(artistCompact) ||
        artistCompact.includes(prefixCompact))
    ) {
      return { title: cleanedSuffix, artist: cleanedPrefix };
    }
  }

  return {
    title: cleanedTitle || title.trim(),
    artist: cleanedArtist,
  };
}

export function recommendationKey(title: string, artist: string): string {
  const metadata = cleanRecommendationMetadata(artist, title);
  return `${normalizeRecommendationText(metadata.title)}|${normalizeRecommendationText(
    metadata.artist,
  )}`;
}

export function addRecommendationRejection(
  rejections: RecommendationSeed[],
  rejection: RecommendationSeed,
): RecommendationSeed[] {
  const metadata = cleanRecommendationMetadata(
    rejection.artist,
    rejection.title,
  );
  if (!metadata.title || !metadata.artist) {
    return rejections;
  }
  const key = recommendationKey(metadata.title, metadata.artist);
  return [
    metadata,
    ...rejections.filter(
      (item) => recommendationKey(item.title, item.artist) !== key,
    ),
  ].slice(0, MAX_RECOMMENDATION_REJECTIONS);
}

export function shouldRejectSkippedTrack(
  track: PlayerTrack,
  history: RecommendationHistoryEntry[],
): boolean {
  const entry = history.find((item) => item.track.id === track.id);
  return (
    !entry ||
    recommendationCompletion(entry) <= RECOMMENDATION_COMPLETION_THRESHOLD
  );
}

export function selectRecommendationSeeds(
  history: RecommendationHistoryEntry[],
  originalSong: RecommendationSeed | null,
): RecommendationSeed[] {
  const qualifying = history.filter(
    (entry) =>
      !entry.track.pending &&
      entry.durationSeconds > 0 &&
      recommendationCompletion(entry) > RECOMMENDATION_COMPLETION_THRESHOLD,
  );

  const source: RecommendationSeed[] =
    qualifying.length > 0
      ? qualifying.map((entry) => ({
          title: entry.track.title,
          artist: entry.track.artist_name,
        }))
      : originalSong
        ? [originalSong]
        : [];

  const seen = new Set<string>();
  const seeds: RecommendationSeed[] = [];
  for (const seed of source) {
    const title = seed.title.trim();
    const artist = seed.artist.trim();
    if (!title || !artist) {
      continue;
    }
    const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    seeds.push({ title, artist });
    if (seeds.length >= MAX_RECOMMENDATION_SEEDS) {
      break;
    }
  }
  return seeds;
}
