import { describe, expect, it } from "vitest";

import type { PlayerTrack } from "./playerState";
import {
  MAX_RECOMMENDATION_HISTORY,
  MAX_RECOMMENDATION_REJECTIONS,
  MAX_RECOMMENDATION_SEEDS,
  addRecommendationHistoryEntry,
  addRecommendationRejection,
  cleanRecommendationMetadata,
  createRecommendationHistoryEntry,
  recommendationKey,
  removeRecommendationHistoryTrack,
  replaceRecommendationHistoryTrack,
  selectRecommendationSeeds,
  shouldRejectSkippedTrack,
  updateRecommendationProgress,
  type RecommendationHistoryEntry,
  type RecommendationSeed,
} from "./recommendationSession";

function track(
  id: string,
  title: string,
  duration_seconds = 200,
  artist_name = "Test Artist",
): PlayerTrack {
  return {
    id,
    title,
    artist_name,
    album_title: null,
    release_year: null,
    duration_seconds,
    mime_type: "audio/mpeg",
    source_type: "upload",
    is_available: true,
    created_at: "2026-11-08T00:00:00Z",
  };
}

function entry(
  value: PlayerTrack,
  progressSeconds: number,
  durationSeconds = value.duration_seconds,
): RecommendationHistoryEntry {
  return createRecommendationHistoryEntry(
    value,
    0,
    progressSeconds,
    durationSeconds,
  );
}

describe("recommendation history", () => {
  it("adds unique tracks and ignores duplicates", () => {
    const first = track("first", "First");
    let history: RecommendationHistoryEntry[] = [];
    history = addRecommendationHistoryEntry(
      history,
      createRecommendationHistoryEntry(first, 0),
    );
    history = addRecommendationHistoryEntry(
      history,
      createRecommendationHistoryEntry(first, 1),
    );

    expect(history).toHaveLength(1);
    expect(history[0].track.id).toBe("first");
  });

  it("keeps only the most recent unique tracks", () => {
    let history: RecommendationHistoryEntry[] = [];
    for (let index = 0; index < MAX_RECOMMENDATION_HISTORY + 2; index += 1) {
      history = addRecommendationHistoryEntry(
        history,
        createRecommendationHistoryEntry(
          track(`track-${index}`, `Track ${index}`),
          index,
        ),
      );
    }

    expect(history).toHaveLength(MAX_RECOMMENDATION_HISTORY);
    expect(history[0].track.id).toBe("track-2");
    expect(history[history.length - 1].track.id).toBe(
      `track-${MAX_RECOMMENDATION_HISTORY + 1}`,
    );
  });

  it("keeps the highest playback progress for the active track", () => {
    const first = track("first", "First");
    let history = [
      createRecommendationHistoryEntry(first, 0, 30, first.duration_seconds),
    ];

    history = updateRecommendationProgress(history, "first", 80, 200);
    history = updateRecommendationProgress(history, "first", 40, 200);

    expect(history[0].progressSeconds).toBe(80);
    expect(history[0].durationSeconds).toBe(200);
  });

  it("removes a failed recommendation from history", () => {
    const first = track("first", "First");
    const second = track("second", "Second");
    const history = [
      createRecommendationHistoryEntry(first, 0),
      createRecommendationHistoryEntry(second, 1),
    ];

    const next = removeRecommendationHistoryTrack(history, "second");

    expect(next).toHaveLength(1);
    expect(next[0].track.id).toBe("first");
  });

  it("replaces a pending import with the resolved track", () => {
    const pending = { ...track("pending", "Pending"), pending: true };
    const resolved = track("resolved", "Resolved", 240);
    const history = [createRecommendationHistoryEntry(pending, 0)];

    const next = replaceRecommendationHistoryTrack(
      history,
      "pending",
      resolved,
    );

    expect(next).toHaveLength(1);
    expect(next[0].track.id).toBe("resolved");
    expect(next[0].durationSeconds).toBe(240);
  });
});

describe("recommendation seed selection", () => {
  const original = { title: "Original Song", artist: "Original Artist" };

  it("uses every track above the completion threshold", () => {
    const history = [
      entry(track("song-1", "Song 1"), 200),
      entry(track("recommendation-1", "Recommendation 1"), 200),
      entry(track("recommendation-2", "Recommendation 2"), 20),
      entry(track("recommendation-3", "Recommendation 3"), 70),
      entry(track("recommendation-4", "Recommendation 4"), 40),
    ];

    expect(selectRecommendationSeeds(history, original)).toEqual([
      { title: "Song 1", artist: "Test Artist" },
      { title: "Recommendation 1", artist: "Test Artist" },
    ]);
  });

  it("uses only the ten most recent listened tracks as seeds", () => {
    const history = Array.from(
      { length: MAX_RECOMMENDATION_SEEDS + 2 },
      (_, index) => entry(track(`track-${index}`, `Track ${index}`), 200),
    );

    expect(selectRecommendationSeeds(history, original)).toEqual(
      history.slice(-MAX_RECOMMENDATION_SEEDS).map((item) => ({
        title: item.track.title,
        artist: item.track.artist_name,
      })),
    );
  });

  it("keeps ten listened seeds after many skipped tracks", () => {
    let history: RecommendationHistoryEntry[] = [];
    for (let index = 0; index < MAX_RECOMMENDATION_SEEDS; index += 1) {
      history = addRecommendationHistoryEntry(
        history,
        entry(track(`listened-${index}`, `Listened ${index}`), 200),
      );
    }
    for (
      let index = 0;
      index < MAX_RECOMMENDATION_HISTORY - MAX_RECOMMENDATION_SEEDS;
      index += 1
    ) {
      history = addRecommendationHistoryEntry(
        history,
        entry(track(`skipped-${index}`, `Skipped ${index}`), 10),
      );
    }

    expect(history).toHaveLength(MAX_RECOMMENDATION_HISTORY);
    expect(selectRecommendationSeeds(history, original)).toEqual(
      Array.from({ length: MAX_RECOMMENDATION_SEEDS }, (_, index) => ({
        title: `Listened ${index}`,
        artist: "Test Artist",
      })),
    );
  });

  it("excludes tracks played for exactly fifty percent", () => {
    const history = [entry(track("song-1", "Song 1"), 100)];

    expect(selectRecommendationSeeds(history, original)).toEqual([original]);
  });

  it("falls back to the original song when nothing qualifies", () => {
    const history = [
      entry(track("song-1", "Song 1"), 10),
      entry(track("song-2", "Song 2"), 40),
    ];

    expect(selectRecommendationSeeds(history, original)).toEqual([original]);
  });

  it("keeps the original fallback after it leaves the history", () => {
    let history: RecommendationHistoryEntry[] = [];
    for (let index = 0; index < MAX_RECOMMENDATION_HISTORY; index += 1) {
      history = addRecommendationHistoryEntry(
        history,
        entry(track(`track-${index}`, `Track ${index}`), 0),
      );
    }

    expect(history.some((item) => item.track.id === "original")).toBe(false);
    expect(selectRecommendationSeeds(history, original)).toEqual([original]);
  });

  it("does not use pending tracks as seeds", () => {
    const pending = { ...track("pending", "Pending"), pending: true };
    const history = [entry(pending, 200)];

    expect(selectRecommendationSeeds(history, original)).toEqual([original]);
  });

  it("deduplicates seeds with the same metadata", () => {
    const history = [
      entry(track("first", "Same Song", 200, "Same Artist"), 200),
      entry(track("second", "same song", 200, "same artist"), 200),
    ];

    expect(selectRecommendationSeeds(history, original)).toEqual([
      { title: "same song", artist: "same artist" },
    ]);
  });

  it("includes the currently playing track once it passes the threshold", () => {
    const current = track("current", "Current Song");
    let history = [createRecommendationHistoryEntry(current, 0)];
    history = updateRecommendationProgress(history, "current", 90, 200);

    expect(selectRecommendationSeeds(history, original)).toEqual([original]);
    expect(selectRecommendationSeeds(history, original)).not.toContainEqual({
      title: "Current Song",
      artist: "Test Artist",
    });

    history = updateRecommendationProgress(history, "current", 120, 200);

    expect(selectRecommendationSeeds(history, original)).toEqual([
      { title: "Current Song", artist: "Test Artist" },
    ]);
  });
});

describe("recommendation rejections", () => {
  it("cleans artist prefixes and video suffixes before building a key", () => {
    expect(
      cleanRecommendationMetadata(
        "Artist",
        "Artist - Rejected Song (Official Video)",
      ),
    ).toEqual({ title: "Rejected Song", artist: "Artist" });
    expect(
      recommendationKey(
        "Rejected Song",
        "Artist",
      ),
    ).toBe(
      recommendationKey(
        "Artist - Rejected Song (Official Video)",
        "Artist",
      ),
    );
  });

  it("matches metadata case and diacritics insensitively", () => {
    expect(recommendationKey("Café", "Beyoncé")).toBe(
      recommendationKey("cafe", "beyonce"),
    );
  });

  it("stores the newest rejection first and removes duplicates", () => {
    const first = addRecommendationRejection([], {
      title: "Song One",
      artist: "Artist",
    });
    const second = addRecommendationRejection(first, {
      title: "Song Two",
      artist: "Artist",
    });
    const repeated = addRecommendationRejection(second, {
      title: "Song One (Official Video)",
      artist: "Artist",
    });

    expect(repeated).toEqual([
      { title: "Song One", artist: "Artist" },
      { title: "Song Two", artist: "Artist" },
    ]);
  });

  it("rejects tracks listened to for fifty percent or less", () => {
    const current = track("current", "Current Song");
    let history = [entry(current, 80)];
    expect(shouldRejectSkippedTrack(current, history)).toBe(true);

    history = updateRecommendationProgress(history, "current", 100, 200);
    expect(shouldRejectSkippedTrack(current, history)).toBe(true);

    history = updateRecommendationProgress(history, "current", 101, 200);
    expect(shouldRejectSkippedTrack(current, history)).toBe(false);
  });

  it("rejects a track that was never tracked in the listening history", () => {
    expect(shouldRejectSkippedTrack(track("unknown", "Unknown"), [])).toBe(
      true,
    );
  });

  it("caps the rejection list", () => {
    let rejections: RecommendationSeed[] = [];
    for (let index = 0; index < MAX_RECOMMENDATION_REJECTIONS + 5; index += 1) {
      rejections = addRecommendationRejection(rejections, {
        title: `Rejected ${index}`,
        artist: "Artist",
      });
    }

    expect(rejections).toHaveLength(MAX_RECOMMENDATION_REJECTIONS);
    expect(rejections[0].title).toBe(
      `Rejected ${MAX_RECOMMENDATION_REJECTIONS + 4}`,
    );
  });
});
