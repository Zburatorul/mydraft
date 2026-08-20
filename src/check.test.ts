// Issue #22: structural validation. The bar for a gate that blocks `myd view` is not "it finds
// problems" but "it does not invent them" — a check that cries wolf gets --skip-check'd forever
// and stops being a gate. Several tests below exist only to pin false positives that were real.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkDocument } from "./check.ts";

const CLI = path.resolve(import.meta.dir, "cli.ts");
const REPO = path.resolve(import.meta.dir, "..");
let root: string;
const homes: Array<{ home: string; port: string }> = [];

function fixture(name: string, source: string) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}
const codes = (report: { diagnostics: Array<{ code: string }> }) => report.diagnostics.map((d) => d.code);

function instance(port: string) {
  const home = path.join(root, `state-${port}`);
  fs.mkdirSync(home, { recursive: true });
  homes.push({ home, port });
  return home;
}
async function myd(env: Record<string, string>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, MYD_NO_OPEN: "1", ...env },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-check-")); });
afterAll(async () => {
  for (const { home, port } of homes) await myd({ MYD_HOME: home, MYD_PORT: port }, "stop");
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a sound document passes", () => {
  test("plain Markdown with a valid review layer is ok", async () => {
    const file = fixture("sound.md", "# Title\n\nA paragraph with {==an anchor==}{>>a note<<}{#c1}.\n\n## Results {#results}\n\nDone.\n\n---\ncomments:\n  c1: {by: user, at: \"2026-08-16T01:00:00Z\", status: open}\n");
    const report = await checkDocument(file);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  test("this repo's own README and skill file are not blocked", async () => {
    // The vendor validator reads SKILL.md's YAML *frontmatter* as review endmatter and calls it
    // invalid. A gate that blocks a file like this is worse than no gate.
    for (const name of ["README.md", "skill/SKILL.md"]) {
      const report = await checkDocument(path.join(REPO, name));
      expect({ name, errors: report.errors.map((d) => d.code) }).toEqual({ name, errors: [] });
    }
  });

  test("warnings alone leave the document openable", async () => {
    const file = fixture("warn.md", "# Title\n\nSee [the plan](./not-written-yet.md).\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("local-reference-missing");
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

describe("review metadata and endmatter", () => {
  test("a fenced `---` example read as endmatter is reported with what it costs", async () => {
    // The live case: docs/agent-guide.md loses 43% of its body this way, silently.
    const file = fixture("fenced.md", "# Guide\n\n```markdown\nText {>>c<<}{#c1}\n\n---\ncomments:\n  c1: {by: user}\n```\n\nProse that gets swallowed.\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("endmatter-inside-fence");
    expect(report.ok).toBe(false);
    const diagnostic = report.errors.find((d) => d.code === "endmatter-inside-fence")!;
    expect(diagnostic.message).toMatch(/bytes of this document are dropped/);
    expect(diagnostic.hint).toBeTruthy();
    expect(diagnostic.line).toBeGreaterThan(1);
  });

  test("unparsable endmatter is an error rather than a silently empty review layer", async () => {
    const file = fixture("badyaml.md", "# T\n\nA {>>note<<}{#c1} here.\n\n---\ncomments:\n  c1: {by: user\n  : : :\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("endmatter-unparsable");
    expect(report.ok).toBe(false);
  });

  test("endmatter whose comments key is not a mapping is an error", async () => {
    const file = fixture("notmap.md", "# T\n\nText.\n\n---\ncomments:\n  - one\n  - two\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("endmatter-not-a-mapping");
    expect(report.ok).toBe(false);
  });

  test("a duplicated review id is fatal", async () => {
    const file = fixture("dupe.md", "# T\n\n{==a==}{>>x<<}{#c1} and {==b==}{>>y<<}{#c1}.\n\n---\ncomments:\n  c1: {by: user, at: \"2026-08-16T01:00:00Z\"}\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("duplicate-id");
    expect(report.ok).toBe(false);
  });

  test("an unclosed highlight marker is fatal", async () => {
    const file = fixture("unclosed.md", "# T\n\nA {==broken marker.\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("unclosed-highlight");
    expect(report.ok).toBe(false);
  });

  test("myd's looser metadata dialect does not block a review", async () => {
    // The vendor requires `at`; myd's own fixtures and hand-written docs routinely omit it.
    const file = fixture("noat.md", "# T\n\nA {==x==}{>>note<<}{#c1} here.\n\n---\ncomments:\n  c1: {by: user, status: open}\n");
    const report = await checkDocument(file);
    expect(report.ok).toBe(true);
  });
});

describe("blocks, fences, and references", () => {
  test("two blocks with the same name are fatal, because set-block silently picks the first", async () => {
    const file = fixture("dupname.md", "# T\n\n## One {#results}\n\na\n\n## Two {#results}\n\nb\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("block-name-duplicate");
    expect(report.ok).toBe(false);
  });

  test("a malformed block name warns, since the block silently stays positional", async () => {
    const file = fixture("badname.md", "# T\n\n## Section {#1nope}\n\nbody\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("block-name-malformed");
    expect(report.ok).toBe(true);
  });

  test("an invalid explainer is fatal and carries the schema's own message", async () => {
    const file = fixture("explainer.md", "# T\n\n```explainer\njust a string\n```\n");
    const report = await checkDocument(file);
    const diagnostic = report.errors.find((d) => d.code === "explainer-invalid");
    expect(diagnostic).toBeTruthy();
    expect(diagnostic!.message).toMatch(/YAML object/);
  });

  test("a chart fence that is not valid JSON is fatal", async () => {
    const file = fixture("vega.md", "# T\n\n```vega-lite\n{not json,}\n```\n");
    const report = await checkDocument(file);
    expect(codes(report)).toContain("vega-spec-invalid");
    expect(report.ok).toBe(false);
  });

  test("a missing local image warns and names the target", async () => {
    const file = fixture("img.md", "# T\n\n![diagram](./missing.svg)\n");
    const report = await checkDocument(file);
    const diagnostic = report.warnings.find((d) => d.code === "local-image-missing")!;
    expect(diagnostic.message).toContain("./missing.svg");
  });

  test("references inside code are quoted, not authored", async () => {
    // This repo's plans document `![img](file.svg)` in backticks to explain syntax. Flagging that
    // produced five false warnings before code spans were taken from the parser instead of a regex.
    const file = fixture("quoted.md", "# T\n\nOnly `![img](file.svg)` renders.\n\n```markdown\n![x](./also-not-real.png)\n```\n");
    const report = await checkDocument(file);
    expect(report.diagnostics).toEqual([]);
  });

  test("an existing local reference is not flagged", async () => {
    fixture("target.md", "# Target\n");
    const file = fixture("linker.md", "# T\n\nSee [target](./target.md) and [an anchor](#section).\n");
    const report = await checkDocument(file);
    expect(report.diagnostics).toEqual([]);
  });

  test("external links are never resolved against the filesystem", async () => {
    const file = fixture("ext.md", "# T\n\n[a](https://example.test/x) [b](mailto:x@example.test) [c](//cdn.example.test/y)\n");
    const report = await checkDocument(file);
    expect(report.diagnostics).toEqual([]);
  });
});

describe("mermaid", () => {
  test("is skipped unless asked for", async () => {
    const file = fixture("mmd-skip.md", "# T\n\n```mermaid\ngraph TD\n  A-->B\n```\n");
    expect((await checkDocument(file)).mermaid).toBe("skipped");
  });

  test("reports `none` when the document has no diagrams", async () => {
    const file = fixture("mmd-none.md", "# T\n\nNo diagrams here.\n");
    expect((await checkDocument(file, { mermaid: true })).mermaid).toBe("none");
  });

  test("a genuinely unparseable diagram is fatal", async () => {
    const file = fixture("mmd-bad.md", "# T\n\n```mermaid\nthis is definitely not a diagram at all\n```\n");
    const report = await checkDocument(file, { mermaid: true });
    expect(codes(report)).toContain("mermaid-invalid");
    expect(report.ok).toBe(false);
  }, 30000);

  test("a valid diagram the headless parser cannot evaluate is never called invalid", async () => {
    // mermaid is a browser library: a flowchart with edge labels dies on `DOMPurify.addHook is not
    // a function` here. That is the parser failing, not the diagram, and reporting it as a broken
    // diagram would block a review over nothing. The run is marked degraded instead.
    const file = fixture("mmd-ok.md", "# T\n\n```mermaid\nflowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do]\n  B -->|no| D[Skip]\n```\n");
    const report = await checkDocument(file, { mermaid: true });
    expect(report.errors.filter((d) => d.code === "mermaid-invalid")).toEqual([]);
    expect(report.ok).toBe(true);
    expect(["checked", "degraded"]).toContain(report.mermaid);
  }, 30000);
});

describe("the CLI surface", () => {
  test("`myd check --json` returns typed diagnostics and exits 2 on error", async () => {
    const file = fixture("cli-bad.md", "# T\n\n## A {#dup}\n\nx\n\n## B {#dup}\n\ny\n");
    const result = await myd({}, "check", file, "--json", "--no-mermaid");
    expect(result.exitCode).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(false);
    expect(report.path).toBe(file);
    expect(report.version).toBeTruthy();
    for (const diagnostic of report.diagnostics) {
      expect(["error", "warning"]).toContain(diagnostic.severity);
      expect(typeof diagnostic.code).toBe("string");
      expect(typeof diagnostic.message).toBe("string");
      expect(typeof diagnostic.line).toBe("number");
      expect(typeof diagnostic.column).toBe("number");
    }
  });

  test("`myd check` exits 0 on a sound document", async () => {
    const file = fixture("cli-good.md", "# T\n\nAll fine.\n");
    const result = await myd({}, "check", file, "--no-mermaid");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
  });

  test("`myd view` refuses a structurally broken document and creates no review", async () => {
    const file = fixture("cli-view-bad.md", "# T\n\n## A {#dup}\n\nx\n\n## B {#dup}\n\ny\n");
    const home = instance("7671");
    const result = await myd({ MYD_HOME: home, MYD_PORT: "7671" }, "view", file, "--json");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("block-name-duplicate");
    expect(result.stderr).toContain("No review was created");
    expect(result.stdout).toBe("");
    // The preflight runs before the server: nothing was started, so nothing tracked a review.
    expect(fs.existsSync(path.join(home, "reviews.json"))).toBe(false);
  });

  test("diagnostics name the file and a line, so they can be acted on", async () => {
    const file = fixture("cli-loc.md", "# T\n\nline two\n\n## A {#dup}\n\nx\n\n## B {#dup}\n\ny\n");
    const result = await myd({ MYD_HOME: instance("7672"), MYD_PORT: "7672" }, "view", file);
    expect(result.stderr).toMatch(new RegExp(`${file.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:\\d+:\\d+ error`));
  });

  test("--skip-check opens the review anyway", async () => {
    const file = fixture("cli-skip.md", "# T\n\n## A {#dup}\n\nx\n\n## B {#dup}\n\ny\n");
    const home = instance("7673");
    const result = await myd({ MYD_HOME: home, MYD_PORT: "7673" }, "view", file, "--json", "--skip-check");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).reviewId).toBeTruthy();
  });

  test("warnings print but do not stop the review", async () => {
    const file = fixture("cli-warn.md", "# T\n\nSee [gone](./gone.md).\n");
    const home = instance("7674");
    const result = await myd({ MYD_HOME: home, MYD_PORT: "7674" }, "view", file, "--json");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("local-reference-missing");
    expect(JSON.parse(result.stdout).reviewId).toBeTruthy();
  });
});
