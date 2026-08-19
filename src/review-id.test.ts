import { describe, expect, test } from "bun:test";
import { ReviewTracker } from "./review-tracker.ts";
import { REVIEW_ID_LENGTH, shortReviewId } from "./review-id.ts";

describe("a review id", () => {
  test("is six characters a person can retype", () => {
    expect(REVIEW_ID_LENGTH).toBe(6);
    expect(shortReviewId()).toHaveLength(6);
    expect(shortReviewId()).toMatch(/^[0-9a-z]{6}$/);
  });

  test("leaves out the characters people misread", () => {
    // 20k draws is ~120k characters: any allowed letter shows up, so an absent one is absent by design.
    const seen = new Set(Array.from({ length: 20_000 }, () => shortReviewId()).join(""));
    for (const confusable of ["i", "l", "o", "u"]) expect(seen.has(confusable)).toBe(false);
  });

  test("needs no escaping in a URL", () => {
    for (let i = 0; i < 500; i++) {
      const id = shortReviewId();
      expect(encodeURIComponent(id)).toBe(id);
    }
  });

  test("does not favour any character, so the space is the full 32^6", () => {
    const counts = new Map<string, number>();
    const draws = Array.from({ length: 20_000 }, () => shortReviewId()).join("");
    for (const ch of draws) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    // A byte maps on with & 31, so no character should stray far from 1/32 of the draws.
    const expected = draws.length / 32;
    for (const count of counts.values()) expect(Math.abs(count - expected) / expected).toBeLessThan(0.15);
  });

  test("repeats rarely enough to be usable as an id", () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => shortReviewId()));
    expect(ids.size).toBeGreaterThan(19_900);
  });
});

describe("the tracker", () => {
  test("hands out short ids by default", () => {
    const { reviewId } = new ReviewTracker().track("/tmp/note.md", "v1");
    expect(reviewId).toMatch(/^[0-9a-z]{6}$/);
  });

  test("draws again when a short id repeats", () => {
    const queued = ["dup", "dup", "fresh"];
    const tracker = new ReviewTracker(() => queued.shift() ?? "exhausted");
    expect(tracker.track("/tmp/a.md", "v1").reviewId).toBe("dup");
    // The second draw collides, so the tracker takes the next one instead of overwriting.
    expect(tracker.track("/tmp/b.md", "v1").reviewId).toBe("fresh");
    expect(tracker.get("dup")?.path).toBe("/tmp/a.md");
  });

  test("still honours a generator that deliberately returns one id", () => {
    // Bounded retries: a fixed generator keeps the behaviour tests rely on rather than hanging.
    const tracker = new ReviewTracker(() => "review-1");
    expect(tracker.track("/tmp/a.md", "v1").reviewId).toBe("review-1");
    expect(tracker.track("/tmp/b.md", "v1").reviewId).toBe("review-1");
  });
});
