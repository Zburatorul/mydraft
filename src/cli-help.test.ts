// Issue #19: focused per-command help. The value of a help page is that it is *true*, so most of
// these tests check the table against `src/cli.ts` itself rather than against a fixed string:
// a command added without a page, or a flag documented that the parser never reads, fails here.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { COMMANDS, commandHelp, nearest, topLevelHelp, unknownCommand } from "./cli-help.ts";

const CLI = path.resolve(import.meta.dir, "cli.ts");
const cliSource = fs.readFileSync(CLI, "utf8");

/** Command names the switch in cli.ts actually dispatches on. */
const dispatched = new Set(
  [...cliSource.matchAll(/case "([^"]+)":/g)].map((m) => m[1]!).filter((name) => name !== "--help"),
);
/** Flag names cli.ts actually reads, in either access form. */
const parsed = new Set([
  ...[...cliSource.matchAll(/flags\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]!),
  ...[...cliSource.matchAll(/flags\["([^"]+)"\]/g)].map((m) => m[1]!),
]);

async function myd(...args: string[]) {
  const child = Bun.spawn([process.execPath, CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("the help table describes the real CLI", () => {
  test("every dispatched command has a help page", () => {
    const undocumented = [...dispatched].filter((name) => !COMMANDS[name]);
    expect(undocumented).toEqual([]);
  });

  test("every help page names a command the CLI dispatches", () => {
    const phantom = Object.keys(COMMANDS).filter((name) => !dispatched.has(name));
    expect(phantom).toEqual([]);
  });

  test("every documented flag is a flag the parser reads", () => {
    const invented: string[] = [];
    for (const [name, help] of Object.entries(COMMANDS)) {
      for (const [label] of help.flags ?? []) {
        const flag = label.replace(/^--/, "").split(" ")[0]!;
        if (!parsed.has(flag)) invented.push(`${name}: --${flag}`);
      }
    }
    expect(invented).toEqual([]);
  });
});

describe("each command page", () => {
  const names = Object.keys(COMMANDS);

  test("renders syntax, a summary, and exactly one example section", () => {
    for (const name of names) {
      const page = commandHelp(name)!;
      expect(page).toStartWith(`myd ${name} — `);
      expect(page).toContain(`  myd ${name}`);
      // "one representative example", not a gallery.
      expect(page.split("\nExample\n").length).toBe(2);
      expect(COMMANDS[name]!.example.length).toBeGreaterThan(0);
    }
  });

  test("documents every argument that appears in its syntax", () => {
    for (const name of names) {
      const help = COMMANDS[name]!;
      const positional = [...help.syntax.matchAll(/(?:^|\s)(<[^>]+>|\[[a-z][^\]]*\])/g)].map((m) => m[1]!);
      const documented = new Set((help.args ?? []).map(([label]) => label));
      for (const argument of positional) expect(documented).toContain(argument);
    }
  });

  test("mutation commands state their version and guard requirements", () => {
    for (const name of ["set-block", "insert", "set-object"]) {
      const page = commandHelp(name)!;
      expect(page).toContain("--version");
      expect(page).toMatch(/required/);
      expect(page).toContain("exit 3");
    }
    // Positional ids need a guard; object refs are addressed by name and say why they do not.
    expect(commandHelp("set-block")!).toContain("--expect");
    expect(commandHelp("insert")!).toContain("--expect");
    expect(commandHelp("set-object")!).toContain("No --expect");
  });

  test("unguarded mutations say so, since callers reasonably assume the opposite", () => {
    for (const name of ["reply", "resolve"]) {
      expect(commandHelp(name)!).toMatch(/Unguarded|advances the (document )?version/);
    }
  });

  test("review commands explain blocking versus nonblocking", () => {
    expect(commandHelp("view")!).toContain("returns immediately");
    expect(commandHelp("view")!).toMatch(/Without --wait: nonblocking/);
    expect(commandHelp("view")!).toMatch(/With --wait: blocks/);
    expect(commandHelp("wait")!).toContain("Always blocking");
  });

  test("comments explains the note lifecycle constraint", () => {
    const page = commandHelp("comments")!;
    expect(page).toContain("Done Reviewing");
    expect(page).toContain("neither replyable nor resolvable");
    expect(page).toContain("--all");
  });

  test("defaults are stated wherever one exists", () => {
    expect(commandHelp("view")!).toContain("default 1800");
    expect(commandHelp("shot")!).toContain("default 1200");
    expect(commandHelp("shot")!).toContain("default 1600");
    expect(commandHelp("reply")!).toContain("default AI");
  });
});

describe("the top-level index stays an index", () => {
  const index = topLevelHelp();

  test("lists every command exactly once, with its summary", () => {
    for (const [name, help] of Object.entries(COMMANDS)) {
      expect(index).toContain(help.summary);
      expect(index.match(new RegExp(`^  ${name}(?= |$)`, "gm"))?.length ?? 0).toBe(1);
    }
  });

  test("does not duplicate the command pages", () => {
    // Per-command sections belong on the pages. The index may mention --json once, globally,
    // which is the compact form rather than a duplication of twenty identical flag rows.
    for (const heading of ["Arguments", "Flags", "Example", "See also", "Versioning"]) {
      expect(index).not.toContain(heading);
    }
    expect(index).not.toContain("--expect");
    expect(index.match(/--json/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(index.split("\n").length).toBeLessThan(50);
  });

  test("points at the per-command pages and the guide", () => {
    expect(index).toContain("myd help <command>");
    expect(index).toContain("myd guide");
  });

  test("stays within a readable terminal width", () => {
    for (const line of index.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
  });
});

describe("unknown commands", () => {
  test("suggest the nearest command and point at the list", () => {
    const message = unknownCommand("setblock");
    expect(message).toContain("unknown command: setblock");
    expect(message).toContain("set-block");
    expect(message).toContain("myd help");
    // Pointing at the list, not reprinting it — the error must not be buried.
    expect(message.split("\n").length).toBeLessThan(8);
  });

  test("still help when nothing is close", () => {
    const message = unknownCommand("zzzz");
    expect(message).toContain("unknown command: zzzz");
    expect(message).toContain("myd help");
  });

  test("nearest matches on prefix as well as edit distance", () => {
    expect(nearest("set-")).toContain("set-block");
    expect(nearest("viewx")).toContain("view");
  });
});

describe("the CLI entry points", () => {
  test("`myd help <cmd>` and `myd <cmd> --help` render the same page", async () => {
    for (const name of ["view", "set-block", "comments"]) {
      const viaHelp = await myd("help", name);
      const viaFlag = await myd(name, "--help");
      expect(viaHelp.exitCode).toBe(0);
      expect(viaFlag.exitCode).toBe(0);
      expect(viaFlag.stdout).toBe(viaHelp.stdout);
      expect(viaHelp.stdout).toContain(`myd ${name} — `);
    }
  });

  test("--help never runs the command, so it needs no file and no server", async () => {
    // `myd set-block` without a file normally dies on the missing argument.
    const result = await myd("set-block", "--help");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--version V");
  });

  test("bare `myd` and `myd help` both print the index", async () => {
    const bare = await myd();
    const explicit = await myd("help");
    expect(bare.exitCode).toBe(0);
    expect(bare.stdout).toBe(explicit.stdout);
    expect(bare.stdout).toContain("Markdown viewer");
  });

  test("an unknown command fails with the short error, not the whole index", async () => {
    const result = await myd("setblock");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("did you mean: set-block?");
    expect(result.stderr).not.toContain("Review:");
  });

  test("`myd guide` advertises only topics it can actually resolve", async () => {
    const rejected = await myd("guide", "nope");
    const advertised = /topics: (.+)$/m.exec(rejected.stderr)![1]!.trim().split(/\s+/);
    for (const topic of advertised) {
      const result = await myd("guide", topic);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toStartWith(`## ${topic}`);
    }
  }, 15000); // Exercises every advertised topic through a fresh CLI process.
});
