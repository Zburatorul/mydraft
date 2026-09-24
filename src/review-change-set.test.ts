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
          id: "change-modified-b3",
          kind: "modified",
          before: { blockId: "b3", index: 3, head: "The evaluator passes ambiguous traces.", source: "The evaluator passes ambiguous traces." },
          after: { blockId: "b3", index: 3, head: "The evaluator reports uncertainty separately from failure.", source: "The evaluator reports uncertainty separately from failure." },
          insertBeforeBlockId: null,
          summary: "The evaluator reports uncertainty separately from failure.",
          priorItemIds: ["c1"],
          semanticChanges: [],
        },
        {
          id: "change-removed-legacy-check",
          kind: "removed",
          before: { blockId: "legacy-check", index: 4, head: "## Legacy check {#legacy-check}", source: "## Legacy check {#legacy-check}" },
          after: null,
          insertBeforeBlockId: "adversarial-check",
          summary: "Legacy check",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-removed-b5",
          kind: "removed",
          before: { blockId: "b5", index: 5, head: "Run the legacy check.", source: "Run the legacy check." },
          after: null,
          insertBeforeBlockId: "adversarial-check",
          summary: "Run the legacy check.",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-added-adversarial-check",
          kind: "added",
          before: null,
          after: { blockId: "adversarial-check", index: 4, head: "## Adversarial check {#adversarial-check}", source: "## Adversarial check {#adversarial-check}" },
          insertBeforeBlockId: null,
          summary: "Adversarial check",
          priorItemIds: [],
          semanticChanges: [],
        },
        {
          id: "change-added-b5",
          kind: "added",
          before: null,
          after: { blockId: "b5", index: 5, head: "Run one trial with the expected signal absent.", source: "Run one trial with the expected signal absent." },
          insertBeforeBlockId: null,
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
        kind: "added",
        after: expect.objectContaining({ head: "A new unrelated setup paragraph appears first." }),
        priorItemIds: [],
      }),
      expect.objectContaining({
        kind: "modified",
        after: expect.objectContaining({ head: "The revised evaluator checks local evidence and reports uncertainty." }),
        priorItemIds: ["c1"],
      }),
    ]);
  });

  test("an unrelated replacement stays an honest removal plus other addition", () => {
    const before = [
      "## Method {#method}",
      "",
      "The evaluator {==checks the declared threshold==}{>>Clarify this rule.<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "",
    ].join("\n");
    const after = "## Method {#method}\n\nDeploy the archive to a remote mirror.\n";

    expect(buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes).toEqual([
      expect.objectContaining({ kind: "removed", priorItemIds: ["c1"], insertBeforeBlockId: "b1" }),
      expect.objectContaining({ kind: "added", priorItemIds: [], summary: "Deploy the archive to a remote mirror." }),
    ]);
  });

  test("emits mixed changes in rendered document order", () => {
    const before = "# Plan {#plan}\n\nRemove this.\n\n## Result {#result}\n\nOld result text.\n";
    const after = "# Plan {#plan}\n\nAdd this instead.\n\n## Result {#result}\n\nImproved result text.\n";

    const changes = buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes;
    expect(changes.map((change) => `${change.kind}:${change.summary}`)).toEqual([
      "removed:Remove this.",
      "added:Add this instead.",
      "modified:Improved result text.",
    ]);
  });

  test("ambiguous similarity never guesses which prior feedback belongs to which rewrite", () => {
    const before = [
      "## Checks {#checks}",
      "",
      "The {==evaluator alpha uses a local signal==}{>>Alpha feedback.<<}{#c1}.",
      "",
      "The {==evaluator beta uses a remote signal==}{>>Beta feedback.<<}{#c2}.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "  c2: {by: user, at: 2026-09-23T18:01:00Z, status: open}",
      "",
    ].join("\n");
    const after = "## Checks {#checks}\n\nThe evaluator reports the first outcome.\n\nThe evaluator reports the second outcome.\n";

    const changes = buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes;
    expect(changes.filter((change) => change.kind === "modified")).toHaveLength(0);
    expect(changes.filter((change) => change.kind === "removed").map((change) => change.priorItemIds)).toEqual([["c1"], ["c2"]]);
    expect(changes.filter((change) => change.kind === "added").every((change) => change.priorItemIds.length === 0)).toBeTrue();
  });
});
