import type { PlayerTrack } from "./playerState";

export const MAX_RECOMMENDATION_HISTORY = 100;
export const RECOMMENDATION_COMPLETION_THRESHOLD = 0.5;
export const RECOMMENDATION_BATCH_SIZE = 1;
export const RECOMMENDATION_BUFFER_SIZE = 2;
export const MAX_RECOMMENDATION_SEEDS = 10;
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
      if (prefix && suffix && isDescriptorContent(suffix)) {
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
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const seed = source[index];
    const title = seed.title.trim();
    const artist = seed.artist.trim();
    if (!title || !artist) {
      continue;
    }
    const key = recommendationKey(title, artist);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    seeds.push({ title, artist });
    if (seeds.length >= MAX_RECOMMENDATION_SEEDS) {
      break;
    }
  }
  return seeds.reverse();
}
