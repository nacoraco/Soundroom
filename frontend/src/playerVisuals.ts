import type { CSSProperties } from "react";

import type { ImportJobStatus, Track } from "./types";

const ACCENTS = ["#b8873f", "#a54a35", "#5b755e", "#7d6b93", "#4d7c85"];

export function formatTime(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function trackInitials(track: Track): string {
  const words = track.title
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "SR";
}

export function trackAccent(track: Track): string {
  let hash = 0;
  for (const character of track.id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length];
}

export function artStyle(track: Track): CSSProperties {
  return {
    "--art-accent": trackAccent(track),
    "--track-accent": trackAccent(track),
  } as CSSProperties;
}

export function rangeStyle(value: number, maximum: number): CSSProperties {
  const percent =
    maximum > 0 ? Math.min(Math.max((value / maximum) * 100, 0), 100) : 0;
  return { "--range-progress": `${percent}%` } as CSSProperties;
}

export function importStatusLabel(status: ImportJobStatus | null): string {
  switch (status) {
    case "queued":
      return "Waiting for the worker";
    case "searching":
      return "Searching the external source";
    case "downloading":
      return "Downloading from YouTube";
    case "processing":
      return "Preparing the audio";
    case "needs_review":
      return "Waiting for review";
    case "completed":
      return "Starting playback";
    case "failed":
      return "Download failed";
    case "cancelled":
      return "Download cancelled";
    default:
      return "Starting the import";
  }
}
