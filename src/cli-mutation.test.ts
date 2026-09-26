import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-cli-mutation-"));
  roots.push(root);
  const file = path.join(root, "doc.md");
  fs.writeFileSync(file, "# Title\n\nA paragraph with {>>Original<<}{#c1}.\n\n## Results {#results}\n\nDone.\n\n---\ncomments:\n  c1: {by: user, status: open}\n");
  return file;
}
async function myd(input: string | null, ...args: string[]) {
  const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "cli.ts"), ...args], {
    stdin: input === null ? undefined : new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exitCode, stdout, stderr };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("CLI document mutation seam", () => {
  test("rejects unguarded block edits", async () => {
    const file = fixture();
    const comments = await myd(null, "comments", file);
    expect(comments.stdout).toContain(`edit the commented block by the guard printed above: myd set-block ${JSON.stringify(file)} --target-guard <guard>`);
    const before = fs.readFileSync(file, "utf8");
    const result = await myd("Changed.", "set-block", file, "results");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --version");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  test("comments include surrounding source context for imprecise selections", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\nA paragraph with a care{==fully chosen fra==}{>>This selection is intentionally sloppy.<<}{#c1}gment in context.\n\n---\ncomments:\n  c1: {by: user, status: open}\n");
    const comments = await myd(null, "comments", file, "--json");
    const item = JSON.parse(comments.stdout).items[0];

    expect(item.anchorText).toBe("fully chosen fra");
    expect(item.context).toBe("A paragraph with a carefully chosen fragment in context.");
  });

  test("comments report a stable anchor: current block, name, guard, quote occurrence", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\nSame words, then {==Same words==}{>>second<<}{#c1} again.\n\n## Results {#results}\n\nWe pay {~~ten~>twelve~~}{#s1} dollars.\n\n```mermaid\nflowchart LR\n  A-->B\n```\n{>>about A<<}{#c2}\n\n---\ncomments:\n  c1: {by: user, status: open}\n  c2: {by: user, status: open, anchor: {block: b9, target: \"node:A\"}}\n  c3: {body: \"ok\", by: AI, re: c1}\n");
    const blocks = JSON.parse((await myd(null, "blocks", file, "--json")).stdout).blocks as Array<{ id: string; guard: string }>;
    const guardOf = (id: string) => blocks.find((b) => b.id === id)!.guard;
    const items = JSON.parse((await myd(null, "comments", file, "--json")).stdout).items as any[];
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.c1.anchor).toEqual({ block: "b1", name: null, guard: guardOf("b1"), quote: "Same words", quoteOccurrence: 1, lineApprox: 3 });
    expect(byId.c1.line).toBe(3);
    expect(byId.s1.anchor).toMatchObject({ block: "b3", guard: guardOf("b3"), quote: "ten", quoteOccurrence: 0 });
    // the recorded endmatter block id (b9) is stale; the body position wins
    expect(byId.c2.anchor).toMatchObject({ block: "b4", name: null, guard: guardOf("b4"), target: "node:A", quote: null });
    expect(byId.c3.anchor).toBeNull();
    fs.writeFileSync(file, "# Title\n\n## Results {#results}\n\nWe pay {==ten==}{>>why?<<}{#c1} dollars.\n\n---\ncomments:\n  c1: {by: user, status: open}\n");
    const shifted = JSON.parse((await myd(null, "comments", file, "--json")).stdout).items[0].anchor;
    expect(shifted).toMatchObject({ block: "b2", name: null, quote: "ten" });
    const human = (await myd(null, "comments", file)).stdout;
    expect(human).toContain(`c1 [comment] user @b2 (guard ${shifted.guard}, ~L5) “ten”`);
  });

  test("named block comments report the authored name", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\n## Results {#results}\n\nWe pay {==ten==}{>>why?<<}{#c1} dollars.\n\n```mermaid {#flow}\nflowchart LR\n  A-->B\n```\n{>>node<<}{#c2}\n\n---\ncomments:\n  c1: {by: user, status: open}\n  c2: {by: user, status: open, anchor: {block: flow, target: \"node:A\"}}\n");
    const blocks = JSON.parse((await myd(null, "blocks", file, "--json")).stdout).blocks as Array<{ id: string; guard: string }>;
    const items = JSON.parse((await myd(null, "comments", file, "--json")).stdout).items as any[];
    expect(items[1].anchor).toMatchObject({ block: "flow", name: "flow", guard: blocks.find((b) => b.id === "flow")!.guard, target: "node:A" });
    expect((await myd(null, "comments", file)).stdout).toContain("c2 [comment] user @flow›node:A (guard ");
  });

  test("comment guard survives earlier edits and still addresses the commented block", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\nIntro.\n\nFix {==this==}{>>reword<<}{#c1} line.\n\nOutro.\n\n---\ncomments:\n  c1: {by: user, status: open}\n");
    const guard = JSON.parse((await myd(null, "comments", file, "--json")).stdout).items[0].anchor.guard;
    const introGuard = JSON.parse((await myd(null, "blocks", file, "--json")).stdout).blocks[1].guard;
    // an earlier edit shifts every later positional id
    expect((await myd("Intro.\n\nA brand new paragraph.", "set-block", file, "--target-guard", introGuard)).exitCode).toBe(0);
    const after = JSON.parse((await myd(null, "comments", file, "--json")).stdout).items[0].anchor;
    expect(after).toMatchObject({ block: "b3", guard });
    const newFile = path.join(path.dirname(file), "new.md");
    fs.writeFileSync(newFile, "Fix {==this==}{>>reword<<}{#c1} sentence, reworded.");
    const set = await myd(null, "set-block", file, "--target-guard", guard, "--file", newFile);
    expect(set.exitCode).toBe(0);
    expect((await myd(null, "reply", file, "c1", "Reworded.")).exitCode).toBe(0);
    expect((await myd(null, "resolve", file, "c1")).exitCode).toBe(0);
    const body = fs.readFileSync(file, "utf8");
    expect(body).toContain("Intro.\n\nA brand new paragraph.\n\nFix {==this==}{>>reword<<}{#c1} sentence, reworded.\n\nOutro.");
  });

  test("stale block edits leave bytes unchanged and guarded edits succeed", async () => {
    const file = fixture();
    const listing = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    const before = fs.readFileSync(file, "utf8");
    const stale = await myd("Changed.", "set-block", file, "results", "--version", "stale");
    expect(stale.exitCode).toBe(3);
    expect(stale.stderr).toContain("version mismatch");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const guarded = await myd("Changed.", "set-block", file, "results", "--version", listing.version, "--json");
    expect(guarded.exitCode).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toContain("Changed.");
    expect(JSON.parse(guarded.stdout)).toMatchObject({ ok: true, previousVersion: listing.version });
  });

  test("reply uses stable review identity against the current source", async () => {
    const file = fixture();
    const result = await myd(null, "reply", file, "c1", "Current reply", "--json");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, id: "c1" });
    expect(fs.readFileSync(file, "utf8")).toContain("Current reply");
  });

  test("default comments hide replies belonging to resolved threads", async () => {
    const file = fixture();
    await myd(null, "reply", file, "c1", "Handled by the agent");
    await myd(null, "resolve", file, "c1");

    const pending = JSON.parse((await myd(null, "comments", file, "--json")).stdout);
    const all = JSON.parse((await myd(null, "comments", file, "--all", "--json")).stdout);
    expect(pending.items).toEqual([]);
    expect(all.items.map((item: { id: string }) => item.id)).toEqual(["c1", "c2"]);
  });

  test("a positional block id cannot silently retarget after an earlier edit shifts blocks", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title {#title}\n\nFirst target.\n\nSecond target.\n\nThird target.\n");
    const initial = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    const firstTarget = initial.blocks.find((block: { id: string }) => block.id === "b1");
    const thirdTarget = initial.blocks.find((block: { id: string }) => block.id === "b3");

    const first = await myd("First replacement.\n\nInserted block.", "set-block", file, "b1", "--version", initial.version, "--expect", firstTarget.guard, "--json");
    expect(first.exitCode).toBe(0);
    const versionAfterFirstEdit = JSON.parse(first.stdout).version;

    const shifted = await myd("Third replacement.", "set-block", file, "b3", "--version", versionAfterFirstEdit, "--expect", thirdTarget.guard, "--json");
    expect(shifted.exitCode).not.toBe(0);
    expect(shifted.stderr).toContain(`guard ${thirdTarget.guard} is now at b4; refusing to edit b3`);
    expect(fs.readFileSync(file, "utf8")).toContain("Second target.");
    expect(fs.readFileSync(file, "utf8")).toContain("Third target.");
  });

  test("a batch planned from one listing lands on the intended blocks in any order (issue #26)", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\nAlpha.\n\nBeta.\n\nGamma.\n\nDelta.\n");
    const plan = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    const guardOf = (id: string) => plan.blocks.find((block: { id: string }) => block.id === id).guard;

    // First edit grows one block into three, shifting every later positional id by +2.
    const grow = await myd("Alpha one.\n\nAlpha two.\n\nAlpha three.", "set-block", file, "b1", "--expect", guardOf("b1"), "--json");
    expect(grow.exitCode).toBe(0);
    // Planned positional id with its planned guard: refused with the block's new position, nothing written.
    const before = fs.readFileSync(file, "utf8");
    const stale = await myd("Gamma replaced.", "set-block", file, "b3", "--expect", guardOf("b3"));
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toContain(`guard ${guardOf("b3")} is now at b5`);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    // Content addressing needs neither a position nor a fresh version.
    for (const [id, text] of [["b4", "Delta replaced."], ["b2", "Beta replaced."], ["b3", "Gamma replaced."]] as const) {
      const result = await myd(text, "set-block", file, "--target-guard", guardOf(id), "--json");
      expect(result.exitCode).toBe(0);
    }
    expect(fs.readFileSync(file, "utf8")).toBe("# Title\n\nAlpha one.\n\nAlpha two.\n\nAlpha three.\n\nBeta replaced.\n\nGamma replaced.\n\nDelta replaced.\n");
  });

  test("a content guard fails loudly once its block was edited, and duplicate blocks keep distinct guards", async () => {
    const file = fixture();
    fs.writeFileSync(file, "# Title\n\nSame.\n\nSame.\n");
    const plan = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    expect(plan.blocks[1].guard).not.toBe(plan.blocks[2].guard);
    expect((await myd("Edited.", "set-block", file, "b2", "--expect", plan.blocks[2].guard)).exitCode).toBe(0);
    const gone = await myd("Again.", "set-block", file, "--target-guard", plan.blocks[2].guard);
    expect(gone.exitCode).toBe(1);
    expect(gone.stderr).toContain("no block carries guard");
    expect(fs.readFileSync(file, "utf8")).toBe("# Title\n\nSame.\n\nEdited.\n");
  });

  test("a supplied --version is still enforced alongside a content guard", async () => {
    const file = fixture();
    const listing = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    const result = await myd("Changed.", "set-block", file, "b1", "--version", "stale", "--expect", listing.blocks[1].guard);
    expect(result.exitCode).toBe(3);
  });

  test("replies and resolutions do not invalidate planned guards", async () => {
    const file = fixture();
    const listing = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    await myd(null, "reply", file, "c1", "Answered");
    await myd(null, "resolve", file, "c1");
    const after = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    expect(after.blocks.map((block: { guard: string }) => block.guard)).toEqual(listing.blocks.map((block: { guard: string }) => block.guard));
  });

  test("a positional edit without its listing guard leaves the document unchanged", async () => {
    const file = fixture();
    const listing = JSON.parse((await myd(null, "blocks", file, "--json")).stdout);
    const before = fs.readFileSync(file, "utf8");

    const result = await myd("Unsafe replacement.", "set-block", file, "b1", "--version", listing.version);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --expect");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  test("block JSON provides the full source and its positional guard", async () => {
    const file = fixture();
    const result = await myd(null, "block", file, "b1", "--json");
    const inspected = JSON.parse(result.stdout);

    expect(inspected.source).toContain("A paragraph with");
    expect(inspected.block.guard).toMatch(/^[a-f0-9]{12}$/);
    expect(inspected.version).toMatch(/^[a-f0-9]{12}$/);
  });
});
