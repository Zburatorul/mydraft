import { describe, expect, test } from "bun:test";
import { ReviewTracker } from "./review-tracker.ts";

describe("ReviewTracker", () => {
  test("reports documents the backend has never tracked as unknown", () => {
    expect(new ReviewTracker().status("/tmp/note.md", "review-1", "v1")).toMatchObject({
      tracked: false,
      state: "unknown",
      requestedVersion: "v1",
      currentVersion: null,
    });
  });

  test("tracks one current version and supersedes older tabs", () => {
    const tracker = new ReviewTracker(() => "review-1");
    const { reviewId } = tracker.track("/tmp/note.md", "v1");
    expect(tracker.status("/tmp/note.md", reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });

    tracker.advance("/tmp/note.md", "v2");
    expect(tracker.status("/tmp/note.md", reviewId, "v1")).toMatchObject({
      tracked: false,
      state: "superseded",
      currentVersion: "v2",
    });
    expect(tracker.status("/tmp/note.md", reviewId, "v2")).toMatchObject({ tracked: true, state: "active" });
  });

  test("does not revive a completed review when a late file event arrives", () => {
    const tracker = new ReviewTracker(() => "review-1");
    const { reviewId } = tracker.track("/tmp/note.md", "v1");
    tracker.complete("/tmp/note.md", reviewId, "v2");
    tracker.advance("/tmp/note.md", "v3");

    expect(tracker.status("/tmp/note.md", reviewId, "v2")).toMatchObject({
      tracked: false,
      state: "completed",
      currentVersion: "v2",
    });
  });

  test("viewing a document again starts a fresh review", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);
    const first = tracker.track("/tmp/note.md", "v1");
    tracker.complete("/tmp/note.md", first.reviewId);
    const second = tracker.track("/tmp/note.md", "v2");

    expect(second).toMatchObject({ tracked: true, state: "active", currentVersion: "v2" });
    expect(tracker.status("/tmp/note.md", first.reviewId, "v1")).toMatchObject({ tracked: false, state: "superseded" });
  });

  test("a stale tab cannot complete the newer review", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);
    const first = tracker.track("/tmp/note.md", "v1");
    const second = tracker.track("/tmp/note.md", "v1");

    expect(tracker.complete("/tmp/note.md", first.reviewId)).toMatchObject({ tracked: false, state: "superseded" });
    expect(tracker.status("/tmp/note.md", second.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
  });
});
