import type { PlayerTrack } from "./playerState";

export const MAX_RECOMMENDATION_HISTORY = 100;
export const RECOMMENDATION_COMPLETION_THRESHOLD = 0.5;
export const RECOMMENDATION_BATCH_SIZE = 10;
export const RECOMMENDATION_BUFFER_SIZE = 3;
export const MAX_RECOMMENDATION_SEEDS = 10;
export const RECENT_RECOMMENDATION_SEEDS = 5;
export const RANDOM_QUALIFYING_SEEDS = 5;
export const MAX_RECOMMENDATION_REJECTIONS = 100;
export const MAX_RECOMMENDATION_EXCLUDE = 200;
const VERSION_MARKERS = new Set([
  "live",
  "concert",
  "performance",
  "unplugged",
  "remix",
  "edit",
  "cover",
  "karaoke",
  "instrumental",
  "acoustic",
  "demo",
  "extended",
  "nightcore",
  "slowed",
  "sped",
  "reverb",
  "session",
  "bbc",
]);
const DESCRIPTOR_WORDS = new Set([
  "official",
  "video",
  "music",
  "lyric",
  "lyrics",
  "audio",
  "visualizer",
  "visualiser",
  "hd",
  "hq",
  "4k",
  "8k",
  "8d",
  "mv",
  "clip",
  "videoclip",
  "color",
  "coded",
  "explicit",
  "clean",
  "uncensored",
  "censored",
  "remaster",
  "remastered",
  "topic",
  "feat",
  "ft",
  "featuring",
  "version",
  "album",
  "single",
  "original",
  "radio",
  "movie",
  "soundtrack",
  "ost",
  "from",
]);
const DEDUPE_WORDS = new Set([...VERSION_MARKERS, ...DESCRIPTOR_WORDS]);
const BRACKET_GROUP = /[([][^)\]]*[)\]]/g;
const TRAILING_DESCRIPTOR_PHRASES = [
  "official music video",
  "official video",
  "official audio",
  "lyric video",
  "lyrics video",
  "music video",
  "audio only",
  "sped up",
  "slowed down",
  "slowed + reverb",
  "radio edit",
  "album version",
  "single version",
  "original version",
];

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

function isDescriptorContent(value: string): boolean {
  const tokens = normalizeRecommendationText(value).split(" ").filter(Boolean);
  return tokens.some((token) => DEDUPE_WORDS.has(token));
}

function startsWithDescriptor(value: string): boolean {
  const tokens = normalizeRecommendationText(value).split(" ").filter(Boolean);
  return tokens.length > 0 && DEDUPE_WORDS.has(tokens[0]);
}

function removeDescriptorBrackets(value: string): string {
  return value.replace(BRACKET_GROUP, (match) => {
    const content = match.slice(1, -1);
    return isDescriptorContent(content) ? " " : match;
  });
}

function stripTrailingDescriptors(value: string): string {
  let result = value.trim();
  let previous = "";
  while (previous !== result) {
    previous = result;

    const separatorIndex = result.lastIndexOf(" - ");
    if (separatorIndex !== -1) {
      const prefix = result.slice(0, separatorIndex).trim();
      const suffix = result.slice(separatorIndex + 3).trim();
      if (prefix && suffix && startsWithDescriptor(suffix)) {
        result = prefix;
        continue;
      }
    }

    const lower = result.toLowerCase();
    const phrase = TRAILING_DESCRIPTOR_PHRASES.find((candidate) =>
      lower.endsWith(candidate),
    );
    if (phrase) {
      result = result.slice(0, result.length - phrase.length).trim();
      continue;
    }

    const tokens = result.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      const last = normalizeRecommendationText(tokens[tokens.length - 1]);
      if (DEDUPE_WORDS.has(last)) {
        tokens.pop();
        result = tokens.join(" ");
        continue;
      }
    }
    break;
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

function cleanIdentityMetadata(
  artist: string,
  title: string,
): { title: string; artist: string } {
  let cleanedArtist = artist.trim().replace(/\s*-\s*topic\s*$/i, "");
  let cleanedTitle = title.trim();

  for (const separator of ["|", "//"]) {
    const index = cleanedTitle.indexOf(separator);
    if (index !== -1) {
      cleanedTitle = cleanedTitle.slice(0, index).trim();
    }
  }

  cleanedTitle = stripTrailingDescriptors(
    removeDescriptorBrackets(cleanedTitle),
  );

  if (cleanedTitle.includes(" - ")) {
    const separatorIndex = cleanedTitle.indexOf(" - ");
    const prefix = cleanedTitle.slice(0, separatorIndex).trim();
    const suffix = stripTrailingDescriptors(
      removeDescriptorBrackets(
        cleanedTitle.slice(separatorIndex + 3).trim(),
      ),
    );
    const prefixCompact = compactMetadata(prefix);
    const artistCompact = compactMetadata(cleanedArtist);
    if (
      prefix &&
      suffix &&
      prefixCompact &&
      artistCompact &&
      (prefixCompact.includes(artistCompact) ||
        artistCompact.includes(prefixCompact))
    ) {
      cleanedArtist = prefix;
      cleanedTitle = suffix;
    }
  }

  cleanedTitle = stripTrailingDescriptors(
    removeDescriptorBrackets(cleanedTitle),
  );
  return {
    title: cleanedTitle || title.trim(),
    artist: cleanedArtist || artist.trim(),
  };
}

export function cleanRecommendationMetadata(
  artist: string,
  title: string,
): { title: string; artist: string } {
  return cleanIdentityMetadata(artist, title);
}

export function recommendationKey(title: string, artist: string): string {
  const metadata = cleanIdentityMetadata(artist, title);
  return `${compactMetadata(metadata.title)}|${compactMetadata(
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

function pickRandomSeeds<T>(
  items: T[],
  count: number,
  random: () => number,
): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const value = random();
    const bounded = Number.isFinite(value)
      ? Math.min(Math.max(value, 0), 0.999999)
      : 0;
    const index = Math.floor(bounded * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) {
      picked.push(item);
    }
  }
  return picked;
}

export function selectRecommendationSeeds(
  history: RecommendationHistoryEntry[],
  originalSong: RecommendationSeed | null,
  random: () => number = Math.random,
): RecommendationSeed[] {
  const qualifying: { seed: RecommendationSeed; index: number }[] = [];
  const seenQualifying = new Set<string>();

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.track.pending || entry.durationSeconds <= 0) {
      continue;
    }
    if (
      recommendationCompletion(entry) <=
      RECOMMENDATION_COMPLETION_THRESHOLD
    ) {
      continue;
    }
    const title = entry.track.title.trim();
    const artist = entry.track.artist_name.trim();
    if (!title || !artist) {
      continue;
    }
    const key = recommendationKey(title, artist);
    if (seenQualifying.has(key)) {
      continue;
    }
    seenQualifying.add(key);
    qualifying.push({ seed: { title, artist }, index });
  }

  if (qualifying.length === 0) {
    const title = originalSong?.title.trim() ?? "";
    const artist = originalSong?.artist.trim() ?? "";
    return title && artist ? [{ title, artist }] : [];
  }

  const recent = qualifying.slice(0, RECENT_RECOMMENDATION_SEEDS);
  const older = qualifying.slice(RECENT_RECOMMENDATION_SEEDS);
  const randomSeeds = pickRandomSeeds(
    older,
    RANDOM_QUALIFYING_SEEDS,
    random,
  );

  return [...recent, ...randomSeeds]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.seed);
}
