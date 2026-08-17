import { expect, test } from "bun:test";
import fs from "node:fs";
import { diffExplainers } from "./explainer-diff.ts";

const fence = (path: string) => /```explainer[^\n]*\n([\s\S]*?)\n```/.exec(fs.readFileSync(path, "utf8"))![1]!;

test("semantic diff names changed fields by stable explainer id", () => {
  const changes = diffExplainers(
    fence("examples/timing-bakeoff/semantic.before.md"),
    fence("examples/timing-bakeoff/semantic.md"),
  );

  expect(changes).toEqual([
    { id: "alice-trigger", field: "observes", before: "local timer expires", after: "detector A fires" },
    { id: "alice-trigger", field: "synchronization", before: "assumed", after: "measured" },
    { id: "bob-trigger", field: "synchronization", before: "assumed", after: "measured" },
    { id: "ld-result", field: "value", before: 0.68, after: 0.73 },
  ]);
});
