import { describe, expect, it } from "vitest";

import { initialPlayerState, playerReducer } from "./playerState";
import { recommendationKey } from "./recommendationSession";
import type { Track } from "./types";

function track(
  id: string,
  title: string,
  duration_seconds = 180,
): Track {
  return {
    id,
    title,
    artist_name: "Test Artist",
    album_title: null,
    release_year: null,
    duration_seconds,
    mime_type: "audio/mpeg",
    source_type: "upload",
    is_available: true,
    recording_key: recommendationKey(title, "Test Artist"),
    created_at: "2026-11-08T00:00:00Z",
  };
}

const first = track("first", "First Song");
const second = track("second", "Second Song");

describe("playerReducer", () => {
  it("starts a track and its visible list as the queue", () => {
    const state = playerReducer(initialPlayerState, {
      type: "play",
      track: second,
      queue: [first, second],
    });

    expect(state.queue).toEqual([first, second]);
    expect(state.currentIndex).toBe(1);
    expect(state.isPlaying).toBe(true);
    expect(state.currentTime).toBe(0);
    expect(state.duration).toBe(180);
    expect(state.playToken).toBe(1);
  });

  it("adds tracks once and keeps the queue order", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
    });
    const queued = playerReducer(playing, { type: "enqueue", track: second });
    const duplicate = playerReducer(queued, { type: "enqueue", track: second });

    expect(queued.queue.map((item) => item.id)).toEqual(["first", "second"]);
    expect(queued.currentIndex).toBe(0);
    expect(duplicate).toBe(queued);
  });

  it("does not append auto recommendations that duplicate a queued variant", () => {
    const existing = track(
      "existing",
      'Test Artist - Drunk Text Me (Lyrics) | "quote"',
    );
    const duplicate = track(
      "duplicate",
      "Test Artist - Drunk Text Me (Official Music Video)",
    );
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: existing,
    });
    const appended = playerReducer(playing, {
      type: "appendAuto",
      tracks: [duplicate],
    });

    expect(appended).toBe(playing);
    expect(appended.queue.map((item) => item.id)).toEqual(["existing"]);
  });

  it("removes upcoming auto variants of the current track", () => {
    const current = {
      ...track("current", "Semi-Charmed Life (2006 Remaster)"),
      artist_name: "thirdeyeblind",
      recording_key: recommendationKey(
        "Semi-Charmed Life (2006 Remaster)",
        "thirdeyeblind",
      ),
      origin: "auto" as const,
    };
    const duplicate = {
      ...track("duplicate", "Semi-Charmed Life (2006 Remaster)"),
      artist_name: "thirdeyeblind",
      recording_key: recommendationKey(
        "Semi-Charmed Life (2006 Remaster)",
        "thirdeyeblind",
      ),
      origin: "auto" as const,
    };
    const variant = {
      ...track(
        "variant",
        "Third Eye Blind - Semi-Charmed Life / Lyrics",
      ),
      artist_name: "Third Eye Blind",
      recording_key: recommendationKey(
        "Third Eye Blind - Semi-Charmed Life / Lyrics",
        "Third Eye Blind",
      ),
      origin: "auto" as const,
    };
    const fresh = {
      ...track("fresh", "No Rain (Remastered 2002)"),
      artist_name: "Blind Melon",
      origin: "auto" as const,
    };
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: current,
      queue: [current, duplicate, variant, fresh],
    });
    const deduped = playerReducer(playing, { type: "dedupeAuto" });

    expect(deduped.queue.map((item) => item.id)).toEqual([
      "current",
      "fresh",
    ]);
  });

  it("moves to the next and previous track", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
      queue: [first, second],
    });
    const next = playerReducer(playing, { type: "next" });
    const previous = playerReducer(next, { type: "previous" });

    expect(next.currentIndex).toBe(1);
    expect(next.queue[next.currentIndex].id).toBe("second");
    expect(previous.currentIndex).toBe(0);
    expect(previous.queue[previous.currentIndex].id).toBe("first");
  });

  it("removes the current track and continues with the next one", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
      queue: [first, second],
    });
    const removed = playerReducer(playing, { type: "remove", index: 0 });

    expect(removed.queue).toEqual([second]);
    expect(removed.currentIndex).toBe(0);
    expect(removed.isPlaying).toBe(true);
    expect(removed.queue[removed.currentIndex].id).toBe("second");
  });

  it("clamps seeking to the track duration", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
    });
    const sought = playerReducer(playing, { type: "seek", time: 999 });

    expect(sought.currentTime).toBe(180);
  });

  it("stops at the end of the last track", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: second,
      queue: [first, second],
    });
    const ended = playerReducer(playing, { type: "ended" });

    expect(ended.isPlaying).toBe(false);
    expect(ended.currentTime).toBe(180);
  });

  it("stops playback when the audio reports an error", () => {
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
    });
    const failed = playerReducer(playing, {
      type: "error",
      error: "Unavailable",
    });

    expect(failed.isPlaying).toBe(false);
    expect(failed.error).toBe("Unavailable");
  });

  it("clears the queue but keeps volume preferences", () => {
    const adjusted = playerReducer(initialPlayerState, {
      type: "volume",
      volume: 0.4,
    });
    const muted = playerReducer(adjusted, { type: "muted", muted: true });
    const playing = playerReducer(muted, {
      type: "play",
      track: first,
    });
    const cleared = playerReducer(playing, { type: "clear" });

    expect(cleared.queue).toEqual([]);
    expect(cleared.currentIndex).toBe(-1);
    expect(cleared.volume).toBe(0.4);
    expect(cleared.muted).toBe(true);
  });

  it("waits on a pending import and starts the resolved track", () => {
    const pending = {
      ...track("pending", "Incoming Song", 240),
      pending: true,
      thumbnail_url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    };
    const started = playerReducer(initialPlayerState, {
      type: "beginImport",
      track: pending,
    });

    expect(started.expanded).toBe(true);
    expect(started.isPlaying).toBe(false);
    expect(started.queue[0].pending).toBe(true);
    expect(playerReducer(started, { type: "toggle" })).toBe(started);

    const withJob = playerReducer(started, {
      type: "importJob",
      jobId: "job-1",
      status: "downloading",
    });
    const completed = playerReducer(withJob, {
      type: "importCompleted",
      track: first,
    });

    expect(completed.queue[0]).toEqual(first);
    expect(completed.isPlaying).toBe(true);
    expect(completed.playToken).toBeGreaterThan(withJob.playToken);
    expect(completed.importStatus).toBe("completed");
  });

  it("keeps manual additions ahead of auto recommendations in their own order", () => {
    const autoA = { ...track("auto-a", "Auto A"), origin: "auto" as const };
    const autoB = { ...track("auto-b", "Auto B"), origin: "auto" as const };
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
    });
    const withAuto = playerReducer(playing, {
      type: "appendAuto",
      tracks: [autoA, autoB],
    });
    const firstManual = playerReducer(withAuto, {
      type: "enqueue",
      track: second,
    });
    const secondManual = playerReducer(firstManual, {
      type: "enqueue",
      track: track("third", "Third Song"),
    });

    expect(secondManual.queue.map((item) => item.id)).toEqual([
      "first",
      "second",
      "third",
      "auto-a",
      "auto-b",
    ]);
    expect(
      secondManual.queue.filter((item) => item.origin === "auto"),
    ).toHaveLength(2);
  });

  it("replaces pending auto tracks when they finish downloading", () => {
    const pending = {
      ...track("pending-auto", "Pending Auto", 0),
      pending: true,
      origin: "auto" as const,
      pending_status: "downloading" as const,
    };
    const playing = playerReducer(initialPlayerState, {
      type: "play",
      track: first,
    });
    const withPending = playerReducer(playing, {
      type: "appendAuto",
      tracks: [pending],
    });
    const current = playerReducer(withPending, { type: "next" });
    const resolved = playerReducer(current, {
      type: "replacePending",
      pendingId: "pending-auto",
      track: second,
    });

    expect(current.isPlaying).toBe(true);
    expect(current.queue[current.currentIndex].pending).toBe(true);
    expect(resolved.queue[resolved.currentIndex].id).toBe("second");
    expect(resolved.isPlaying).toBe(true);
    expect(resolved.playToken).toBeGreaterThan(current.playToken);
  });
});
