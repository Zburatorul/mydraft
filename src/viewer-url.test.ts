// `myd shot` renders a document that is not under review, so it must use the path route.
// It regressed to the review route once — passing a file path where a review id belongs,
// which the server answers with 404 — so both URLs are pinned against a live server here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleViewerUrl, pathViewerUrl, reviewViewerUrl } from "./viewer-url.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 30_000;

let tempDir: string;
let server: Bun.Subprocess | null = null;
let port: number;
let fixture: string;

async function startServer() {
  server = Bun.spawn([process.execPath, path.join(ROOT, "src/server.ts")], {
    cwd: ROOT,
    env: { ...process.env, MYD_HOME: path.join(tempDir, "state"), MYD_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!(server.stdout instanceof ReadableStream)) throw new Error("server stdout was not piped");
  const reader = server.stdout.getReader();
  let output = "";
  while (!output.includes("\n")) {
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(5_000).then(() => { throw new Error("Timed out starting server"); }),
    ]);
    if (result.done) throw new Error(`server exited before startup: ${output}`);
    output += new TextDecoder().decode(result.value);
  }
  port = Number(/localhost:(\d+)/.exec(output)?.[1]);
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myd-viewer-url-"));
  fixture = path.join(tempDir, "shot.md");
  fs.writeFileSync(fixture, "# Shot\n\nA paragraph.\n");
  await startServer();
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  server?.kill();
  if (server) await server.exited;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("the URL myd shot builds", () => {
  test("is served by the viewer, not answered with 404", async () => {
    const response = await fetch(pathViewerUrl(port, fixture));
    expect(response.status).toBe(200);
    // The viewer, not the inbox: a bare `/` would list reviews instead of rendering this file.
    expect(await response.text()).toContain('src="/web/app.js"');
  }, TEST_TIMEOUT_MS);

  test("still renders the document it was given", async () => {
    const doc = await (await fetch(`http://localhost:${port}/api/doc?path=${encodeURIComponent(fixture)}`)).json() as { html: string };
    expect(doc.html).toContain("Shot");
  }, TEST_TIMEOUT_MS);

  test("does not register a review, so a screenshot cannot retire an open tab", async () => {
    await fetch(pathViewerUrl(port, fixture));
    const inbox = await (await fetch(`http://localhost:${port}/api/inbox`)).json() as { rows: unknown[] };
    expect(inbox.rows).toHaveLength(0);
  }, TEST_TIMEOUT_MS);

  test("is not the review route, which 404s when handed a file path", async () => {
    // The exact shape of the regression: reviewViewerUrl(port, file) instead of a review id.
    const response = await fetch(reviewViewerUrl(port, fixture));
    expect(response.status).toBe(404);
  }, TEST_TIMEOUT_MS);
});

describe("myd shot", () => {
  // The regression was in the call site, not the builder, so this drives the real command
  // and records the URL it hands the browser. A shim stands in for Chrome, which keeps the
  // case fast and lets it run where no Chrome is installed.
  test("hands the browser a handle URL that carries no filename at all", async () => {
    const shotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myd-shot-"));
    const binDir = path.join(shotRoot, "bin");
    const argvLog = path.join(shotRoot, "argv.log");
    fs.mkdirSync(binDir);
    const shim = path.join(binDir, "google-chrome");
    // Record every argument, then leave a file where --screenshot= asked for one.
    fs.writeFileSync(shim, `#!/bin/sh\nfor a in "$@"; do echo "$a" >> ${JSON.stringify(argvLog)}; done\nfor a in "$@"; do case "$a" in --screenshot=*) : > "\${a#--screenshot=}";; esac; done\n`);
    fs.chmodSync(shim, 0o755);

    // A filename that would otherwise drag escapes into the URL.
    fs.mkdirSync(path.join(shotRoot, "My Plans"));
    const doc = path.join(shotRoot, "My Plans", "q3 roadmap.md");
    fs.writeFileSync(doc, "# Shot\n\nA paragraph.\n");
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MYD_HOME: path.join(shotRoot, "state"), MYD_PORT: "0" };
    try {
    const child = Bun.spawn([process.execPath, path.join(ROOT, "src/cli.ts"), "shot", doc, "--json"], {
      stdout: "pipe", stderr: "pipe",
      env,
    });
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    expect(exitCode).toBe(0);

    const passed = fs.readFileSync(argvLog, "utf8").trim().split("\n");
    const url = passed.find((a) => a.startsWith("http://"));
    expect(url).toBeDefined();
    // A handle, so nothing about the filename reaches the URL — not the path, not an escape.
    expect(url).toMatch(/^http:\/\/localhost:\d+\/\?doc=[0-9a-z]{6}$/);
    expect(url).not.toContain(shotRoot);
    expect(url).not.toContain("%");
    // The regression this case was written for: a file path where a review id belongs.
    expect(url).not.toContain("/review/");
    expect(JSON.parse(stdout).png).toBe(doc.replace(/\.md$/, "") + ".png");

    } finally {
      await Bun.spawn([process.execPath, path.join(ROOT, "src/cli.ts"), "stop"], {
        env, stdout: "ignore", stderr: "ignore",
      }).exited;
      fs.rmSync(shotRoot, { recursive: true, force: true });
    }
  }, TEST_TIMEOUT_MS);
});

describe("the two viewer URLs", () => {
  test("address the document differently and escape what they carry", () => {
    expect(reviewViewerUrl(7474, "6f1b-42")).toBe("http://localhost:7474/review/6f1b-42");
    expect(handleViewerUrl(7474, "x7k2m9")).toBe("http://localhost:7474/?doc=x7k2m9");
    // Separators stay literal so the URL reads as a path; see url-path.test.ts.
    expect(pathViewerUrl(7474, "/docs/a b.md")).toBe("http://localhost:7474/?path=/docs/a b.md");
    expect(reviewViewerUrl(7474, "a/b")).toBe("http://localhost:7474/review/a%2Fb");
  });
});
