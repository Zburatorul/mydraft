import { describe, expect, test } from "bun:test";
import { buildReviewChangeSet } from "./review-change-set.ts";

describe("ReviewChangeSet", () => {
  test("describes rendered regions relative to a completed review snapshot", () => {
    const before = [
      "# Evaluation plan {#plan}",
      "",
      "Context stays the same.",
      "",
      "## Decision rule {#decision-rule}",
      "",
      "The evaluator {==passes ambiguous traces==}{>>Explain how ambiguity is classified.<<}{#c1}.",
      "",
      "## Legacy check {#legacy-check}",
      "",
      "Run the legacy check.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "",
    ].join("\n");
    const after = [
      "# Evaluation plan {#plan}",
      "",
      "Context stays the same.",
      "",
      "## Decision rule {#decision-rule}",
      "",
      "The evaluator reports uncertainty separately from failure.",
      "",
      "## Adversarial check {#adversarial-check}",
      "",
      "Run one trial with the expected signal absent.",
      "",
    ].join("\n");

    expect(buildReviewChangeSet({ beforeSource: before, afterSource: after })).toEqual({
      changes: [
        {
          id: "change-1",
          kind: "modified",
          before: { blockId: "b3", index: 3, head: "The evaluator passes ambiguous traces." },
          after: { blockId: "b3", index: 3, head: "The evaluator reports uncertainty separately from failure." },
          summary: "The evaluator reports uncertainty separately from failure.",
          priorItemIds: ["c1"],
          semanticChanges: [],
        },
        {
          id: "change-2",
          kind: "removed",
          before: { blockId: "legacy-check", index: 4, head: "## Legacy check {#legacy-check}" },
          after: null,
          summary: "Legacy check",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-3",
          kind: "removed",
          before: { blockId: "b5", index: 5, head: "Run the legacy check." },
          after: null,
          summary: "Run the legacy check.",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-4",
          kind: "added",
          before: null,
          after: { blockId: "adversarial-check", index: 4, head: "## Adversarial check {#adversarial-check}" },
          summary: "Adversarial check",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-5",
          kind: "added",
          before: null,
          after: { blockId: "b5", index: 5, head: "Run one trial with the expected signal absent." },
          summary: "Run one trial with the expected signal absent.",
          priorItemIds: [],
          semanticChanges: [],
        },
      ],
      unchangedAfterBlockIds: ["plan", "b1", "decision-rule"],
    });
  });

  test("names exact semantic-object changes inside a modified rendered block", () => {
    const before = [
      "```explainer {#result}",
      "title: Trial",
      "sections:",
      "  - type: result",
      "    id: verdict",
      "    label: Score",
      "    value: 0.68",
      "    status: measured",
      "```",
      "",
    ].join("\n");
    const after = before.replace("value: 0.68", "value: 0.73");

    expect(buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes).toEqual([
      expect.objectContaining({
        kind: "modified",
        before: expect.objectContaining({ blockId: "result" }),
        after: expect.objectContaining({ blockId: "result" }),
        semanticChanges: [{ id: "verdict", field: "value", before: 0.68, after: 0.73 }],
      }),
    ]);
  });

  test("an inserted neighbor does not steal the prior feedback from a revised paragraph", () => {
    const before = [
      "## Method {#method}",
      "",
      "The {==baseline evaluator checks local evidence==}{>>Clarify the decision rule.<<}{#c1}.",
      "",
      "The stable paragraph remains.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "",
    ].join("\n");
    const after = [
      "## Method {#method}",
      "",
      "A new unrelated setup paragraph appears first.",
      "",
      "The revised evaluator checks local evidence and reports uncertainty.",
      "",
      "The stable paragraph remains.",
      "",
    ].join("\n");

    const changes = buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes;
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "modified",
        after: expect.objectContaining({ head: "The revised evaluator checks local evidence and reports uncertainty." }),
        priorItemIds: ["c1"],
      }),
      expect.objectContaining({
        kind: "added",
        after: expect.objectContaining({ head: "A new unrelated setup paragraph appears first." }),
        priorItemIds: [],
      }),
    ]);
  });
});
