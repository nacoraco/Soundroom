import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { useAuth, useLogout } from "../auth";
import { usePlayer } from "../player";
import { PlayerBar } from "./PlayerBar";
import { PlayerExpanded } from "./PlayerExpanded";
import {
  CloseIcon,
  DiscoverIcon,
  HomeIcon,
  LibraryIcon,
  MoreIcon,
} from "./playerIcons";

const navItems = [
  { to: "/library", label: "Library", index: "01" },
  { to: "/playlists", label: "Playlists", index: "02" },
  { to: "/discover", label: "Discover", index: "03" },
  { to: "/upload", label: "Upload", index: "04" },
  { to: "/imports", label: "Imports", index: "05" },
  { to: "/admin/users", label: "People", index: "06", admin: true },
];

const mobileNavItems = [
  { to: "/library", label: "Library", icon: HomeIcon },
  { to: "/playlists", label: "Playlists", icon: LibraryIcon },
  { to: "/discover", label: "Discover", icon: DiscoverIcon },
];

export function AppLayout() {
  const { data: auth } = useAuth();
  const signOutMutation = useLogout();
  const { state, currentTrack } = usePlayer();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const canEdit = auth?.user.role === "editor" || auth?.user.role === "admin";
  const isAdmin = auth?.user.role === "admin";
  const moreItems = navItems.filter((item) => {
    if (["/library", "/playlists", "/discover"].includes(item.to)) {
      return false;
    }
    if (item.admin && !isAdmin) {
      return false;
    }
    return item.to !== "/upload" || canEdit;
  });
  const moreActive =
    moreItems.some((item) => location.pathname.startsWith(item.to)) ||
    location.pathname.startsWith("/admin");

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  return (
    <div
      className={`app-shell ${currentTrack ? "has-player" : ""}`}
    >
      <aside className="sidebar">
        <Link className="brand" to="/library" aria-label="Soundroom library">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">Soundroom</span>
          <span className="brand-meta">Personal listening archive</span>
        </Link>

        <nav className="side-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            if (item.admin && !isAdmin) {
              return null;
            }
            if (item.to === "/upload" && !canEdit) {
              return null;
            }
            return (
              <NavLink key={item.to} to={item.to}>
                <span className="nav-index">{item.index}</span>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          {isAdmin && (
            <NavLink to="/admin/settings">
              <span className="nav-index">07</span>
              <span>Settings</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-note">
          <span className="eyebrow">Now spinning</span>
          <p>Your records, kept together in one quiet room.</p>
        </div>

        <div className="sidebar-footer">
          <div className="user-card">
            <span className="user-avatar" aria-hidden="true">
              {auth?.user.email.charAt(0).toUpperCase() ?? "?"}
            </span>
            <span>
              <span className="user-name">{auth?.user.email}</span>
              <span className="user-role">{auth?.user.role ?? "listener"}</span>
            </span>
          </div>
          <button
            type="button"
            className="signout"
            onClick={() => signOutMutation.mutate()}
          >
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="mobile-brand" to="/library" aria-label="Soundroom library">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">Soundroom</span>
        </Link>
        <button
          type="button"
          className="mobile-profile-button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open account and more navigation"
          aria-expanded={mobileMenuOpen}
        >
          {auth?.user.email.charAt(0).toUpperCase() ?? "?"}
        </button>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <PlayerBar />
      {state.expanded && currentTrack && <PlayerExpanded />}

      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `mobile-tab ${isActive ? "active" : ""}`
              }
              onClick={() => setMobileMenuOpen(false)}
            >
              <Icon size={22} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`mobile-tab ${moreActive || mobileMenuOpen ? "active" : ""}`}
          onClick={() => setMobileMenuOpen(true)}
          aria-expanded={mobileMenuOpen}
        >
          <MoreIcon size={22} />
          <span>More</span>
        </button>
      </nav>

      {mobileMenuOpen && (
        <>
          <button
            type="button"
            className="mobile-menu-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close more navigation"
          />
          <section
            className="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
          >
            <span className="mobile-menu-handle" aria-hidden="true" />
            <div className="mobile-menu-head">
              <div>
                <span className="eyebrow">Soundroom / More</span>
                <h2>Elsewhere in the archive</h2>
              </div>
              <button
                type="button"
                className="mobile-menu-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close more navigation"
                autoFocus
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <nav className="mobile-menu-nav" aria-label="More destinations">
              {moreItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="mono">{item.index}</span>
                  <strong>{item.label}</strong>
                  <span aria-hidden="true">↗</span>
                </NavLink>
              ))}
              {isAdmin && (
                <NavLink
                  to="/admin/settings"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="mono">07</span>
                  <strong>Settings</strong>
                  <span aria-hidden="true">↗</span>
                </NavLink>
              )}
            </nav>
            <div className="mobile-menu-account">
              <div className="user-card">
                <span className="user-avatar" aria-hidden="true">
                  {auth?.user.email.charAt(0).toUpperCase() ?? "?"}
                </span>
                <span>
                  <span className="user-name">{auth?.user.email}</span>
                  <span className="user-role">{auth?.user.role ?? "listener"}</span>
                </span>
              </div>
              <button
                type="button"
                className="signout"
                onClick={() => signOutMutation.mutate()}
              >
                Sign out <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
