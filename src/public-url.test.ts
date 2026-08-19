import { describe, expect, test } from "bun:test";
import { InvalidPublicOrigin, normalizePublicOrigin, reviewUrl } from "./public-url.ts";

describe("a configured public origin", () => {
  test("is reduced to scheme://host[:port]", () => {
    expect(normalizePublicOrigin("https://review.example.test")).toBe("https://review.example.test");
    expect(normalizePublicOrigin("https://review.example.test/")).toBe("https://review.example.test");
    expect(normalizePublicOrigin("  https://review.example.test:8443  ")).toBe("https://review.example.test:8443");
    expect(normalizePublicOrigin("http://192.168.1.10:7474")).toBe("http://192.168.1.10:7474");
  });

  test("is absent when unset, so the default stays local-only", () => {
    expect(normalizePublicOrigin(null)).toBeNull();
    expect(normalizePublicOrigin(undefined)).toBeNull();
    // An empty value is how a single call opts back out of a remote deployment.
    expect(normalizePublicOrigin("")).toBeNull();
    expect(normalizePublicOrigin("   ")).toBeNull();
  });

  test("is rejected rather than printed when myd could not honestly hand it to a reviewer", () => {
    // A path prefix would break the viewer, which loads /web and /api from the root.
    expect(() => normalizePublicOrigin("https://example.test/myd")).toThrow(InvalidPublicOrigin);
    expect(() => normalizePublicOrigin("ws://example.test")).toThrow(InvalidPublicOrigin);
    expect(() => normalizePublicOrigin("file:///etc/passwd")).toThrow(InvalidPublicOrigin);
    expect(() => normalizePublicOrigin("review.example.test")).toThrow(InvalidPublicOrigin);
    expect(() => normalizePublicOrigin("https://example.test?a=1")).toThrow(InvalidPublicOrigin);
    expect(() => normalizePublicOrigin("https://example.test#f")).toThrow(InvalidPublicOrigin);
  });

  test("explains the path-prefix rejection instead of just refusing", () => {
    expect(() => normalizePublicOrigin("https://example.test/myd")).toThrow(/without a path prefix/);
  });
});

describe("the review URL handed to a remote reviewer", () => {
  test("is the ordinary /review/<id> route under the public origin", () => {
    expect(reviewUrl("https://review.example.test", "6f1b-42")).toBe("https://review.example.test/review/6f1b-42");
  });

  test("carries the review id and nothing else", () => {
    const url = reviewUrl("https://review.example.test", "6f1b-42");
    expect(url).not.toContain("path");
    expect(new URL(url).search).toBe("");
  });

  test("escapes an id rather than letting it reshape the URL", () => {
    expect(reviewUrl("https://review.example.test", "a/b?c")).toBe("https://review.example.test/review/a%2Fb%3Fc");
  });
});
