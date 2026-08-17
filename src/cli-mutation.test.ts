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
    expect(comments.stdout).toContain(`myd blocks ${JSON.stringify(file)} --json to get the version`);
    const before = fs.readFileSync(file, "utf8");
    const result = await myd("Changed.", "set-block", file, "results");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --version");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
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
});
