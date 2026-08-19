import { describe, expect, test } from "bun:test";
import { pathParam } from "./url-path.ts";
import { pathViewerUrl } from "./viewer-url.ts";

describe("a path in a URL query", () => {
  test("keeps its separators instead of becoming %2F noise", () => {
    expect(pathParam("/home/eugeniu/plans/roadmap.md")).toBe("/home/eugeniu/plans/roadmap.md");
    expect(pathViewerUrl(7474, "/home/eugeniu/plans/roadmap.md"))
      .toBe("http://localhost:7474/?path=/home/eugeniu/plans/roadmap.md");
  });

  test("still encodes what would otherwise break the query", () => {
    expect(pathParam("/tmp/a?b.md")).toBe("/tmp/a%3Fb.md");
    expect(pathParam("/tmp/a#b.md")).toBe("/tmp/a%23b.md");
    expect(pathParam("/tmp/a&b.md")).toBe("/tmp/a%26b.md");
    expect(pathParam("/tmp/100%.md")).toBe("/tmp/100%25.md");
  });

  test("survives the round trip the server actually performs", () => {
    for (const original of [
      "/home/eugeniu/plans/roadmap.md",
      "/home/eugeniu/My Plans/q3 roadmap.md",
      "/tmp/a?b&c#d.md",
      "/tmp/100% done.md",
      "/tmp/ünïcode.md",
    ]) {
      const url = new URL(pathViewerUrl(7474, original));
      expect(url.searchParams.get("path")).toBe(original);
    }
  });
});
