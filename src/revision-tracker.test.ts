import { describe, expect, test } from "bun:test";
import { RevisionTracker, type RevisionSnapshot } from "./revision-tracker.ts";

describe("RevisionTracker", () => {
  test("assigns a monotonic number and creation time to each new content hash", () => {
    const tracker = new RevisionTracker();

    expect(tracker.observe("/tmp/note.md", "hash-a", "2026-08-15T10:00:00.000Z")).toEqual({
      number: 1,
      version: "hash-a",
      createdAt: "2026-08-15T10:00:00.000Z",
    });
    expect(tracker.observe("/tmp/note.md", "hash-b", "2026-08-15T10:05:00.000Z")).toEqual({
      number: 2,
      version: "hash-b",
      createdAt: "2026-08-15T10:05:00.000Z",
    });
  });

  test("deduplicates repeated filesystem events for the same content", () => {
    const tracker = new RevisionTracker();
    const first = tracker.observe("/tmp/note.md", "hash-a", "2026-08-15T10:00:00.000Z");
    const duplicate = tracker.observe("/tmp/note.md", "hash-a", "2026-08-15T10:01:00.000Z");

    expect(duplicate).toEqual(first);
    expect(duplicate.createdAt).toBe("2026-08-15T10:00:00.000Z");
  });

  test("restores its counter from a persisted snapshot", () => {
    let saved: RevisionSnapshot = {};
    const first = new RevisionTracker({}, (snapshot) => { saved = snapshot; });
    first.observe("/tmp/note.md", "hash-a", "2026-08-15T10:00:00.000Z");

    const restored = new RevisionTracker(saved);
    expect(restored.observe("/tmp/note.md", "hash-b", "2026-08-15T10:05:00.000Z").number).toBe(2);
  });

  test("keeps the two latest sources available for a visual comparison", () => {
    const tracker = new RevisionTracker();
    tracker.observe("/tmp/note.md", "hash-a", "2026-08-15T10:00:00.000Z", "before\n");
    tracker.observe("/tmp/note.md", "hash-b", "2026-08-15T10:05:00.000Z", "after\n");

    expect(tracker.previous("/tmp/note.md")?.number).toBe(1);
    expect(tracker.comparison("/tmp/note.md")).toMatchObject({
      before: { number: 1, source: "before\n" },
      after: { number: 2, source: "after\n" },
    });
  });

  test("upgrades a legacy metadata-only snapshot without advancing its counter", () => {
    const tracker = new RevisionTracker({
      "/tmp/note.md": { number: 4, version: "hash-a", createdAt: "2026-08-15T10:00:00.000Z" },
    });

    expect(tracker.observe("/tmp/note.md", "hash-a", "2026-08-15T10:01:00.000Z", "captured\n").number).toBe(4);
    expect(tracker.observe("/tmp/note.md", "hash-b", "2026-08-15T10:05:00.000Z", "next\n").number).toBe(5);
    expect(tracker.comparison("/tmp/note.md")?.before.source).toBe("captured\n");
  });

  test("maintains independent counters for different documents", () => {
    const tracker = new RevisionTracker();
    tracker.observe("/tmp/a.md", "hash-a");
    tracker.observe("/tmp/a.md", "hash-b");

    expect(tracker.observe("/tmp/b.md", "hash-a").number).toBe(1);
  });
});
