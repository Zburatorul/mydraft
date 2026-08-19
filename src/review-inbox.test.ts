import { describe, expect, test } from "bun:test";
import { inboxRow, isDefaultVisible, sortInbox, unresolvedCounts, type InboxRow } from "./review-inbox.ts";
import type { ReviewItem } from "./doc.ts";
import type { ReviewLifecycleState, ReviewRecord } from "./review-tracker.ts";

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: "c1", kind: "comment", parentId: null, author: "user", createdAt: null,
  status: null, text: "t", offset: 0, ...over,
} as ReviewItem);

const record = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: "r1", number: 1, path: "/tmp/a.md", title: "a.md", status: "active",
  currentVersion: "v1", createdAt: "2026-08-18T10:00:00.000Z", updatedAt: "2026-08-18T10:00:00.000Z",
  completedAt: null, archivedAt: null, context: {}, ...over,
});

describe("unresolvedCounts", () => {
  test("counts open comments and suggestions separately", () => {
    expect(unresolvedCounts([
      item({ id: "c1", kind: "comment" }),
      item({ id: "s1", kind: "suggestion" }),
      item({ id: "s2", kind: "suggestion" }),
    ])).toEqual({ comments: 1, suggestions: 2 });
  });

  test("ignores resolved items and replies, which ride on their parent", () => {
    expect(unresolvedCounts([
      item({ id: "c1", kind: "comment", status: "resolved" }),
      item({ id: "s1", kind: "suggestion", status: "resolved" }),
      item({ id: "r1", kind: "reply", parentId: "c1" }),
      item({ id: "c2", kind: "comment" }),
    ])).toEqual({ comments: 1, suggestions: 0 });
  });

  test("a document nobody has annotated reports zero rather than nothing", () => {
    expect(unresolvedCounts([])).toEqual({ comments: 0, suggestions: 0 });
  });
});

describe("inboxRow", () => {
  test("carries the caller's context so a reviewer can tell the agents apart", () => {
    const row = inboxRow(
      record({ title: "Launch plan", context: { project: "mydraft", agent: "codex", session: "s1", priority: 2 } }),
      { revision: 4, items: [item({ id: "c1" })] },
    );
    expect(row).toMatchObject({
      id: "r1", title: "Launch plan", status: "active",
      project: "mydraft", agent: "codex", session: "s1", priority: 2,
      revision: 4, unresolved: { comments: 1, suggestions: 0 }, readable: true,
    });
  });

  test("context the caller never supplied reads as absent, not as an empty string", () => {
    const row = inboxRow(record(), { revision: 1, items: [] });
    expect(row).toMatchObject({ agent: null, session: null, project: null, priority: null });
  });

  // A review whose document was moved or deleted must still be visible: losing it silently
  // would strand the reviewer with no way to see that the work went stale.
  test("keeps a review whose document is unreadable, flagged rather than dropped", () => {
    const row = inboxRow(record(), null);
    expect(row).toMatchObject({ id: "r1", readable: false, unresolved: null, revision: null });
  });
});

describe("sortInbox", () => {
  const row = (id: string, status: ReviewLifecycleState, updatedAt: string, number = 1): InboxRow =>
    inboxRow(record({ id, number, status, updatedAt }), { revision: 1, items: [] });

  test("puts live work above finished work", () => {
    const sorted = sortInbox([
      row("done", "completed", "2026-08-18T12:00:00.000Z"),
      row("live", "active", "2026-08-18T09:00:00.000Z"),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["live", "done"]);
  });

  test("orders within a status by most recent activity", () => {
    const sorted = sortInbox([
      row("old", "active", "2026-08-18T09:00:00.000Z"),
      row("new", "active", "2026-08-18T11:00:00.000Z"),
      row("mid", "active", "2026-08-18T10:00:00.000Z"),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["new", "mid", "old"]);
  });

  test("breaks a tie on review number so the order never wobbles between requests", () => {
    const at = "2026-08-18T10:00:00.000Z";
    const sorted = sortInbox([row("first", "active", at, 1), row("second", "active", at, 2)]);
    expect(sorted.map((r) => r.id)).toEqual(["second", "first"]);
  });

  test("sinks superseded and archived below everything else", () => {
    const sorted = sortInbox([
      row("archived", "archived", "2026-08-18T13:00:00.000Z"),
      row("superseded", "superseded", "2026-08-18T12:00:00.000Z"),
      row("completed", "completed", "2026-08-18T09:00:00.000Z"),
      row("active", "active", "2026-08-18T08:00:00.000Z"),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["active", "completed", "superseded", "archived"]);
  });

  test("does not mutate the caller's array", () => {
    const rows = [row("b", "completed", "2026-08-18T09:00:00.000Z"), row("a", "active", "2026-08-18T08:00:00.000Z")];
    sortInbox(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("isDefaultVisible", () => {
  test("shows active and completed work, hiding what the reviewer cannot act on", () => {
    expect(["active", "completed"].map(isDefaultVisible as any)).toEqual([true, true]);
    expect(["superseded", "archived"].map(isDefaultVisible as any)).toEqual([false, false]);
  });
});
