import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadDoc } from "./doc.ts";
import { assertNoExportRenderErrors, exportHtml } from "./export.ts";

const PACKAGE = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")) as { version: string };
const RELEASE_LAYOUT = { source: "source.md", artifact: "index.html", manifest: "manifest.json" } as const;

export type PublishOptions = {
  outputDir?: string;
  profile?: string;
};

export type PublishResult = {
  releaseId: string;
  releaseDir: string;
  manifestPath: string;
  artifactPath: string;
  archivePath: string;
};

type ArchiveRelease = {
  releaseId: string;
  createdAt: string;
  profile: string;
  manifest: string;
  artifact: string;
};

type ArchiveIndex = {
  schemaVersion: 1;
  current: string | null;
  releases: ArchiveRelease[];
};

const sha256 = (value: string | Buffer): string => crypto.createHash("sha256").update(value).digest("hex");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function createReleaseId(createdAt: string, sourceHash: string): string {
  return `${createdAt.replace(/[-:.]/g, "")}-${sourceHash.slice(0, 12)}`;
}

function defaultOutputDir(source: string): string {
  const stem = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9._-]+/g, "-") || "document";
  return path.join(path.dirname(source), ".myd-publish", stem);
}

function readArchive(archivePath: string): ArchiveIndex {
  if (!fs.existsSync(archivePath)) return { schemaVersion: 1, current: null, releases: [] };
  const parsed = JSON.parse(fs.readFileSync(archivePath, "utf8")) as Partial<ArchiveIndex>;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.releases)) {
    throw new Error(`unsupported publish archive: ${archivePath}`);
  }
  return { schemaVersion: 1, current: typeof parsed.current === "string" ? parsed.current : null, releases: parsed.releases };
}

function writeAtomic(file: string, content: string): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
}

function acquirePublishLock(outputDir: string): () => void {
  const lockPath = path.join(outputDir, ".publish.lock");
  let descriptor: number;
  try {
    descriptor = fs.openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner = "";
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: unknown; acquiredAt?: unknown };
      if (typeof lock.pid === "number") owner = ` (pid ${lock.pid}${typeof lock.acquiredAt === "string" ? ` since ${lock.acquiredAt}` : ""})`;
    } catch {}
    throw new Error(`publish already in progress or a stale lock remains for ${outputDir}${owner}; inspect ${lockPath} before removing it`);
  }
  try {
    fs.writeFileSync(descriptor, json({ pid: process.pid, acquiredAt: new Date().toISOString() }));
  } catch (error) {
    fs.closeSync(descriptor);
    fs.rmSync(lockPath);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.closeSync(descriptor);
    if (fs.existsSync(lockPath)) fs.rmSync(lockPath);
  };
}

export async function publishDocument(source: string, options: PublishOptions = {}): Promise<PublishResult> {
  const sourcePath = path.resolve(source);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw new Error(`no such source document: ${sourcePath}`);

  const profile = options.profile?.trim() || "default";
  const outputDir = path.resolve(options.outputDir ?? defaultOutputDir(sourcePath));
  const releasesDir = path.join(outputDir, "releases");
  const archivePath = path.join(outputDir, "index.json");
  const sourceText = fs.readFileSync(sourcePath, "utf8");
  const sourceHash = sha256(sourceText);
  const createdAt = new Date().toISOString();
  const releaseId = createReleaseId(createdAt, sourceHash);
  const finalReleaseDir = path.join(releasesDir, releaseId);

  fs.mkdirSync(outputDir, { recursive: true });
  const releaseLock = acquirePublishLock(outputDir);
  let stagingDir: string | null = null;
  let releaseCommitted = false;

  try {
    fs.mkdirSync(releasesDir, { recursive: true });
    if (fs.existsSync(finalReleaseDir)) throw new Error(`release already exists: ${releaseId}`);
    stagingDir = fs.mkdtempSync(path.join(outputDir, `.staging-${releaseId}-`));
    const doc = loadDoc(sourcePath, sourceText);
    const html = await exportHtml(doc);
    assertNoExportRenderErrors(html);

    const manifest = {
      schemaVersion: 1,
      releaseId,
      createdAt,
      profile,
      source: {
        file: RELEASE_LAYOUT.source,
        originalName: path.basename(sourcePath),
        originalPath: sourcePath,
        sha256: sourceHash,
        bytes: Buffer.byteLength(sourceText),
      },
      artifact: {
        file: RELEASE_LAYOUT.artifact,
        mediaType: "text/html",
        sha256: sha256(html),
        bytes: Buffer.byteLength(html),
      },
      checks: [{ id: "server-render-errors", status: "passed" }],
      tool: { name: "myd", version: PACKAGE.version },
    };

    fs.writeFileSync(path.join(stagingDir, RELEASE_LAYOUT.source), sourceText);
    fs.writeFileSync(path.join(stagingDir, RELEASE_LAYOUT.artifact), html);
    fs.writeFileSync(path.join(stagingDir, RELEASE_LAYOUT.manifest), json(manifest));
    fs.renameSync(stagingDir, finalReleaseDir);
    releaseCommitted = true;

    const previous = readArchive(archivePath);
    const entry: ArchiveRelease = {
      releaseId,
      createdAt,
      profile,
      manifest: `releases/${releaseId}/${RELEASE_LAYOUT.manifest}`,
      artifact: `releases/${releaseId}/${RELEASE_LAYOUT.artifact}`,
    };
    writeAtomic(archivePath, json({ schemaVersion: 1, current: releaseId, releases: [entry, ...previous.releases] } satisfies ArchiveIndex));

    return {
      releaseId,
      releaseDir: finalReleaseDir,
      manifestPath: path.join(finalReleaseDir, RELEASE_LAYOUT.manifest),
      artifactPath: path.join(finalReleaseDir, RELEASE_LAYOUT.artifact),
      archivePath,
    };
  } catch (error) {
    if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    if (releaseCommitted && fs.existsSync(finalReleaseDir)) fs.rmSync(finalReleaseDir, { recursive: true, force: true });
    throw error;
  } finally {
    releaseLock();
  }
}
