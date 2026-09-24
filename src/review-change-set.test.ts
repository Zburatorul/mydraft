import { describe, expect, test } from "bun:test";
import { hashVersion } from "./doc.ts";
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
      "The evaluator passes traces by reporting ambiguity separately from failure.",
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
          after: { blockId: "b3", index: 3, head: "The evaluator passes traces by reporting ambiguity separately from failure.", source: "The evaluator passes traces by reporting ambiguity separately from failure." },
          insertBeforeBlockId: null,
          summary: "The evaluator passes traces by reporting ambiguity separately from failure.",
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
          id: `change-added-${hashVersion("Run one trial with the expected signal absent.").slice(0, 12)}-1`,
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

  test("one shared domain word is not enough to claim prior feedback was addressed", () => {
    const before = [
      "## Method {#method}",
      "",
      "The evaluator {==checks the threshold==}{>>Clarify the rule.<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "",
    ].join("\n");
    const after = "## Method {#method}\n\nThe evaluator deploys the archive.\n";

    const changes = buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes;
    expect(changes.map((change) => change.kind)).toEqual(["removed", "added"]);
    expect(changes[0]?.priorItemIds).toEqual(["c1"]);
    expect(changes[1]?.priorItemIds).toEqual([]);
  });

  test("a matched unnamed change keeps its identity when a neighbor is inserted", () => {
    const before = "## Method {#method}\n\nThe evaluator checks local evidence.\n";
    const firstAfter = "## Method {#method}\n\nThe evaluator checks local evidence and reports uncertainty.\n";
    const secondAfter = "## Method {#method}\n\nA new setup paragraph.\n\nThe evaluator checks local evidence and reports uncertainty.\n";

    const firstId = buildReviewChangeSet({ beforeSource: before, afterSource: firstAfter }).changes.find((change) => change.kind === "modified")?.id;
    const secondId = buildReviewChangeSet({ beforeSource: before, afterSource: secondAfter }).changes.find((change) => change.kind === "modified")?.id;
    expect(firstId).toBe("change-modified-b1");
    expect(secondId).toBe(firstId);
  });

  test("reordered sections are explicit changes rather than collapsed unchanged content", () => {
    const before = "# Doc\n\n## A\n\nAlpha text here.\n\n## B\n\nBeta text here.\n";
    const after = "# Doc\n\n## B\n\nBeta text here.\n\n## A\n\nAlpha text here.\n";

    const changeSet = buildReviewChangeSet({ beforeSource: before, afterSource: after });
    expect(changeSet.changes.map((change) => `${change.kind}:${change.summary}`)).toEqual([
      "moved:A",
      "moved:Alpha text here.",
    ]);
    expect(changeSet.unchangedAfterBlockIds).toEqual(["b0", "b1", "b2"]);
  });

  test("moving one block does not mark the stable run it crossed as moved", () => {
    const before = "# Doc\n\nAlpha.\n\nBeta.\n\nGamma.\n\nDelta.\n";
    const after = "# Doc\n\nDelta.\n\nAlpha.\n\nBeta.\n\nGamma.\n";

    const changeSet = buildReviewChangeSet({ beforeSource: before, afterSource: after });
    expect(changeSet.changes.map((change) => `${change.kind}:${change.summary}`)).toEqual(["moved:Delta."]);
    expect(changeSet.unchangedAfterBlockIds).toEqual(["b0", "b2", "b3", "b4"]);
  });

  test("a lexically different heading keeps its edited section paired as modifications", () => {
    const before = "# Doc\n\n## Rollout plan\n\nWe ship the migration on Monday after the freeze ends.\n\n## Risks\n\nNone known.\n";
    const after = "# Doc\n\n## Deployment schedule\n\nWe ship the migration on Tuesday after the freeze ends.\n\n## Risks\n\nNone known.\n";

    const changeSet = buildReviewChangeSet({ beforeSource: before, afterSource: after });
    expect(changeSet.changes.map((change) => `${change.kind}:${change.summary}`)).toEqual([
      "modified:Deployment schedule",
      "modified:We ship the migration on Tuesday after the freeze ends.",
    ]);
    expect(changeSet.unchangedAfterBlockIds).toEqual(["b0", "b3", "b4"]);
  });

  test("a non-Latin sentence edit remains one modification", () => {
    const before = "# Документ\n\nМы выпускаем миграцию в понедельник после заморозки.\n";
    const after = "# Документ\n\nМы выпускаем миграцию во вторник после заморозки.\n";

    const changeSet = buildReviewChangeSet({ beforeSource: before, afterSource: after });
    expect(changeSet.changes).toEqual([
      expect.objectContaining({
        kind: "modified",
        before: expect.objectContaining({ source: "Мы выпускаем миграцию в понедельник после заморозки." }),
        after: expect.objectContaining({ source: "Мы выпускаем миграцию во вторник после заморозки." }),
      }),
    ]);
    expect(changeSet.unchangedAfterBlockIds).toEqual(["b0"]);
  });

  test("similar text under an unrelated replacement heading keeps prior feedback on the removal", () => {
    const before = [
      "# Doc",
      "",
      "## Threshold policy",
      "",
      "The evaluator {==checks the declared threshold==}{>>Keep this feedback here.<<}{#c1}.",
      "",
      "## Stable section",
      "",
      "Stable text.",
      "",
      "---",
      "comments:",
      "  c1: {by: user, at: 2026-09-23T18:00:00Z, status: open}",
      "",
    ].join("\n");
    const after = "# Doc\n\n## Stable section\n\nStable text.\n\n## Deployment archive\n\nThe evaluator checks the declared threshold and records it remotely.\n";

    const changes = buildReviewChangeSet({ beforeSource: before, afterSource: after }).changes;
    expect(changes.filter((change) => change.kind === "modified")).toHaveLength(0);
    expect(changes.find((change) => change.kind === "removed" && change.summary.includes("evaluator"))?.priorItemIds).toEqual(["c1"]);
    expect(changes.find((change) => change.kind === "added" && change.summary.includes("evaluator"))?.priorItemIds).toEqual([]);
  });
});
