import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishDocument } from "./publish.ts";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myd-publish-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("publishDocument", () => {
  test("publishes an immutable HTML release and advances the archive index", async () => {
    const root = workspace();
    const source = path.join(root, "wip.md");
    const outputDir = path.join(root, "published");
    fs.writeFileSync(source, "# Local decisions\n\nEvidence stays inspectable.\n");

    const result = await publishDocument(source, { outputDir, profile: "research" });

    expect(result.releaseId).toMatch(/^\d{8}T\d{9}Z-[a-f0-9]{12}$/);
    expect(result.releaseDir).toBe(path.join(outputDir, "releases", result.releaseId));
    expect(fs.readFileSync(path.join(result.releaseDir, "source.md"), "utf8")).toBe(
      "# Local decisions\n\nEvidence stays inspectable.\n",
    );
    expect(fs.readFileSync(path.join(result.releaseDir, "index.html"), "utf8")).toContain(
      "<title>Local decisions</title>",
    );

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      releaseId: result.releaseId,
      profile: "research",
      source: { file: "source.md", originalName: "wip.md" },
      artifact: { file: "index.html", mediaType: "text/html" },
      checks: [{ id: "server-render-errors", status: "passed" }],
      tool: { name: "myd", version: "0.0.1" },
    });
    expect(manifest.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);

    const archive = JSON.parse(fs.readFileSync(path.join(outputDir, "index.json"), "utf8"));
    expect(archive).toEqual({
      schemaVersion: 1,
      current: result.releaseId,
      releases: [{
        releaseId: result.releaseId,
        createdAt: manifest.createdAt,
        profile: "research",
        manifest: `releases/${result.releaseId}/manifest.json`,
        artifact: `releases/${result.releaseId}/index.html`,
      }],
    });
  });

  test("publishes through the myd CLI", async () => {
    const root = workspace();
    const source = path.join(root, "brief.md");
    const outputDir = path.join(root, "published");
    fs.writeFileSync(source, "# CLI release\n\nA small public seam.\n");

    const child = Bun.spawn([
      process.execPath,
      path.resolve(import.meta.dir, "cli.ts"),
      "publish",
      source,
      "--output-dir",
      outputDir,
      "--profile",
      "research",
      "--json",
    ], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.releaseId).toBe(JSON.parse(fs.readFileSync(path.join(outputDir, "index.json"), "utf8")).current);
    expect(fs.existsSync(result.manifestPath)).toBe(true);
  }, 30_000);

  test("keeps the previous release current when validation fails", async () => {
    const root = workspace();
    const source = path.join(root, "wip.md");
    const outputDir = path.join(root, "published");
    fs.writeFileSync(source, "# Accepted release\n\nThis version is recoverable.\n");
    const accepted = await publishDocument(source, { outputDir, profile: "research" });
    const archiveBefore = fs.readFileSync(accepted.archivePath, "utf8");
    const artifactBefore = fs.readFileSync(accepted.artifactPath, "utf8");

    fs.writeFileSync(source, [
      "# Broken release",
      "",
      "```explainer",
      "title: Missing evidence",
      "sections:",
      "  - type: measurements",
      "    id: evidence",
      "    cards: []",
      "```",
      "",
    ].join("\n"));

    await expect(publishDocument(source, { outputDir, profile: "research" })).rejects.toThrow(
      "server-render-errors check failed",
    );

    expect(fs.readFileSync(accepted.archivePath, "utf8")).toBe(archiveBefore);
    expect(fs.readFileSync(accepted.artifactPath, "utf8")).toBe(artifactBefore);
    expect(fs.readdirSync(path.join(outputDir, "releases"))).toEqual([accepted.releaseId]);
    expect(fs.readdirSync(outputDir).filter((name) => name.startsWith(".staging-"))).toEqual([]);
  }, 15_000);

  test("archives the previous source and artifact when a new release succeeds", async () => {
    const root = workspace();
    const source = path.join(root, "wip.md");
    const outputDir = path.join(root, "published");
    fs.writeFileSync(source, "# Result\n\nValue: 0.68\n");
    const first = await publishDocument(source, { outputDir, profile: "research" });
    const firstArtifact = fs.readFileSync(first.artifactPath, "utf8");

    fs.writeFileSync(source, "# Result\n\nValue: 0.73\n");
    const second = await publishDocument(source, { outputDir, profile: "research" });
    const archive = JSON.parse(fs.readFileSync(second.archivePath, "utf8"));

    expect(archive.current).toBe(second.releaseId);
    expect(archive.releases.map((release: { releaseId: string }) => release.releaseId)).toEqual([
      second.releaseId,
      first.releaseId,
    ]);
    expect(fs.readFileSync(path.join(first.releaseDir, "source.md"), "utf8")).toBe("# Result\n\nValue: 0.68\n");
    expect(fs.readFileSync(first.artifactPath, "utf8")).toBe(firstArtifact);
  }, 20_000);

  test("rejects a concurrent publisher instead of losing an archive entry", async () => {
    const root = workspace();
    const source = path.join(root, "wip.md");
    const outputDir = path.join(root, "published");
    fs.writeFileSync(source, "# Contended release\n\nOnly one publisher may commit at a time.\n");

    const attempts = await Promise.allSettled([
      publishDocument(source, { outputDir, profile: "research" }),
      publishDocument(source, { outputDir, profile: "research" }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const rejection = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");
    expect(String(rejection?.reason)).toContain("publish already in progress");
    const archive = JSON.parse(fs.readFileSync(path.join(outputDir, "index.json"), "utf8"));
    expect(archive.releases).toHaveLength(1);
    expect(fs.existsSync(path.join(outputDir, ".publish.lock"))).toBe(false);
  }, 15_000);

  test("does not race to reclaim a stale publish lock", async () => {
    const root = workspace();
    const source = path.join(root, "wip.md");
    const outputDir = path.join(root, "published");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(source, "# Stale lock\n\nRecovery must be explicit.\n");
    fs.writeFileSync(path.join(outputDir, ".publish.lock"), '{"pid":999999999,"acquiredAt":"2026-01-01T00:00:00.000Z"}\n');

    const attempts = await Promise.allSettled([
      publishDocument(source, { outputDir }),
      publishDocument(source, { outputDir }),
    ]);

    expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "index.json"))).toBe(false);
    expect(fs.readFileSync(path.join(outputDir, ".publish.lock"), "utf8")).toContain("999999999");
  });
});
