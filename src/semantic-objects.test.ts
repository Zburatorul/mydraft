import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-objects-test-"));
  roots.push(root);
  const file = path.join(root, "explainer.md");
  fs.writeFileSync(file, [
    "# Decision epoch",
    "",
    "```explainer {#epoch}",
    "title: Local decisions",
    "metadata:",
    "  id: not-rendered",
    "sections:",
    "  - type: timing",
    "    id: recognition",
    "    parties: [Alice, Bob]",
    "    events:",
    "      - id: alice-trigger",
    "        party: Alice",
    "        observes: detector A fires",
    "        action: close Alice's epoch",
    "        locality: local",
    "        synchronization: measured",
    "      - id: bob-trigger",
    "        party: Bob",
    "        observes: detector B fires",
    "        action: close Bob's epoch",
    "        locality: local",
    "        synchronization: measured",
    "```",
    "",
  ].join("\n"));
  return file;
}

async function myd(...args: string[]) {
  const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "cli.ts"), ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function mydWithInput(input: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, "cli.ts"), ...args], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("semantic object CLI", () => {
  test("lists explainer objects using the same block›target identity as annotations", async () => {
    const file = fixture();

    const result = await myd("objects", file, "--json");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      path: file,
      objects: [
        { ref: "epoch›recognition", block: "epoch", target: "recognition", kind: "timing", path: "sections[0]" },
        { ref: "epoch›alice-trigger", block: "epoch", target: "alice-trigger", kind: "event", path: "sections[0].events[0]" },
        { ref: "epoch›bob-trigger", block: "epoch", target: "bob-trigger", kind: "event", path: "sections[0].events[1]" },
      ],
    });
    expect(result.stdout).not.toContain("not-rendered");
  });

  test("inspects one object as standalone, editable YAML", async () => {
    const file = fixture();

    const result = await myd("object", file, "epoch›alice-trigger", "--json");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ref: "epoch›alice-trigger",
      kind: "event",
      source: [
        "id: alice-trigger",
        "party: Alice",
        "observes: detector A fires",
        "action: close Alice's epoch",
        "locality: local",
        "synchronization: measured",
      ].join("\n"),
    });
  });

  test("replaces one object without rewriting its siblings or review metadata", async () => {
    const file = fixture();
    fs.appendFileSync(file, [
      "A reviewed conclusion.",
      "{>>keep this thread<<}{#c1}",
      "",
      "---",
      "comments:",
      "  c1: {by: user, status: open}",
      "",
    ].join("\n"));
    const inventory = JSON.parse((await myd("objects", file, "--json")).stdout);
    const before = fs.readFileSync(file, "utf8");
    const bob = before.match(/      - id: bob-trigger[\s\S]*?synchronization: measured/)![0];
    const endmatter = before.slice(before.indexOf("\n---\ncomments:"));

    const result = await mydWithInput([
      "id: alice-trigger",
      "party: Alice",
      "observes: local clock reaches the deadline",
      "action: close Alice's epoch",
      "locality: local",
      "synchronization: derived",
      "",
    ].join("\n"), "set-object", file, "epoch›alice-trigger", "--version", inventory.version, "--json");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const after = fs.readFileSync(file, "utf8");
    expect(after).toContain("        observes: local clock reaches the deadline");
    expect(after).toContain(bob);
    expect(after.slice(after.indexOf("\n---\ncomments:"))).toBe(endmatter);
    expect(JSON.parse(result.stdout).version).not.toBe(inventory.version);
  });

  test("rejects stale or identity-changing edits without touching the file", async () => {
    const file = fixture();
    const before = fs.readFileSync(file, "utf8");

    const unguarded = await mydWithInput("id: alice-trigger\n", "set-object", file, "epoch›alice-trigger");
    expect(unguarded.exitCode).toBe(1);
    expect(unguarded.stderr).toContain("set-object requires --version");
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const stale = await mydWithInput("id: alice-trigger\n", "set-object", file, "epoch›alice-trigger", "--version", "stale");
    expect(stale.exitCode).toBe(3);
    expect(stale.stderr).toContain("version mismatch");
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const inventory = JSON.parse((await myd("objects", file, "--json")).stdout);
    const renamed = await mydWithInput("id: renamed\n", "set-object", file, "epoch›alice-trigger", "--version", inventory.version);
    expect(renamed.exitCode).toBe(1);
    expect(renamed.stderr).toContain("replacement id must remain alice-trigger");
    expect(fs.readFileSync(file, "utf8")).toBe(before);

    const invalid = await mydWithInput("id: alice-trigger\n", "set-object", file, "epoch›alice-trigger", "--version", inventory.version);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("alice-trigger.party must be non-empty text");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  test("rejects an ambiguous block›target identity", async () => {
    const file = fixture();
    fs.appendFileSync(file, [
      "```explainer {#epoch}",
      "title: Another explainer",
      "sections:",
      "  - type: result",
      "    id: recognition",
      "    label: Duplicate identity",
      "    value: ambiguous",
      "    status: derived",
      "```",
      "",
    ].join("\n"));

    const result = await myd("objects", file, "--json");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ambiguous semantic object reference: epoch›recognition");
  });
});
