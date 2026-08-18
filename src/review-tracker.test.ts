import { describe, expect, test } from "bun:test";
import { ReviewTracker, type ReviewSnapshot } from "./review-tracker.ts";

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

  test("viewing a document again preserves the completed review", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);
    const first = tracker.track("/tmp/note.md", "v1");
    tracker.complete("/tmp/note.md", first.reviewId);
    const second = tracker.track("/tmp/note.md", "v2");

    expect(second).toMatchObject({ tracked: true, state: "active", currentVersion: "v2" });
    expect(tracker.status("/tmp/note.md", first.reviewId, "v1")).toMatchObject({ tracked: false, state: "completed" });
  });

  test("completing one review does not complete another review of the same document", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);
    const first = tracker.track("/tmp/note.md", "v1");
    const second = tracker.track("/tmp/note.md", "v1");

    expect(tracker.complete("/tmp/note.md", first.reviewId)).toMatchObject({ tracked: false, state: "completed" });
    expect(tracker.status("/tmp/note.md", second.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
  });

  test("keeps independent reviews for one document active in creation order", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);

    const first = tracker.track("/tmp/note.md", "v1");
    const second = tracker.track("/tmp/note.md", "v1");

    expect(tracker.status("/tmp/note.md", first.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
    expect(tracker.status("/tmp/note.md", second.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
    expect(tracker.list("active").map((review) => review.id)).toEqual([first.reviewId, second.reviewId]);
  });

  test("restores completed reviews and caller metadata from a persisted snapshot", () => {
    let snapshot: ReviewSnapshot = {};
    const first = new ReviewTracker({
      createId: () => "review-1",
      now: () => "2026-08-17T20:00:00.000Z",
      persist: (next) => { snapshot = next; },
    });

    const { reviewId } = first.track("/tmp/note.md", "v1", {
      title: "Launch plan",
      context: { project: "mydraft", agent: "codex", session: "s1", priority: 2 },
    });
    first.complete("/tmp/note.md", reviewId, "v2");

    const restored = new ReviewTracker({ initial: snapshot });
    expect(restored.get(reviewId)).toEqual({
      id: "review-1",
      number: 1,
      path: "/tmp/note.md",
      title: "Launch plan",
      status: "completed",
      currentVersion: "v2",
      createdAt: "2026-08-17T20:00:00.000Z",
      updatedAt: "2026-08-17T20:00:00.000Z",
      completedAt: "2026-08-17T20:00:00.000Z",
      archivedAt: null,
      context: { project: "mydraft", agent: "codex", session: "s1", priority: 2 },
    });
  });

  test("archives one review without hiding another active review", () => {
    let id = 0;
    const tracker = new ReviewTracker(() => `review-${++id}`);
    const first = tracker.track("/tmp/a.md", "v1");
    const second = tracker.track("/tmp/b.md", "v1");

    expect(tracker.archive(first.reviewId)).toMatchObject({ id: first.reviewId, status: "archived" });
    expect(tracker.list("active").map((review) => review.id)).toEqual([second.reviewId]);
    expect(tracker.status("/tmp/a.md", first.reviewId, "v1")).toMatchObject({ tracked: false, state: "archived" });
  });

  test("durably supersedes only an earlier review from the same explicit session", () => {
    let id = 0;
    let snapshot: ReviewSnapshot = {};
    const tracker = new ReviewTracker({
      createId: () => `review-${++id}`,
      persist: (next) => { snapshot = next; },
    });

    const first = tracker.track("/tmp/note.md", "v1", { context: { session: "codex-1" } });
    const independent = tracker.track("/tmp/note.md", "v1", { context: { session: "claude-1" } });
    const replacement = tracker.track("/tmp/note.md", "v1", { context: { session: "codex-1" } });

    expect(tracker.status("/tmp/note.md", first.reviewId, "v1")).toMatchObject({ tracked: false, state: "superseded" });
    expect(tracker.status("/tmp/note.md", independent.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
    expect(tracker.status("/tmp/note.md", replacement.reviewId, "v1")).toMatchObject({ tracked: true, state: "active" });
    expect(new ReviewTracker({ initial: snapshot }).list("superseded").map((review) => review.id)).toEqual([first.reviewId]);
  });
});
