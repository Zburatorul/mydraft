// Issue #19: per-command help. One table describes every command; the top-level index and the
// individual pages are both rendered from it, so a flag can never be documented in one and not
// the other. Flags here are the ones `src/cli.ts` actually reads — the table is a description of
// the parser, not a wish list.
export type Group = "review" | "source" | "objects" | "output" | "server" | "setup";

export type CommandHelp = {
  group: Group;
  /** Everything after the command name, exactly as it is typed. */
  syntax: string;
  /** Index-column override when the derived short form reads badly. */
  brief?: string;
  /** One line, used verbatim in the index. */
  summary: string;
  detail?: string;
  args?: Array<[string, string]>;
  flags?: Array<[string, string]>;
  /** Extra headed sections — guards, blocking behaviour, lifecycle rules. */
  sections?: Array<[string, string[]]>;
  example: string[];
  seeAlso?: string[];
};

const JSON_FLAG: [string, string] = ["--json", "machine-readable output"];
const DRY_RUN_FLAG: [string, string] = ["--dry-run", "run every check a real write runs (same errors, exit codes); print the unified diff and any positional-id shift; write nothing"];
const GUARD_RULES = [
  "A guard is a hash of the block's own source: it names *what* you planned to edit, not where it sits. Edits elsewhere, replies and resolutions leave it unchanged.",
  "A positional id (`b3`) needs --expect <guard>; if that content has moved, the write fails and names its new position. --target-guard G addresses the block by content alone, with no id.",
  "With a guard, --version is optional, so a batch planned from one listing applies in any order. A named block (`## Results {#results}`) without a guard needs --version. A supplied --version is always enforced (stale: exit 3, nothing written).",
];

export const COMMANDS: Record<string, CommandHelp> = {
  view: {
    group: "review",
    syntax: "<file.md> [--wait] [--timeout S] [--no-open] [--session ID] [--skip-check]",
    summary: "open a review in the viewer; returns immediately unless --wait",
    detail:
      "Creates a review, prints its URL, and locally opens a desktop browser. The default is\n" +
      "asynchronous: the command returns as soon as the review exists, and you read the reviewer's\n" +
      "feedback on a later turn with `myd comments`. Do not poll.",
    args: [["<file.md>", "the Markdown document to review"]],
    flags: [
      ["--wait", "block until the reviewer clicks Done Reviewing (default: return immediately)"],
      ["--timeout S", "seconds to block with --wait (default 1800; must be positive)"],
      ["--no-open", "never launch a desktop browser; the URL is still printed"],
      ["--session ID", "scope the review to one caller (default: $MYD_SESSION, else $CLAUDE_CODE_SESSION_ID)"],
      ["--skip-check", "open the review without the structural preflight"],
      JSON_FLAG,
    ],
    sections: [
      ["Blocking", [
        "Without --wait: nonblocking, exits 0 once the review is created.",
        "With --wait: blocks until Done, then prints the reviewer's note. Exits 1 if the wait times out, or if the review was superseded or archived and can no longer be completed.",
        "Use --wait only when the caller can genuinely block. If it would mean repeated polling, drop the waiter and pick the review up next turn with `myd comments`.",
      ]],
      ["Preflight", [
        "`myd check` runs first, before the server starts. Structural errors print with file and line and exit 2 without creating a review; warnings print and the review opens anyway.",
        "Mermaid is parsed when the document contains a diagram. Use --skip-check to open regardless.",
      ]],
      ["Browser", [
        "Opening a browser is best-effort. A headless host still creates the review, prints the URL, warns on stderr and exits 0; --json reports browserOpened and, on failure, browserError.",
        "With a public origin configured (MYD_PUBLIC_URL) no local browser is launched at all.",
      ]],
    ],
    example: [
      "myd view plans/roadmap.md --json     # returns at once; note the reviewId",
      "# …later turn…",
      "myd comments plans/roadmap.md        # read what came back",
    ],
    seeAlso: ["myd check", "myd wait", "myd comments", "myd guide workflow", "myd guide remote"],
  },
  wait: {
    group: "review",
    syntax: "<file.md> [--timeout S]",
    summary: "block until Done on a review that is already open",
    detail:
      "Always blocking. Subscribes by document path, so a Done landing on any review of this file\n" +
      "ends the wait — unlike `myd view --wait`, which also watches its own review's lifecycle.",
    args: [["<file.md>", "the document whose review to wait on"]],
    flags: [["--timeout S", "seconds to block (default 1800; must be positive)"], JSON_FLAG],
    sections: [["Blocking", ["Exits 1 on timeout, 0 when Done arrives."]]],
    example: ["myd wait plans/roadmap.md --timeout 600"],
    seeAlso: ["myd view", "myd comments"],
  },
  comments: {
    group: "review",
    syntax: "<file.md> [--all]",
    summary: "pending review items (comments, suggestions, replies, notes)",
    detail:
      "Prints each open item with the id that `myd reply` and `myd resolve` take. Read this before\n" +
      "editing: the reviewer's anchors sit in the source you are about to rewrite.",
    args: [["<file.md>", "the reviewed document"]],
    flags: [["--all", "include resolved items and full thread history"], JSON_FLAG],
    sections: [
      ["Lifecycle", [
        "By default, resolved items — and replies whose parent is resolved — are hidden.",
        "An item marked `note` is document-level, produced by Done Reviewing. It has no anchor and is neither replyable nor resolvable, so it reappears on every call until the document changes.",
        "A question for the user belongs in `myd reply`, not in chat; then hand the document back with `myd view`.",
      ]],
    ],
    example: ["myd comments plans/roadmap.md --json"],
    seeAlso: ["myd reply", "myd resolve", "myd guide workflow"],
  },
  reply: {
    group: "review",
    syntax: "<file.md> <id> <message…>",
    summary: "append a reply to one comment or suggestion",
    detail:
      "The message is every remaining argument joined with spaces — quote it to keep punctuation and\n" +
      "spacing intact. Questions for the user go here.",
    args: [["<file.md>", "the reviewed document"], ["<id>", "item id from `myd comments`"], ["<message…>", "reply text"]],
    flags: [["--by NAME", "author recorded on the reply (default AI)"], JSON_FLAG],
    sections: [["Versioning", [
      "Unguarded: a reply always applies and advances the document version.",
      "So any guarded edit that follows needs a fresh `myd blocks --json` — the version you read before replying is now stale.",
    ]]],
    example: ['myd reply plans/roadmap.md c3 "Reworded the second paragraph — does that cover it?"'],
    seeAlso: ["myd comments", "myd resolve"],
  },
  resolve: {
    group: "review",
    syntax: "<file.md> <id> [--summary S]",
    summary: "mark one comment or suggestion resolved",
    args: [["<file.md>", "the reviewed document"], ["<id>", "item id from `myd comments`"]],
    flags: [
      ["--summary S", "what was done, recorded with the resolution"],
      ["--by NAME", "author recorded on the resolution (default AI)"],
      JSON_FLAG,
    ],
    sections: [["Versioning", ["Unguarded, like `myd reply`: it always applies and advances the version."]]],
    example: ['myd resolve plans/roadmap.md c3 --summary "Rewrote the paragraph"'],
    seeAlso: ["myd comments", "myd reply"],
  },
  check: {
    group: "review",
    syntax: "<file.md> [--no-mermaid]",
    summary: "browserless structural validation; myd view runs it first",
    detail:
      "Answers one question: will this document open as a coherent review? It parses the Markdown and\n" +
      "the review endmatter, checks annotation, block and object ids, validates explainer and chart\n" +
      "fences, renders server-side and looks for error blocks, and resolves local references.\n" +
      "`myd view` runs this same check first.",
    args: [["<file.md>", "the document to validate"]],
    flags: [["--no-mermaid", "skip parsing Mermaid fences for this explicit check"], JSON_FLAG],
    sections: [
      ["Exit codes", [
        "0 when there are no errors, even if there are warnings.",
        "2 when any error was found. Warnings never fail the command.",
      ]],
      ["What it cannot see", [
        "This is a structural preflight, not a rendering check: typography, responsive layout, client-side interaction, clipping, overlap and final pixels are all invisible to it.",
        "`myd shot` renders the document in headless Chrome and is the stronger visual check.",
        "Mermaid is parsed only when the document contains a Mermaid fence, so other documents do not load the parser.",
      ]],
    ],
    example: ["myd check plans/roadmap.md --json"],
    seeAlso: ["myd view", "myd shot"],
  },
  blocks: {
    group: "source",
    syntax: "<file.md>",
    summary: "list top-level blocks with ids, types, and guards",
    detail:
      "The source of truth for both --version and --expect. Columns are id, type, guard, first line.\n" +
      "`--json` additionally carries the document version.",
    args: [["<file.md>", "the document to inspect"]],
    flags: [JSON_FLAG],
    sections: [["Versioning", ["Guards hash each block's source, so one listing stays valid for a whole batch: a guard only expires when its own block is edited."]]],
    example: ["myd blocks plans/roadmap.md --json"],
    seeAlso: ["myd block", "myd set-block", "myd guide blocks"],
  },
  block: {
    group: "source",
    syntax: "<file.md> <block-id>",
    summary: "print one block's source",
    detail: "Without --json the raw source goes to stdout, so it pipes straight into an editor or a diff.",
    args: [["<file.md>", "the document"], ["<block-id>", "named id (`results`) or positional id (`b3`) from `myd blocks`"]],
    flags: [JSON_FLAG],
    example: ["myd block plans/roadmap.md results"],
    seeAlso: ["myd blocks", "myd set-block"],
  },
  "set-block": {
    group: "source",
    syntax: "<file.md> (<block-id> [--expect G] | --target-guard G) [--version V] [--file F] [--dry-run]",
    summary: "replace one block's source (guarded)",
    detail: "Reads the replacement from --file, or from stdin when --file is omitted. Trailing whitespace is stripped.",
    args: [["<file.md>", "the document"], ["<block-id>", "named id (`results`) or positional id (`b3`) from `myd blocks`"]],
    flags: [
      ["--version V", "document version from `myd blocks --json`; required unless a guard is given"],
      ["--expect G", "required for positional ids; that block's guard from your planning listing"],
      ["--target-guard G", "address the block by its guard instead of an id"],
      ["--file F", "read the replacement from F instead of stdin"],
      DRY_RUN_FLAG,
      JSON_FLAG,
    ],
    sections: [["Versioning and guards", GUARD_RULES]],
    example: [
      "myd blocks plans/roadmap.md --json                       # plan once: read guards",
      'echo "Rewritten." | myd set-block plans/roadmap.md --target-guard 3e3561b3efaf --json',
    ],
    seeAlso: ["myd blocks", "myd insert", "myd guide blocks"],
  },
  insert: {
    group: "source",
    syntax: "<file.md> (<block-id> [--expect G] | --target-guard G) [--version V] [--before] [--file F] [--dry-run]",
    summary: "insert new content after (or before) a block (guarded)",
    detail: "Reads the new content from --file, or from stdin when --file is omitted. Same guard rules as set-block.",
    args: [["<file.md>", "the document"], ["<block-id>", "the block to insert relative to"]],
    flags: [
      ["--version V", "document version from `myd blocks --json`; required unless a guard is given"],
      ["--expect G", "required for positional ids; that block's guard from your planning listing"],
      ["--target-guard G", "address the block by its guard instead of an id"],
      ["--before", "insert before the block instead of after it"],
      ["--file F", "read the new content from F instead of stdin"],
      DRY_RUN_FLAG,
      JSON_FLAG,
    ],
    sections: [["Versioning and guards", GUARD_RULES]],
    example: ['echo "## Risks" | myd insert plans/roadmap.md results --version 7 --before'],
    seeAlso: ["myd blocks", "myd set-block", "myd guide blocks"],
  },
  objects: {
    group: "objects",
    syntax: "<file.md>",
    summary: "list patchable semantic objects as block›target",
    detail: "`--json` carries the document version that `myd set-object` requires.",
    args: [["<file.md>", "the document to inspect"]],
    flags: [JSON_FLAG],
    example: ["myd objects plans/roadmap.md --json"],
    seeAlso: ["myd object", "myd set-object", "myd guide explainers"],
  },
  object: {
    group: "objects",
    syntax: "<file.md> <block›target>",
    summary: "print one semantic object's editable YAML",
    args: [["<file.md>", "the document"], ["<block›target>", "object ref from `myd objects`"]],
    flags: [JSON_FLAG],
    example: ["myd object plans/roadmap.md arch›db"],
    seeAlso: ["myd objects", "myd set-object"],
  },
  "set-object": {
    group: "objects",
    syntax: "<file.md> <block›target> --version V [--file F] [--dry-run]",
    summary: "replace one semantic object with validated YAML (guarded)",
    detail:
      "Reads YAML from --file, or from stdin when --file is omitted. The replacement is schema-validated\n" +
      "before it is written, so an invalid object fails without touching the file.",
    args: [["<file.md>", "the document"], ["<block›target>", "object ref from `myd objects`"]],
    flags: [
      ["--version V", "required; document version from `myd objects --json`"],
      ["--file F", "read the replacement YAML from F instead of stdin"],
      DRY_RUN_FLAG,
      JSON_FLAG,
    ],
    sections: [["Versioning", [
      "--version comes from `myd objects --json`; a stale one fails with exit 3 and writes nothing.",
      "No --expect: objects are addressed by name, so there is no positional guard to keep in sync.",
    ]]],
    example: ["myd set-object plans/roadmap.md arch›db --version 7 --file patched.yaml"],
    seeAlso: ["myd objects", "myd object", "myd guide explainers"],
  },
  shot: {
    group: "output",
    syntax: "<file.md> [out.png] [--width W] [--height H]",
    summary: "screenshot the rendered document (headless Chrome)",
    detail: "Requires google-chrome, chromium, or chromium-browser on PATH; without one the command fails.",
    args: [["<file.md>", "the document to render"], ["[out.png]", "output path (default: the document with a .png extension)"]],
    flags: [["--width W", "viewport width in pixels (default 1200)"], ["--height H", "viewport height in pixels (default 1600)"], JSON_FLAG],
    example: ["myd shot plans/roadmap.md --width 900"],
    seeAlso: ["myd export"],
  },
  export: {
    group: "output",
    syntax: "<file.md> [out.html]",
    summary: "single self-contained HTML (delivery artifact)",
    args: [["<file.md>", "the document to export"], ["[out.html]", "output path (default: the document with a .html extension)"]],
    flags: [JSON_FLAG],
    example: ["myd export plans/roadmap.md"],
    seeAlso: ["myd publish", "myd guide export"],
  },
  publish: {
    group: "output",
    syntax: "<file.md> [--output-dir DIR] [--profile NAME]",
    summary: "immutable release bundle + archive index",
    args: [["<file.md>", "the document to publish"]],
    flags: [["--output-dir DIR", "where the bundle is written"], ["--profile NAME", "named publish profile"], JSON_FLAG],
    example: ["myd publish plans/roadmap.md --profile internal"],
    seeAlso: ["myd export", "myd guide export"],
  },
  diff: {
    group: "output",
    syntax: "<old.md> <new.md> [out.md]",
    summary: "CriticMarkup diff between two versions",
    detail: "Runs bin/rd-diff, so python3 must be available. Exits with that tool's status.",
    args: [["<old.md>", "the earlier version"], ["<new.md>", "the later version"], ["[out.md]", "output path (default: stdout)"]],
    example: ["myd diff plans/roadmap.v1.md plans/roadmap.md review.md"],
    seeAlso: ["myd guide criticmarkup"],
  },
  serve: {
    group: "server",
    syntax: "[--public-url URL]",
    brief: "",
    summary: "run the server in the foreground",
    detail:
      "Other commands start the server on demand; use this to watch it, or to record a public origin\n" +
      "for the whole deployment.",
    flags: [["--public-url URL", "origin remote reviewers use (else $MYD_PUBLIC_URL); enables remote review"]],
    sections: [["Remote", [
      "A public URL with a path prefix, a non-HTTP scheme, or a query/fragment is rejected rather than printed: the viewer loads /web and /api from the origin root.",
      "Anyone who can reach that origin can open, annotate and complete every review on the server — the inbox lists them all. Restrict the proxy accordingly.",
    ]]],
    example: ["myd serve --public-url https://review.example.test"],
    seeAlso: ["myd status", "myd guide remote"],
  },
  status: {
    group: "server",
    syntax: "",
    summary: "report whether the server is running, and on which port",
    detail: "Also prints the public review origin when one is configured.",
    flags: [JSON_FLAG],
    example: ["myd status --json"],
    seeAlso: ["myd serve", "myd stop"],
  },
  stop: {
    group: "server",
    syntax: "",
    summary: "stop the running server",
    detail: "Open reviews are not completed by this; a later command starts a fresh server on demand.",
    flags: [JSON_FLAG],
    example: ["myd stop"],
    seeAlso: ["myd serve", "myd status"],
  },
  guide: {
    group: "setup",
    syntax: "[topic]",
    summary: "the agent guide; a command name resolves to its topic",
    detail:
      "Conceptual guidance, as opposed to `myd help <command>`, which is a command reference.\n" +
      "Topics: workflow, blocks, objects, explainers, rich, criticmarkup, export, api, remote.\n" +
      "A command name is accepted too — `myd guide set-block` prints the blocks topic.",
    args: [["[topic]", "topic or command name; omit for the whole guide"]],
    example: ["myd guide workflow"],
    seeAlso: ["myd help"],
  },
  "install-prompt": {
    group: "setup",
    syntax: "[--claude|--codex|--file F] [--remove]",
    brief: "",
    summary: "(re)install the myd block into agent instruction files",
    detail:
      "Idempotent: it replaces the marker-delimited block rather than appending, and symlinks skill/\n" +
      "into each agent's skills directory. Defaults to both Claude and Codex targets.",
    flags: [
      ["--claude", "only ~/.claude/CLAUDE.md and ~/.claude/skills/myd"],
      ["--codex", "only $CODEX_HOME/AGENTS.md and its skills directory"],
      ["--file F", "target an arbitrary instruction file instead (no skill symlink)"],
      ["--remove", "uninstall the managed block and the skill symlink"],
      JSON_FLAG,
    ],
    example: ["myd install-prompt --claude"],
    seeAlso: ["myd guide workflow"],
  },
  help: {
    group: "setup",
    syntax: "[command]",
    summary: "this index, or one command's page",
    detail: "`myd <command> --help` prints the same page.",
    args: [["[command]", "command to describe; omit for the index"]],
    example: ["myd help set-block"],
    seeAlso: ["myd guide"],
  },
};

const GROUP_TITLES: Array<[Group, string]> = [
  ["review", "Review"],
  ["source", "Source (guarded editing)"],
  ["objects", "Semantic objects"],
  ["output", "Output"],
  ["server", "Server"],
  ["setup", "Setup and docs"],
];

const column = (rows: Array<[string, string]>, indent: string) => {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, text]) => `${indent}${label.padEnd(width)}  ${text}`);
};

/**
 * The index carries arguments but not flags — a full syntax line is the command page's job, and
 * repeating it here is exactly the duplication issue #19 asks the index to stop doing.
 */
const brief = (help: CommandHelp) => help.brief ?? help.syntax.split(/\s(?=--|\[--)/)[0]!;

/** The compact index: one line per command, generated from the same table as the pages. */
export function topLevelHelp(): string {
  const lines = ["myd — Markdown viewer + annotations + agent CLI", ""];
  for (const [group, title] of GROUP_TITLES) {
    const rows = Object.entries(COMMANDS)
      .filter(([, help]) => help.group === group)
      .map(([name, help]) => [`${name} ${brief(help)}`.trim(), help.summary] as [string, string]);
    if (!rows.length) continue;
    lines.push(`${title}:`, ...column(rows, "  "), "");
  }
  lines.push(
    "Every command takes --json for machine-readable output.",
    "",
    "myd help <command>   flags, guards, and an example for one command",
    "myd guide [topic]    the conceptual guide (workflow, blocks, objects, explainers,",
    "                     rich, criticmarkup, export, api, remote)",
  );
  return lines.join("\n");
}

/** One command's page, or null when the name is not a command. */
export function commandHelp(name: string): string | null {
  const help = COMMANDS[name];
  if (!help) return null;
  const lines = [`myd ${name} — ${help.summary}`, "", `  myd ${name} ${help.syntax}`.trimEnd(), ""];
  if (help.detail) lines.push(help.detail, "");
  if (help.args?.length) lines.push("Arguments", ...column(help.args, "  "), "");
  if (help.flags?.length) lines.push("Flags", ...column(help.flags, "  "), "");
  for (const [title, items] of help.sections ?? []) {
    lines.push(title, ...items.map((item) => `  - ${item}`), "");
  }
  lines.push("Example", ...help.example.map((line) => `  ${line}`));
  if (help.seeAlso?.length) lines.push("", `See also: ${help.seeAlso.join(" · ")}`);
  return lines.join("\n");
}

/** Commands close enough to a typo to be worth suggesting. */
export function nearest(name: string): string[] {
  const distance = (a: string, b: string) => {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      previous = row;
    }
    return previous[b.length]!;
  };
  return Object.keys(COMMANDS)
    .filter((candidate) => candidate.startsWith(name) || name.startsWith(candidate) || distance(candidate, name) <= 2)
    .slice(0, 3);
}

/**
 * An unknown command points at the command list rather than reprinting it: the index is one
 * command away, and burying a one-line error under forty lines of help hides the error.
 */
export function unknownCommand(name: string): string {
  const suggestions = nearest(name);
  return [
    `unknown command: ${name}`,
    ...(suggestions.length ? [`did you mean: ${suggestions.join(", ")}?`] : []),
    "",
    "myd help              list every command",
    "myd help <command>    one command's flags, guards, and an example",
  ].join("\n");
}
