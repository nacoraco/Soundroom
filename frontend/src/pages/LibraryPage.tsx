import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { listTracks } from "../api";
import { useAuth } from "../auth";

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function LibraryPage() {
  const { data } = useAuth();
  const user = data?.user;
  const canEdit = user?.role === "editor" || user?.role === "admin";
  const tracksQuery = useQuery({
    queryKey: ["tracks"],
    queryFn: listTracks,
  });
  const tracks = tracksQuery.data ?? [];

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Archive / Library</span>
          <h1>Your listening room</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Signed in</span>
          <span>{user?.email}</span>
        </div>
      </header>

      {tracksQuery.isLoading && (
        <div className="panel">
          <p className="muted">Opening the shelves…</p>
        </div>
      )}

      {tracksQuery.isError && (
        <div className="form-error" role="alert">
          The library could not be loaded.
        </div>
      )}

      {!tracksQuery.isLoading && !tracksQuery.isError && tracks.length === 0 && (
        <div className="library-hero">
          <div className="sleeve-stage" aria-hidden="true">
            <div className="sleeve-record" />
            <div className="sleeve">
              <span className="sleeve-code">SR–001</span>
              <span className="sleeve-title">Personal archive</span>
              <span className="sleeve-foot">33⅓ RPM · Stereo</span>
            </div>
          </div>

          <div className="library-copy">
            <span className="eyebrow">Shelf 01 / Empty</span>
            <h2>The shelves are waiting.</h2>
            <p>
              This is where your records will live. Uploads are ready; search
              and playback arrive in the next movements, and the room will fill
              up from there.
            </p>

            <ul className="coming-list" aria-label="Coming next">
              <li>
                <span className="mono">01</span>
                <span>Search the archive</span>
                <span className="mono muted">Next</span>
              </li>
              <li>
                <span className="mono">02</span>
                <span>Play and queue</span>
                <span className="mono muted">Next</span>
              </li>
              <li>
                <span className="mono">03</span>
                <span>Build playlists</span>
                <span className="mono muted">Next</span>
              </li>
            </ul>

            {canEdit ? (
              <div className="library-actions">
                <Link to="/upload" className="button button-primary">
                  Add a recording
                </Link>
                <p className="role-note">
                  As an editor, you can add the first recording to the archive.
                </p>
              </div>
            ) : (
              <p className="role-note">
                Your administrator will add recordings to the archive.
              </p>
            )}
          </div>
        </div>
      )}

      {!tracksQuery.isLoading && !tracksQuery.isError && tracks.length > 0 && (
        <section className="track-index">
          <div className="track-index-head">
            <div>
              <span className="eyebrow">
                Shelf 01 / {tracks.length}{" "}
                {tracks.length === 1 ? "recording" : "recordings"}
              </span>
              <h2>Recently added</h2>
            </div>
            {canEdit && (
              <Link
                to="/upload"
                className="button button-primary button-small"
              >
                Add recording
              </Link>
            )}
          </div>

          <ol className="track-list">
            {tracks.map((track, index) => (
              <li key={track.id}>
                <span className="track-number mono">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="track-main">
                  <strong>{track.title}</strong>
                  <span>
                    {track.artist_name}
                    {track.album_title ? ` · ${track.album_title}` : ""}
                  </span>
                </span>
                <span className="track-duration mono">
                  {formatDuration(track.duration_seconds)}
                </span>
              </li>
            ))}
          </ol>

          <p className="role-note">
            Search and playback are added in the next features. Uploaded
            recordings are stored in the archive.
          </p>
        </section>
      )}
    </section>
  );
}
