import type { ImportJobStatus } from "./types";

export const IMPORT_STATUS_LABELS: Record<ImportJobStatus, string> = {
  queued: "Queued",
  searching: "Searching",
  downloading: "Downloading",
  processing: "Processing",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const ACTIVE_IMPORT_STATUSES: ImportJobStatus[] = [
  "queued",
  "searching",
  "downloading",
  "processing",
  "needs_review",
];
