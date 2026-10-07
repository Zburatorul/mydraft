// Issue #20: the skill is loaded on every myd turn, so it carries only the decision model and the
// core loop; everything else lives behind `myd guide <topic>`. These tests keep the card small and
// honest: every topic it points to exists, every guide topic is reachable from it, and every
// command it names is one the CLI actually dispatches.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { COMMANDS } from "./cli-help.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const skill = read("skill/SKILL.md");
const card = skill.replace(/^---\n[\s\S]*?\n---\n/, "");
const prompt = read("docs/prompt.md");
const guide = read("docs/agent-guide.md");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const guideTopics = [...guide.matchAll(/^## (\w+) —/gm)].map((match) => match[1]!);
const commandsIn = (text: string) => [...new Set([...text.matchAll(/`myd ([a-z-]+)/g)].map((match) => match[1]!))];

describe("always-loaded myd guidance", () => {
  test("the skill card and the managed prompt stay within their budgets", () => {
    expect(words(card)).toBeLessThanOrEqual(450);
    expect(words(prompt)).toBeLessThanOrEqual(120);
  });

  test("the card's deeper-reference list matches the guide's topics exactly", () => {
    const deeper = card.slice(card.indexOf("## Go deeper"));
    const listed = [...deeper.matchAll(/^- `(\w+)`/gm)].map((match) => match[1]!);
    expect(listed.sort()).toEqual([...guideTopics].sort());
  });

  test("every command the card or the prompt names is a real command", () => {
    for (const command of [...commandsIn(card), ...commandsIn(prompt)]) expect(Object.keys(COMMANDS)).toContain(command);
  });

  test("the card distinguishes a completed-review revision from live-review mutation, with a rule for each", () => {
    expect(card).toContain("A completed review is history");
    expect(card).toContain("reply before you replace");
    expect(card).toMatch(/\| One localized change[^\n]*\| Guarded op/);
    expect(card).toMatch(/\| Completed review[^\n]*\| Clean revision/);
  });

  test("guidance moved out of the card is still reachable through myd guide", () => {
    const workflow = /\n## workflow\b[\s\S]*?(?=\n## |$)/.exec(guide)![0];
    expect(workflow).toContain("Live review vs completed review");
    expect(workflow).toContain("bin/rd-open");
    expect(workflow).toContain("never invent evidence");
    expect(workflow).toContain("--skip-check");
    expect(guide).toContain("Do not force content into an explainer type that does not fit");
  });
});
