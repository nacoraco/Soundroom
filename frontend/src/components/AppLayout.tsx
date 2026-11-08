import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth, useLogout } from "../auth";

function initials(name: string | undefined): string {
  if (!name) {
    return "SR";
  }
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "SR"
  );
}

export function AppLayout() {
  const { data } = useAuth();
  const logoutMutation = useLogout();
  const navigate = useNavigate();
  const user = data?.user;
  const canEdit = user?.role === "editor" || user?.role === "admin";

  async function handleLogout() {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/library" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">Soundroom</span>
          <span className="brand-meta">Archive / 01</span>
        </Link>

        <nav className="side-nav" aria-label="Main navigation">
          <NavLink to="/library">
            <span className="nav-index">01</span>
            Library
          </NavLink>
          {canEdit && (
            <NavLink to="/upload">
              <span className="nav-index">02</span>
              Upload
            </NavLink>
          )}
          {user?.role === "admin" && (
            <NavLink to="/admin/users">
              <span className="nav-index">03</span>
              People
            </NavLink>
          )}
        </nav>

        <div className="sidebar-note">
          <p className="eyebrow">Listening room</p>
          <p>A private room for the records you keep close.</p>
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <span className="user-avatar" aria-hidden="true">
              {initials(user?.display_name)}
            </span>
            <span>
              <span className="user-name">{user?.display_name}</span>
              <span className="user-role">{user?.role}</span>
            </span>
          </div>
          <button
            type="button"
            className="signout"
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? "Signing out…" : "Sign out"}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
