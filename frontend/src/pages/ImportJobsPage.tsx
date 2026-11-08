import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  approveImportJob,
  listImportJobs,
  rejectImportJob,
  updateImportJob,
} from "../api";
import type { ImportJob, ImportJobStatus } from "../types";

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  queued: "Queued",
  searching: "Searching",
  downloading: "Downloading",
  processing: "Processing",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const FILTERS: Array<{ value: ImportJobStatus | "all"; label: string }> = [
  { value: "needs_review", label: "Needs review" },
  { value: "queued", label: "Queued" },
  { value: "searching", label: "Searching" },
  { value: "downloading", label: "Downloading" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All jobs" },
];

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "Unknown length";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function ImportJobCard({ job }: { job: ImportJob }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(job.candidate_title ?? "");
  const [artist, setArtist] = useState(job.candidate_artist ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(job.candidate_title ?? "");
    setArtist(job.candidate_artist ?? "");
  }, [job.id, job.candidate_title, job.candidate_artist]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["import-jobs"] });
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      updateImportJob(job.id, {
        candidate_title: title.trim(),
        candidate_artist: artist.trim(),
      }),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: () => setError("The candidate could not be saved."),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !artist.trim()) {
        throw new Error("Title and artist are required.");
      }
      if (
        title.trim() !== job.candidate_title ||
        artist.trim() !== job.candidate_artist
      ) {
        await updateImportJob(job.id, {
          candidate_title: title.trim(),
          candidate_artist: artist.trim(),
        });
      }
      return approveImportJob(job.id);
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The import could not be approved.",
      );
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectImportJob(job.id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: () => setError("The import could not be rejected."),
  });

  function handleReject() {
    if (window.confirm("Reject this import? Nothing will be downloaded.")) {
      rejectMutation.mutate();
    }
  }

  const isReview = job.status === "needs_review";

  return (
    <article className="import-card panel">
      <div className="import-card-head">
        <div>
          <span className="eyebrow">Request</span>
          <h2>{job.query_text}</h2>
        </div>
        <span className={`status-pill status-${job.status}`}>
          {STATUS_LABELS[job.status]}
        </span>
      </div>

      <dl className="import-meta">
        <div>
          <dt>Candidate</dt>
          <dd>{job.candidate_title ?? "Not selected"}</dd>
        </div>
        <div>
          <dt>Artist</dt>
          <dd>{job.candidate_artist ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Length</dt>
          <dd className="mono">
            {formatDuration(job.candidate_duration_seconds)}
          </dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd className="mono">
            {new Date(job.created_at).toLocaleString()}
          </dd>
        </div>
      </dl>

      {job.error_message && (
        <p className="import-error">{job.error_message}</p>
      )}

      {isReview && (
        <>
          <div className="import-edit-grid">
            <label className="field">
              <span>Candidate title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label={`Candidate title for ${job.query_text}`}
              />
            </label>
            <label className="field">
              <span>Candidate artist</span>
              <input
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                aria-label={`Candidate artist for ${job.query_text}`}
              />
            </label>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="import-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              Save details
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "Approving…" : "Approve import"}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              Reject
            </button>
          </div>
        </>
      )}
    </article>
  );
}

export function ImportJobsPage() {
  const [filter, setFilter] = useState<ImportJobStatus | "all">(
    "needs_review",
  );
  const jobsQuery = useQuery({
    queryKey: ["import-jobs", filter],
    queryFn: () =>
      listImportJobs(filter === "all" ? undefined : filter),
    refetchInterval: 4000,
  });

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Archive / Imports</span>
          <h1>Review imports</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Editorial desk</span>
          <span>Candidate review</span>
        </div>
      </header>

      <div className="import-filter">
        <label className="field">
          <span>Filter by status</span>
          <select
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as ImportJobStatus | "all")
            }
            aria-label="Filter import jobs by status"
          >
            {FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="role-note">
          Ambiguous candidates wait here until an editor approves or rejects
          them. Approved jobs are downloaded by the import worker.
        </p>
      </div>

      {jobsQuery.isLoading && (
        <div className="panel">
          <p className="muted">Opening the import desk…</p>
        </div>
      )}

      {jobsQuery.isError && (
        <div className="form-error" role="alert">
          Import jobs could not be loaded.
        </div>
      )}

      {!jobsQuery.isLoading &&
        !jobsQuery.isError &&
        (jobsQuery.data?.length ?? 0) === 0 && (
          <div className="panel import-empty">
            <span className="eyebrow">Import desk / Clear</span>
            <h2>Nothing waiting.</h2>
            <p>
              There are no jobs with this status. Jobs created from an empty
              search will appear here automatically.
            </p>
          </div>
        )}

      <div className="import-list">
        {jobsQuery.data?.map((job) => (
          <ImportJobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}
