import { describe, expect, test } from "bun:test";
import { reviewPresentation } from "./review-state.js";

describe("reviewPresentation", () => {
  test("keeps the active review visually current", () => {
    expect(reviewPresentation({ tracked: true, state: "active" }, "plan.md", 12)).toEqual({
      deprecated: false,
      label: "",
      title: "r12 · plan.md · myd",
    });
  });

  test.each([
    ["completed", "review closed"],
    ["superseded", "outdated review"],
    ["unknown", "not tracked"],
  ])("labels %s reviews in the browser tab", (state, label) => {
    expect(reviewPresentation({ tracked: false, state }, "plan.md", 12)).toEqual({
      deprecated: true,
      label,
      title: `${label} · r12 · plan.md`,
    });
  });
});
