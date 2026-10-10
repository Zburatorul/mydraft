import { describe, expect, test } from "bun:test";
import { ReviewHistory, type ReviewHistorySnapshot } from "./review-history.ts";

describe("ReviewHistory", () => {
  test("freezes a completed review and builds a linked review-relative change set after restart", () => {
    let saved: ReviewHistorySnapshot = { archives: {}, predecessors: {} };
    const history = new ReviewHistory({ persist: (snapshot) => { saved = snapshot; } });
    history.complete({
      reviewId: "review-old",
      path: "/docs/plan.md",
      title: "plan.md",
      version: "version-old",
      source: "# Plan {#plan}\n\nOld decision.\n",
      completedAt: "2026-09-23T18:00:00.000Z",
      revision: { number: 4, version: "version-old", createdAt: "2026-09-23T17:00:00.000Z" },
    });
    history.link({ reviewId: "review-new", predecessorReviewId: "review-old", path: "/docs/plan.md" });

    const restored = new ReviewHistory({ initial: saved });
    expect(restored.archive("review-old")).toMatchObject({
      reviewId: "review-old",
      source: "# Plan {#plan}\n\nOld decision.\n",
      revision: { number: 4 },
    });
    expect(restored.predecessor("review-new")).toBe("review-old");
    expect(restored.comparison("review-new", "# Plan {#plan}\n\nImproved decision.\n")).toMatchObject({
      predecessorReviewId: "review-old",
      before: { version: "version-old", revision: { number: 4 } },
      changeSet: {
        changes: [expect.objectContaining({ kind: "modified", summary: "Improved decision." })],
      },
    });
  });

  test("refuses to link reviews of different documents", () => {
    const history = new ReviewHistory();
    history.complete({
      reviewId: "review-old",
      path: "/docs/one.md",
      title: "one.md",
      version: "version-old",
      source: "# One\n",
      completedAt: "2026-09-23T18:00:00.000Z",
      revision: null,
    });

    expect(() => history.link({ reviewId: "review-new", predecessorReviewId: "review-old", path: "/docs/two.md" }))
      .toThrow("Predecessor review belongs to a different document.");
  });

  test("a completed snapshot is immutable and exact retries are idempotent", () => {
    let saves = 0;
    const history = new ReviewHistory({ persist: () => { saves += 1; } });
    const archive = {
      reviewId: "review-old",
      path: "/docs/plan.md",
      title: "plan.md",
      version: "version-old",
      source: "# Frozen\n",
      completedAt: "2026-09-23T18:00:00.000Z",
      revision: null,
    };
    history.complete(archive);
    history.complete({ ...archive, completedAt: "2026-09-23T18:00:01.000Z" });

    expect(saves).toBe(1);
    expect(() => history.complete({ ...archive, source: "# Replaced\n" })).toThrow("already frozen");
    expect(history.archive("review-old")?.source).toBe("# Frozen\n");
  });

  test("a failed persistence attempt leaves an exact retry able to persist", () => {
    let attempts = 0;
    const saved: ReviewHistorySnapshot[] = [];
    const history = new ReviewHistory({ persist: (snapshot) => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk unavailable");
      saved.push(snapshot);
    } });
    const archive = {
      reviewId: "review-old",
      path: "/docs/plan.md",
      title: "plan.md",
      version: "version-old",
      source: "# Frozen\n",
      completedAt: "2026-09-23T18:00:00.000Z",
      revision: null,
    };

    expect(() => history.complete(archive)).toThrow("disk unavailable");
    history.complete({ ...archive, completedAt: "2026-09-23T18:00:01.000Z" });

    expect(attempts).toBe(2);
    expect(saved[0]?.archives[archive.reviewId]?.source).toBe("# Frozen\n");
  });
});
