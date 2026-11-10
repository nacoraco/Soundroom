import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerProvider, usePlayer } from "./player";
import type { Track } from "./types";

const track: Track = {
  id: "first",
  title: "First Song",
  artist_name: "Test Artist",
  album_title: null,
  release_year: null,
  duration_seconds: 180,
  mime_type: "audio/mpeg",
  source_type: "upload",
  is_available: true,
  created_at: "2026-11-08T00:00:00Z",
};

const secondTrack: Track = {
  ...track,
  id: "second",
  title: "Second Song",
};

function LibraryRoute() {
  const { playTrack } = usePlayer();
  return (
    <>
      <button
        type="button"
        onClick={() => playTrack(track, [track, secondTrack])}
      >
        Play track
      </button>
      <Link to="/other">Go to other page</Link>
    </>
  );
}

function OtherRoute() {
  const { currentTrack, state } = usePlayer();
  return (
    <>
      <span data-testid="now-playing">{currentTrack?.title ?? "none"}</span>
      <span data-testid="playing">{String(state.isPlaying)}</span>
      <span data-testid="playback-error">{state.error ?? ""}</span>
    </>
  );
}

function PlayerProbe() {
  const { currentTrack, state } = usePlayer();
  return (
    <>
      <span data-testid="current-track">{currentTrack?.title ?? "none"}</span>
      <span data-testid="is-playing">{String(state.isPlaying)}</span>
      <span data-testid="player-error">{state.error ?? ""}</span>
    </>
  );
}

function renderPlayer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <MemoryRouter initialEntries={["/library"]}>
          <Routes>
            <Route path="/library" element={<LibraryRoute />} />
            <Route path="/other" element={<OtherRoute />} />
          </Routes>
          <PlayerProbe />
        </MemoryRouter>
      </PlayerProvider>
    </QueryClientProvider>,
  );
}

function audioElement(): HTMLAudioElement {
  const audio = document.querySelector("audio");
  if (!audio) {
    throw new Error("Audio element not found");
  }
  return audio;
}

describe("PlayerProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps playing the current track while routes change", () => {
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    fireEvent.click(
      screen.getByRole("link", { name: "Go to other page" }),
    );

    expect(screen.getByTestId("now-playing")).toHaveTextContent("First Song");
  });

  it("advances to the next track when the audio ends", async () => {
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    fireEvent.ended(audioElement());

    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent(
        "Second Song",
      );
    });
  });

  it("reflects pauses that happen outside the app", async () => {
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");

    const audio = audioElement();
    fireEvent.play(audio);
    fireEvent.pause(audio);

    await waitFor(() => {
      expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
    });
  });

  it("shows a paused state when the browser blocks playback", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException("Autoplay blocked", "NotAllowedError"),
    );
    renderPlayer();

    fireEvent.click(screen.getByRole("button", { name: "Play track" }));

    await waitFor(() => {
      expect(screen.getByTestId("player-error")).toHaveTextContent(
        "Playback was paused by the browser. Tap play to resume.",
      );
    });
    expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
  });
});
