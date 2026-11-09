import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import {
  getAppSettings,
  getLlmStatus,
  updateAppSettings,
} from "../api";

export function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: getAppSettings,
  });
  const [autoRip, setAutoRip] = useState(false);
  const [llmAutoApprove, setLlmAutoApprove] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState("15");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const llmStatusQuery = useQuery({
    queryKey: ["llm-status"],
    queryFn: getLlmStatus,
    enabled: llmAutoApprove,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setAutoRip(settingsQuery.data.auto_rip_on_miss);
      setLlmAutoApprove(settingsQuery.data.llm_auto_approve);
      setMaxMinutes(String(settingsQuery.data.max_track_minutes));
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["app-settings"], data);
      queryClient.invalidateQueries({ queryKey: ["import-config"] });
      setSaved(true);
      setError(null);
    },
    onError: () => {
      setSaved(false);
      setError("The settings could not be saved.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const minutes = Number.parseInt(maxMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Enter a maximum length between 1 and 1440 minutes.");
      return;
    }
    setError(null);
    saveMutation.mutate({
      auto_rip_on_miss: autoRip,
      llm_auto_approve: llmAutoApprove,
      max_track_minutes: minutes,
    });
  }

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Administration / Settings</span>
          <h1>Automatic import</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Admin only</span>
          <span>Global import policy</span>
        </div>
      </header>

      {settingsQuery.isLoading && (
        <div className="panel">
          <p className="muted">Loading settings…</p>
        </div>
      )}

      {settingsQuery.isError && (
        <div className="form-error" role="alert">
          The settings could not be loaded.
        </div>
      )}

      {settingsQuery.data && (
        <div className="admin-layout settings-layout">
          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">Import policy</span>
              <h2>Missing tracks</h2>
              <p className="muted">
                Decide whether a search without a local match may request a new
                track from the external source.
              </p>
            </div>

            <form className="settings-form" onSubmit={handleSubmit} noValidate>
              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>Automatic import</strong>
                  <span>
                    When enabled, listeners and editors can request a missing
                    track from the empty search state.
                  </span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={autoRip}
                    onChange={(event) => setAutoRip(event.target.checked)}
                    aria-label="Enable automatic import"
                  />
                  <span className="switch-track" aria-hidden="true" />
                </span>
              </label>

              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>Laya auto-review</strong>
                  <span>
                    Only for automatic imports without a chosen release: ask
                    the local Laya model to choose the highest-probability
                    version when the deterministic match is ambiguous. Search
                    imports selected in the library never use Laya.
                  </span>
                </span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={llmAutoApprove}
                    onChange={(event) =>
                      setLlmAutoApprove(event.target.checked)
                    }
                    aria-label="Use Laya for automatic imports"
                  />
                  <span className="switch-track" aria-hidden="true" />
                </span>
              </label>

              {llmAutoApprove && (
                <div
                  className={`llm-status ${
                    llmStatusQuery.data?.available ? "is-ok" : "is-error"
                  }`}
                  role="status"
                >
                  <span className="eyebrow">Laya status</span>
                  {llmStatusQuery.isLoading && (
                    <p>Checking Ollama and the Laya model…</p>
                  )}
                  {llmStatusQuery.isError && (
                    <p>The Laya status could not be checked.</p>
                  )}
                  {llmStatusQuery.data && (
                    <>
                      <p>
                        {llmStatusQuery.data.available
                          ? `Laya is available at ${llmStatusQuery.data.base_url} (model: ${llmStatusQuery.data.model}).`
                          : `Laya is not available: ${
                              llmStatusQuery.data.detail ?? "unknown reason"
                            }.`}
                      </p>
                      <button
                        type="button"
                        className="button button-quiet button-small"
                        onClick={() => llmStatusQuery.refetch()}
                        disabled={llmStatusQuery.isFetching}
                      >
                        {llmStatusQuery.isFetching
                          ? "Checking…"
                          : "Check again"}
                      </button>
                    </>
                  )}
                </div>
              )}

              <label className="field">
                <span>Maximum track length in minutes</span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={maxMinutes}
                  onChange={(event) => setMaxMinutes(event.target.value)}
                  aria-label="Maximum track length in minutes"
                />
              </label>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {saved && !error && (
                <p className="form-success" role="status">
                  Settings saved. The change applies to new import jobs.
                </p>
              )}

              <button
                type="submit"
                className="button button-primary"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save settings"}
              </button>
            </form>
          </div>

          <aside className="panel settings-note">
            <span className="eyebrow">Current policy</span>
            <h2>{autoRip ? "Import is open." : "Import is closed."}</h2>
            <p>
              {autoRip
                ? "Empty searches can request a missing recording. Candidates over the duration limit are discarded before download."
                : "Search will only look in the local archive. No external import can be requested."}
            </p>
            {llmAutoApprove && autoRip && (
              <p>
                Automatic imports without a selected release are sent to
                Laya. Search imports where the user chooses a release bypass
                Laya entirely; if a model call fails, the job stays in the
                editorial queue.
              </p>
            )}
            <p className="mono muted">
              Updated{" "}
              {new Date(settingsQuery.data.updated_at).toLocaleString()}
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}
