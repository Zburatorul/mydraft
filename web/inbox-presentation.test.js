import { describe, expect, test } from "bun:test";
import { callerLabel, emptyMessage, pendingLabel, relativeAge, rowPresentation } from "./inbox-presentation.js";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const row = (over = {}) => ({
  id: "r1", number: 1, title: "plan.md", status: "active", agent: null, session: null,
  project: null, priority: null, createdAt: ago(0), updatedAt: ago(0), completedAt: null,
  revision: 3, unresolved: { comments: 0, suggestions: 0 }, readable: true, ...over,
});

describe("relativeAge", () => {
  test.each([
    [0, "just now"],
    [59_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 3600_000, "3h ago"],
    [4 * 86400_000, "4d ago"],
    [90 * 86400_000, "3mo ago"],
  ])("renders %ims as %s", (offset, expected) => {
    expect(relativeAge(ago(offset), NOW)).toBe(expected);
  });

  test("says nothing rather than NaN when a timestamp is unusable", () => {
    expect(relativeAge("not a date", NOW)).toBe("");
  });

  // Clock skew between the agent's machine and the reviewer's browser must not print "-2m ago".
  test("clamps a future timestamp to the present", () => {
    expect(relativeAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe("just now");
  });
});

describe("pendingLabel", () => {
  test("names both kinds when both are open", () => {
    expect(pendingLabel({ comments: 2, suggestions: 1 })).toBe("2 comments · 1 suggestion");
  });

  test("singularises a lone item", () => {
    expect(pendingLabel({ comments: 1, suggestions: 0 })).toBe("1 comment");
  });

  test("stays silent when nothing is open, so a clean review shows no badge", () => {
    expect(pendingLabel({ comments: 0, suggestions: 0 })).toBe("");
    expect(pendingLabel(null)).toBe("");
  });
});

describe("callerLabel", () => {
  test("prefers the agent name", () => {
    expect(callerLabel(row({ agent: "codex", session: "s1" }))).toBe("codex");
  });

  test("falls back to the session so session-only callers are still distinguishable", () => {
    expect(callerLabel(row({ agent: null, session: "MYD_SESSION:abc" }))).toBe("MYD_SESSION:abc");
  });

  test("is empty when the caller supplied no identity", () => {
    expect(callerLabel(row())).toBe("");
  });
});

describe("rowPresentation", () => {
  test("labels an active review and links to its opaque route", () => {
    const view = rowPresentation(row({ id: "abc def", updatedAt: ago(3600_000) }), NOW);
    expect(view).toMatchObject({
      statusLabel: "awaiting review", tone: "active", age: "1h ago",
      revisionLabel: "r3", href: "/review/abc%20def", canArchive: true, openable: true,
    });
  });

  test("marks a completed review as finished but still archivable", () => {
    const view = rowPresentation(row({ status: "completed" }), NOW);
    expect(view).toMatchObject({ statusLabel: "completed", tone: "completed", canArchive: true });
  });

  test("offers no archive action on an already archived review", () => {
    expect(rowPresentation(row({ status: "archived" }), NOW).canArchive).toBeFalse();
  });

  // A review whose document vanished must say so plainly rather than show a stale count.
  test("an unreadable document outranks the lifecycle label and cannot be opened", () => {
    const view = rowPresentation(row({ readable: false, unresolved: null, revision: null }), NOW);
    expect(view).toMatchObject({ statusLabel: "document missing", tone: "warn", openable: false, pending: "", revisionLabel: "" });
  });

  test("surfaces open work as a phrase the reviewer can scan", () => {
    expect(rowPresentation(row({ unresolved: { comments: 1, suggestions: 2 } }), NOW).pending).toBe("1 comment · 2 suggestions");
  });
});

describe("emptyMessage", () => {
  test("onboards on a genuinely empty registry", () => {
    expect(emptyMessage(false)).toContain("myd view");
  });

  test("points at the hidden reviews when the filter is what emptied the list", () => {
    expect(emptyMessage(true)).toContain("show all");
  });
});
