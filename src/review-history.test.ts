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
});
