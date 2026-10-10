import { hashVersion, loadDoc, type Doc, type ReviewItem } from "./doc.ts";
import { diffExplainers, type ExplainerChange } from "./explainer-diff.ts";
import { topBlocks, topCodeFences, type Block } from "./render.ts";

export type ReviewChangeKind = "added" | "modified" | "removed" | "moved";

export type ReviewChangeBlock = {
  blockId: string;
  index: number;
  head: string;
  source: string;
};

export type ReviewChange = {
  id: string;
  kind: ReviewChangeKind;
  before: ReviewChangeBlock | null;
  after: ReviewChangeBlock | null;
  insertBeforeBlockId: string | null;
  summary: string;
  priorItemIds: string[];
  contextItemIds?: string[];
  semanticChanges: ExplainerChange[];
};

export type ReviewChangeSet = {
  changes: ReviewChange[];
  unchangedAfterBlockIds: string[];
};

type DescribedBlock = {
  block: Block;
  source: string;
  section: string;
  sectionIndex: number | null;
  words: Set<string>;
};

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const STOP_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "with"]);

function wordTokens(value: string): Set<string> {
  return new Set(
    [...WORD_SEGMENTER.segment(value.normalize("NFKC").toLowerCase())]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
      .filter((word) => !STOP_WORDS.has(word)),
  );
}

// Block types are h1–h6 for headings; "html" also starts with "h", so match the whole type.
function isHeading(block: { type: string }): boolean {
  return /^h[1-6]$/.test(block.type);
}

function describeBlocks(doc: Doc): DescribedBlock[] {
  let section = "document";
  let sectionIndex: number | null = null;
  return topBlocks(doc).map((block, index) => {
    const source = doc.clean.slice(doc.origToClean(block.start), doc.origToClean(block.end)).trimEnd();
    if (isHeading(block)) {
      section = block.name ?? source.replace(/^#{1,6}\s+/, "").replace(/\s+\{#[^}]+\}\s*$/, "");
      sectionIndex = index;
    }
    return { block, source, section, sectionIndex, words: wordTokens(source) };
  });
}

function blockView(value: DescribedBlock): ReviewChangeBlock {
  return {
    blockId: value.block.id,
    index: value.block.index,
    head: value.source.split("\n")[0]!.slice(0, 80),
    source: value.source,
  };
}

function summary(value: DescribedBlock): string {
  const first = value.source.split("\n").find((line) => line.trim())?.trim() ?? "Changed region";
  const plain = first
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+\{#[^}]+\}\s*$/, "")
    .replace(/^```\S*\s*/, "")
    .trim();
  return (plain || value.block.type).slice(0, 120);
}

function itemIdsInBlock(items: ReviewItem[], value: DescribedBlock): string[] {
  const positional = `b${value.block.index}`;
  return items
    .filter((item) => !item.parentId)
    .filter((item) => item.anchor?.block === value.block.id
      || item.anchor?.block === positional
      || (item.offset >= value.block.start && item.offset < value.block.end))
    .map((item) => item.id);
}

function wordSimilarity(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return intersection / new Set([...left, ...right]).size;
}

function movedBeforeIndices(matchedPairs: Array<[number, number]>): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(matchedPairs.length).fill(-1);
  for (let index = 0; index < matchedPairs.length; index++) {
    const afterIndex = matchedPairs[index]![1];
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (matchedPairs[tails[middle]!]![1] < afterIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const stable = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) stable.add(index);
  return new Set(matchedPairs.flatMap(([beforeIndex], index) => stable.has(index) ? [] : [beforeIndex]));
}

export function buildReviewChangeSet(input: { beforeSource: string; afterSource: string }): ReviewChangeSet {
  const beforeDoc = loadDoc("before.md", input.beforeSource);
  const afterDoc = loadDoc("after.md", input.afterSource);
  const before = describeBlocks(beforeDoc);
  const after = describeBlocks(afterDoc);
  const afterContentKeys = after.map((candidate) => hashVersion(candidate.source).slice(0, 12));
  const beforeMatch = new Map<number, number>();
  const afterMatch = new Map<number, number>();
  const contextualBeforeMatches = new Set<number>();

  const pair = (beforeIndex: number, afterIndex: number, contextual = false) => {
    beforeMatch.set(beforeIndex, afterIndex);
    afterMatch.set(afterIndex, beforeIndex);
    if (contextual) contextualBeforeMatches.add(beforeIndex);
  };
  const pairSimilar = (beforeIndices: number[], afterIndices: number[], contextual = false) => {
    const candidates = beforeIndices.flatMap((beforeIndex) => afterIndices.map((afterIndex) => ({
      beforeIndex,
      afterIndex,
      score: wordSimilarity(before[beforeIndex]!.words, after[afterIndex]!.words),
    }))).sort((left, right) => right.score - left.score);
    for (const candidate of candidates) {
      if (candidate.score < .3 || beforeMatch.has(candidate.beforeIndex) || afterMatch.has(candidate.afterIndex)) continue;
      const ambiguousBefore = candidates.some((other) => other.beforeIndex === candidate.beforeIndex
        && other.afterIndex !== candidate.afterIndex
        && !afterMatch.has(other.afterIndex)
        && other.score >= candidate.score - .05);
      const ambiguousAfter = candidates.some((other) => other.afterIndex === candidate.afterIndex
        && other.beforeIndex !== candidate.beforeIndex
        && !beforeMatch.has(other.beforeIndex)
        && other.score >= candidate.score - .05);
      if (!ambiguousBefore && !ambiguousAfter) pair(candidate.beforeIndex, candidate.afterIndex, contextual);
    }
  };

  // Authored names are the strongest identity and survive content changes and movement.
  for (let i = 0; i < before.length; i++) {
    const name = before[i]!.block.name;
    if (!name) continue;
    const j = after.findIndex((candidate, index) => !afterMatch.has(index) && candidate.block.name === name);
    if (j >= 0) pair(i, j);
  }

  // Exact unnamed source is safe to match even when neighboring edits shifted its position.
  for (let i = 0; i < before.length; i++) {
    if (beforeMatch.has(i) || before[i]!.block.name) continue;
    const j = after.findIndex((candidate, index) => !afterMatch.has(index)
      && !candidate.block.name
      && candidate.block.type === before[i]!.block.type
      && candidate.source === before[i]!.source);
    if (j >= 0) pair(i, j);
  }

  // Remaining unnamed blocks can be modifications only inside the same stable heading context.
  // When one side has extra blocks, prefer textual affinity over position so an insertion cannot
  // steal a prior comment from the paragraph that actually changed.
  const groupKeys = new Set(before
    .filter((_, index) => !beforeMatch.has(index))
    .map((candidate) => `${candidate.section}\0${candidate.block.type}`));
  for (const key of groupKeys) {
    const matchesKey = (candidate: DescribedBlock) => `${candidate.section}\0${candidate.block.type}` === key && !candidate.block.name;
    const beforeIndices = before.flatMap((candidate, index) => !beforeMatch.has(index) && matchesKey(candidate) ? [index] : []);
    const afterIndices = after.flatMap((candidate, index) => !afterMatch.has(index) && matchesKey(candidate) ? [index] : []);
    pairSimilar(beforeIndices, afterIndices);
  }

  // Pair one renamed heading only when the same matched headings bracket it on both sides. This
  // admits a lexically unrelated retitle while keeping deleted/new sections in different parts of
  // the document separate. Multiple unmatched headings in one bracket remain ambiguous.
  const nearestMatchedHeadingAfter = (index: number, direction: -1 | 1): number => {
    for (let cursor = index + direction; cursor >= 0 && cursor < before.length; cursor += direction) {
      const matched = beforeMatch.get(cursor);
      if (matched !== undefined && isHeading(before[cursor]!.block) && isHeading(after[matched]!.block)) return matched;
    }
    return direction < 0 ? -1 : after.length;
  };
  const nearestMatchedHeading = (index: number, direction: -1 | 1): number => {
    for (let cursor = index + direction; cursor >= 0 && cursor < after.length; cursor += direction) {
      if (afterMatch.has(cursor) && isHeading(after[cursor]!.block)) return cursor;
    }
    return direction < 0 ? -1 : after.length;
  };
  const beforeHeadingGroups = new Map<string, number[]>();
  const afterHeadingGroups = new Map<string, number[]>();
  for (let i = 0; i < before.length; i++) {
    if (beforeMatch.has(i) || before[i]!.block.name || !isHeading(before[i]!.block)) continue;
    const key = `${nearestMatchedHeadingAfter(i, -1)}\0${nearestMatchedHeadingAfter(i, 1)}`;
    beforeHeadingGroups.set(key, [...beforeHeadingGroups.get(key) ?? [], i]);
  }
  for (let j = 0; j < after.length; j++) {
    if (afterMatch.has(j) || after[j]!.block.name || !isHeading(after[j]!.block)) continue;
    const key = `${nearestMatchedHeading(j, -1)}\0${nearestMatchedHeading(j, 1)}`;
    afterHeadingGroups.set(key, [...afterHeadingGroups.get(key) ?? [], j]);
  }
  for (const [key, beforeIndices] of beforeHeadingGroups) {
    const afterIndices = afterHeadingGroups.get(key) ?? [];
    if (beforeIndices.length === 1 && afterIndices.length === 1
      && before[beforeIndices[0]!]!.block.type === after[afterIndices[0]!]!.block.type) {
      pair(beforeIndices[0]!, afterIndices[0]!, true);
    }
  }

  // Once headings are paired, fuzzy-match only inside those corresponding sections. This keeps
  // prior feedback from jumping to similar prose under an unrelated new heading.
  for (const [beforeHeading, afterHeading] of [...beforeMatch]) {
    if (!isHeading(before[beforeHeading]!.block) || !isHeading(after[afterHeading]!.block)) continue;
    const types = new Set(before
      .filter((candidate, index) => !beforeMatch.has(index) && !candidate.block.name && candidate.sectionIndex === beforeHeading)
      .map((candidate) => candidate.block.type));
    for (const type of types) {
      const beforeIndices = before.flatMap((candidate, index) => !beforeMatch.has(index) && !candidate.block.name
        && candidate.sectionIndex === beforeHeading && candidate.block.type === type ? [index] : []);
      const afterIndices = after.flatMap((candidate, index) => !afterMatch.has(index) && !candidate.block.name
        && candidate.sectionIndex === afterHeading && candidate.block.type === type ? [index] : []);
      pairSimilar(beforeIndices, afterIndices, contextualBeforeMatches.has(beforeHeading));
    }
  }

  const beforeExplainers = new Map(topCodeFences(beforeDoc).filter((fence) => fence.lang === "explainer").map((fence) => [fence.block.id, fence.source]));
  const afterExplainers = new Map(topCodeFences(afterDoc).filter((fence) => fence.lang === "explainer").map((fence) => [fence.block.id, fence.source]));
  const semanticFor = (beforeBlockId: string | null, afterBlockId: string | null) => {
    const beforeSource = beforeBlockId === null ? null : beforeExplainers.get(beforeBlockId);
    const afterSource = afterBlockId === null ? null : afterExplainers.get(afterBlockId);
    return typeof beforeSource === "string" && typeof afterSource === "string" ? diffExplainers(beforeSource, afterSource) : [];
  };
  const feedbackFor = (beforeIndex: number): Pick<ReviewChange, "priorItemIds" | "contextItemIds"> => {
    const itemIds = itemIdsInBlock(beforeDoc.items, before[beforeIndex]!);
    return contextualBeforeMatches.has(beforeIndex) && itemIds.length
      ? { priorItemIds: [], contextItemIds: itemIds }
      : { priorItemIds: itemIds };
  };

  const ordered: Array<{ change: ReviewChange; position: number; tie: number }> = [];
  const unchangedAfterBlockIds: string[] = [];
  const matchedPairs = [...beforeMatch.entries()].sort(([left], [right]) => left - right);
  const reorderedBeforeIndices = movedBeforeIndices(matchedPairs);
  for (let j = 0; j < after.length; j++) {
    const i = afterMatch.get(j);
    if (i === undefined) continue;
    if (before[i]!.source === after[j]!.source) {
      if (reorderedBeforeIndices.has(i)) {
        ordered.push({ change: {
          id: `change-moved-${before[i]!.block.id}`,
          kind: "moved",
          before: blockView(before[i]!),
          after: blockView(after[j]!),
          insertBeforeBlockId: null,
          summary: summary(after[j]!),
          ...feedbackFor(i),
          semanticChanges: [],
        }, position: j, tie: j });
      } else unchangedAfterBlockIds.push(after[j]!.block.id);
      continue;
    }
    ordered.push({ change: {
      id: `change-modified-${before[i]!.block.id}`,
      kind: "modified",
      before: blockView(before[i]!),
      after: blockView(after[j]!),
      insertBeforeBlockId: null,
      summary: summary(after[j]!),
      ...feedbackFor(i),
      semanticChanges: semanticFor(before[i]!.block.id, after[j]!.block.id),
    }, position: j, tie: j });
  }
  for (let i = 0; i < before.length; i++) {
    if (beforeMatch.has(i)) continue;
    const previousMatched = before.slice(0, i).map((_, index) => index).reverse().find((index) => beforeMatch.has(index));
    const nextMatchedOffset = before.slice(i + 1).findIndex((_, offset) => beforeMatch.has(i + 1 + offset));
    const nextMatched = nextMatchedOffset < 0 ? undefined : i + 1 + nextMatchedOffset;
    const insertionIndex = previousMatched !== undefined
      ? (beforeMatch.get(previousMatched) ?? -1) + 1
      : nextMatched !== undefined ? beforeMatch.get(nextMatched) ?? 0 : 0;
    ordered.push({ change: {
      id: `change-removed-${before[i]!.block.id}`,
      kind: "removed",
      before: blockView(before[i]!),
      after: null,
      insertBeforeBlockId: after[insertionIndex]?.block.id ?? null,
      summary: summary(before[i]!),
      priorItemIds: itemIdsInBlock(beforeDoc.items, before[i]!),
      semanticChanges: semanticFor(before[i]!.block.id, null),
    }, position: insertionIndex - .5, tie: i });
  }
  const addedOccurrences = new Map<string, number>();
  for (let j = 0; j < after.length; j++) {
    if (afterMatch.has(j)) continue;
    const contentKey = afterContentKeys[j]!;
    const contentOccurrence = (addedOccurrences.get(contentKey) ?? 0) + 1;
    addedOccurrences.set(contentKey, contentOccurrence);
    ordered.push({ change: {
      id: `change-added-${after[j]!.block.name ?? `${contentKey}-${contentOccurrence}`}`,
      kind: "added",
      before: null,
      after: blockView(after[j]!),
      insertBeforeBlockId: null,
      summary: summary(after[j]!),
      priorItemIds: [],
      semanticChanges: semanticFor(null, after[j]!.block.id),
    }, position: j, tie: j });
  }

  const changes = ordered.sort((left, right) => left.position - right.position || left.tie - right.tie).map(({ change }) => change);
  return { changes, unchangedAfterBlockIds };
}
