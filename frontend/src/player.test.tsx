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
  recording_key: "first",
  stream_version: "v1",
  created_at: "2026-11-08T00:00:00Z",
};

const secondTrack: Track = {
  ...track,
  id: "second",
  title: "Second Song",
  recording_key: "second",
};

let visibilityState: DocumentVisibilityState = "visible";

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

function loadedAudio(currentTime = 30): HTMLAudioElement {
  const audio = audioElement();
  Object.defineProperty(audio, "readyState", {
    configurable: true,
    value: 4,
  });
  Object.defineProperty(audio, "duration", {
    configurable: true,
    value: 180,
  });
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  return audio;
}

describe("PlayerProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
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

    const audio = loadedAudio(30);
    fireEvent.play(audio);
    fireEvent.pause(audio);

    await waitFor(() => {
      expect(screen.getByTestId("is-playing")).toHaveTextContent("false");
    });
  });

  it("ignores the pause that happens at the end of a track", async () => {
    renderPlayer();

    const audio = loadedAudio(179.9);
    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    fireEvent.pause(audio);

    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");

    fireEvent.ended(audio);

    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent(
        "Second Song",
      );
    });
    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");
  });

  it("ignores the pause fired while the next source is starting", async () => {
    renderPlayer();

    const audio = loadedAudio(30);
    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    fireEvent.ended(audio);

    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent(
        "Second Song",
      );
    });

    audio.currentTime = 0;
    fireEvent.pause(audio);

    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");
  });

  it("advances tracks while the page is in the background", async () => {
    renderPlayer();

    const audio = loadedAudio(179.9);
    fireEvent.click(screen.getByRole("button", { name: "Play track" }));
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.pause(audio);
    fireEvent.ended(audio);

    await waitFor(() => {
      expect(screen.getByTestId("current-track")).toHaveTextContent(
        "Second Song",
      );
    });
    expect(screen.getByTestId("is-playing")).toHaveTextContent("true");
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
