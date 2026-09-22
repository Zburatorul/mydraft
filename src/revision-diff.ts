export type RevisionDiffLine = {
  kind: "context" | "added" | "removed";
  text: string;
};

export type RevisionDiffHunk = {
  beforeStart: number;
  afterStart: number;
  lines: RevisionDiffLine[];
};

function splitLines(source: string): string[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** A line diff optimized for review documents. The normal path uses LCS for readable hunks;
 *  very large rewrites fall back to a bounded prefix/suffix comparison rather than allocating
 *  a quadratic table. */
function diffLines(before: string[], after: string[]): RevisionDiffLine[] {
  const cells = before.length * after.length;
  if (cells > 2_000_000) {
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) suffix++;
    return [
      ...before.slice(0, prefix).map((text) => ({ kind: "context" as const, text })),
      ...before.slice(prefix, before.length - suffix).map((text) => ({ kind: "removed" as const, text })),
      ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: "added" as const, text })),
      ...before.slice(before.length - suffix).map((text) => ({ kind: "context" as const, text })),
    ];
  }

  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i]![j] = before[i] === after[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: RevisionDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push({ kind: "context", text: before[i]! });
      i++;
      j++;
    } else if (j < after.length && (i >= before.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ kind: "added", text: after[j]! });
      j++;
    } else {
      lines.push({ kind: "removed", text: before[i]! });
      i++;
    }
  }
  return lines;
}

export function revisionDiff(beforeSource: string, afterSource: string, context = 2): RevisionDiffHunk[] {
  const lines = diffLines(splitLines(beforeSource), splitLines(afterSource));
  const changed = lines.flatMap((line, index) => line.kind === "context" ? [] : [index]);
  if (!changed.length) return [];

  const windows: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const last = windows.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }

  let beforeLine = 1;
  let afterLine = 1;
  const positions = lines.map((line) => {
    const position = { before: beforeLine, after: afterLine };
    if (line.kind !== "added") beforeLine++;
    if (line.kind !== "removed") afterLine++;
    return position;
  });
  return windows.map(([start, end]) => ({
    beforeStart: positions[start]!.before,
    afterStart: positions[start]!.after,
    lines: lines.slice(start, end),
  }));
}
