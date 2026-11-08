import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { ApiError, uploadTrack, type ApiErrorDetail } from "../api";
import type { Track } from "../types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function isMissingMetadata(
  detail: unknown,
): detail is ApiErrorDetail & {
  code: "missing_metadata";
  metadata: NonNullable<ApiErrorDetail["metadata"]>;
} {
  return (
    detail !== null &&
    typeof detail === "object" &&
    (detail as { code?: string }).code === "missing_metadata"
  );
}

export function UploadPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [releaseYear, setReleaseYear] = useState("");
  const [requiresMetadata, setRequiresMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Track | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const uploadMutation = useMutation({
    mutationFn: uploadTrack,
    onSuccess: (track) => {
      queryClient.invalidateQueries({ queryKey: ["tracks"] });
      setSuccess(track);
      setFile(null);
      setTitle("");
      setArtist("");
      setAlbum("");
      setReleaseYear("");
      setRequiresMetadata(false);
      setError(null);
      setFileInputKey((value) => value + 1);
    },
    onError: (mutationError) => {
      setSuccess(null);
      if (!(mutationError instanceof ApiError)) {
        setError("Upload failed. Try again.");
        return;
      }

      if (mutationError.status === 422 && isMissingMetadata(mutationError.detail)) {
        const metadata = mutationError.detail.metadata;
        setRequiresMetadata(true);
        if (!title && metadata.title) setTitle(metadata.title);
        if (!artist && metadata.artist) setArtist(metadata.artist);
        if (!album && metadata.album) setAlbum(metadata.album);
        if (!releaseYear && metadata.release_year) {
          setReleaseYear(String(metadata.release_year));
        }
        setError(
          "This file has no title or artist tag. Enter the missing details and upload again.",
        );
        return;
      }

      setError(mutationError.message);
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setRequiresMetadata(false);
    setError(null);
    setSuccess(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Choose an MP3 file first.");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".mp3")) {
      setError("Only MP3 files are accepted.");
      return;
    }

    if (requiresMetadata && (!title.trim() || !artist.trim())) {
      setError("Enter the missing title and artist to continue.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    if (artist.trim()) formData.append("artist", artist.trim());
    if (album.trim()) formData.append("album", album.trim());
    if (releaseYear) formData.append("release_year", releaseYear);

    uploadMutation.mutate(formData);
  }

  const busy = uploadMutation.isPending;

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Archive / Upload</span>
          <h1>Add a recording</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">MP3 only</span>
          <span>Tags are read automatically</span>
        </div>
      </header>

      <div className="upload-layout">
        <form className="panel upload-form" onSubmit={handleSubmit} noValidate>
          <div className="panel-head">
            <span className="eyebrow">New recording</span>
            <h2>Select a file</h2>
          </div>

          <label
            className={`file-drop${file ? " file-drop-selected" : ""}`}
            htmlFor="track-file"
          >
            <input
              key={fileInputKey}
              id="track-file"
              type="file"
              accept=".mp3,audio/mpeg"
              onChange={handleFileChange}
              disabled={busy}
            />
            <span className="file-drop-title">
              {file ? file.name : "Choose an MP3 file"}
            </span>
            <span className="file-drop-meta">
              {file
                ? `${formatFileSize(file.size)} · ${
                    requiresMetadata ? "Needs metadata" : "Ready to upload"
                  }`
                : "Click to browse. The server checks the actual audio content."}
            </span>
          </label>

          <div className="upload-fields">
            <label className="field">
              <span>
                Title
                {requiresMetadata && (
                  <em className="required-mark">Required</em>
                )}
              </span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Read from file tags when left blank"
                required={requiresMetadata}
                aria-required={requiresMetadata}
                disabled={busy}
              />
            </label>

            <label className="field">
              <span>
                Artist
                {requiresMetadata && (
                  <em className="required-mark">Required</em>
                )}
              </span>
              <input
                type="text"
                value={artist}
                onChange={(event) => setArtist(event.target.value)}
                placeholder="Read from file tags when left blank"
                required={requiresMetadata}
                aria-required={requiresMetadata}
                disabled={busy}
              />
            </label>

            <label className="field">
              <span>Album (optional)</span>
              <input
                type="text"
                value={album}
                onChange={(event) => setAlbum(event.target.value)}
                placeholder="Read from file tags when left blank"
                disabled={busy}
              />
            </label>

            <label className="field">
              <span>Release year (optional)</span>
              <input
                type="number"
                min={1900}
                max={2100}
                value={releaseYear}
                onChange={(event) => setReleaseYear(event.target.value)}
                placeholder="e.g. 2026"
                disabled={busy}
              />
            </label>
          </div>

          {requiresMetadata && (
            <p className="upload-hint" role="status">
              The audio file has no title or artist tag. The file stays
              selected; fill in the fields above and upload again.
            </p>
          )}

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="button button-primary button-block"
            disabled={busy || !file}
          >
            {busy ? "Uploading…" : "Upload recording"}
          </button>
        </form>

        <aside className="panel upload-guidance">
          <span className="eyebrow">Before you upload</span>
          <h2>One file, properly labelled.</h2>
          <ol className="guidance-list">
            <li>
              <span className="mono">01</span>
              <p>Use an MP3 file. Other file types are rejected.</p>
            </li>
            <li>
              <span className="mono">02</span>
              <p>
                Title and artist come from the file tags. If they are missing,
                enter them manually.
              </p>
            </li>
            <li>
              <span className="mono">03</span>
              <p>
                The original audio is stored in the archive. Duplicate files
                are detected by their hash.
              </p>
            </li>
          </ol>
          <p className="guidance-note">
            Album and release year are optional. The recording appears in the
            library immediately after a successful upload.
          </p>
        </aside>
      </div>

      {success && (
        <div className="upload-success" role="status">
          <span className="eyebrow">Stored in the archive</span>
          <h2>{success.title}</h2>
          <p>
            {success.artist_name}
            {success.album_title ? ` · ${success.album_title}` : ""} ·{" "}
            {formatDuration(success.duration_seconds)}
          </p>
          <Link to="/library" className="button button-primary">
            View in library
          </Link>
        </div>
      )}
    </section>
  );
}
