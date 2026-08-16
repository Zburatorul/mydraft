import { describe, expect, test } from "bun:test";
import { revisionLabel, revisionTitle } from "./revision-label.js";

const revision = { number: 12, version: "101a17314a73", createdAt: "2026-08-15T10:05:00.000Z" };

describe("revision labels", () => {
  test("shows a sortable number, creation time, and shortened content hash", () => {
    expect(revisionLabel(revision, revision.version, () => "Aug 15, 10:05 AM")).toBe("r12 · Aug 15, 10:05 AM · 101a1731");
  });

  test("keeps the full timestamp and hash available as a tooltip", () => {
    const title = revisionTitle(revision, revision.version);
    expect(title).toContain("Revision 12");
    expect(title).toContain("Content hash 101a17314a73");
  });

  test("falls back to the legacy hash when metadata is absent", () => {
    expect(revisionLabel(null, "101a17314a73")).toBe("v101a17314a73");
  });
});
