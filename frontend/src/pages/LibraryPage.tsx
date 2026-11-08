import { useAuth } from "../auth";

export function LibraryPage() {
  const { data } = useAuth();
  const user = data?.user;
  const canEdit = user?.role === "editor" || user?.role === "admin";

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
            This is where your records will live. Uploads, search and playback
            arrive in the next movements, and the room will fill up from there.
          </p>

          <ul className="coming-list" aria-label="Coming next">
            <li>
              <span className="mono">01</span>
              <span>Upload recordings</span>
              <span className="mono muted">Next</span>
            </li>
            <li>
              <span className="mono">02</span>
              <span>Search the archive</span>
              <span className="mono muted">Next</span>
            </li>
            <li>
              <span className="mono">03</span>
              <span>Play and queue</span>
              <span className="mono muted">Next</span>
            </li>
          </ul>

          <p className="role-note">
            {canEdit
              ? "As an editor, you will be able to add recordings once uploads are enabled."
              : "Your administrator will add recordings to the archive."}
          </p>
        </div>
      </div>
    </section>
  );
}
