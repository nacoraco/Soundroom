import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createImportJob, getImportConfig, getImportJob } from "../api";
import { ACTIVE_IMPORT_STATUSES, IMPORT_STATUS_LABELS } from "../importStatus";

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "unknown length";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function ImportRequest({ query }: { query: string }) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configQuery = useQuery({
    queryKey: ["import-config"],
    queryFn: getImportConfig,
  });

  const jobQuery = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: () => getImportJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_IMPORT_STATUSES.includes(status) ? 2500 : false;
    },
  });

  useEffect(() => {
    setJobId(null);
    setError(null);
  }, [query]);

  useEffect(() => {
    if (jobQuery.data?.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["tracks"] });
    }
  }, [jobQuery.data?.status, queryClient]);

  const createMutation = useMutation({
    mutationFn: () => createImportJob(query),
    onSuccess: (job) => {
      setJobId(job.id);
      setError(null);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "The import could not be requested.",
      );
    },
  });

  const job = jobQuery.data;
  const config = configQuery.data;

  if (configQuery.isLoading) {
    return (
      <div className="import-request">
        <p className="muted">Checking import availability…</p>
      </div>
    );
  }

  if (configQuery.isError) {
    return (
      <div className="import-request">
        <p className="muted">
          Import availability could not be checked. The recording is not in the
          library.
        </p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="import-request">
        <p className="muted">Import availability is not available.</p>
      </div>
    );
  }

  if (!config.auto_rip_on_miss && !job) {
    return (
      <div className="import-request">
        <p className="muted">
          This recording is not in the library. Automatic import is disabled by
          the administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="import-request" aria-live="polite">
      <div className="import-request-head">
        <span className="eyebrow">Missing recording</span>
        {job && (
          <span className={`status-pill status-${job.status}`}>
            {IMPORT_STATUS_LABELS[job.status]}
          </span>
        )}
      </div>

      {!job && (
        <>
          <p>
            No local match. Request this recording from the external source?
          </p>
          <div className="import-request-actions">
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Requesting…" : "Request import"}
            </button>
            <span className="mono muted">
              Maximum {config.max_track_minutes} min
            </span>
          </div>
        </>
      )}

      {job && (
        <div className="import-request-status">
          <p>
            {job.status === "needs_review" &&
              "A curator is checking this candidate before it is downloaded."}
            {job.status === "completed" &&
              "The recording was added to the archive. Refreshing the search…"}
            {job.status === "failed" &&
              (job.error_message ?? "The import failed.")}
            {job.status === "cancelled" &&
              "The import was rejected by an editor."}
            {ACTIVE_IMPORT_STATUSES.includes(job.status) &&
              job.status !== "needs_review" &&
              "The import worker is working on this request."}
          </p>
          {job.candidate_title && (
            <p className="import-candidate">
              <strong>{job.candidate_title}</strong>
              {job.candidate_artist ? ` · ${job.candidate_artist}` : ""}
              <span className="mono">
                {" "}
                · {formatDuration(job.candidate_duration_seconds)}
              </span>
            </p>
          )}
          {(job.status === "failed" || job.status === "cancelled") && (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              Try again
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
