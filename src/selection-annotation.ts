import { annotate, annotateObject, locateAnchor, type Doc, type NewAnnotation } from "./doc.ts";
import { topBlocks } from "./render.ts";

export type SelectionAnnotationInput = {
  blockPos: string;
  anchorText: string;
  prefix?: string;
  kind: "comment" | "suggestion";
  body?: string;
  replacement?: string;
  note?: string;
  by?: string;
};

export type SelectionAnnotationResult = {
  source: string;
  anchorMode: "inline" | "block";
};

/** Apply a browser text selection when it maps exactly back to Markdown source. */
export function applySelectionAnnotation(doc: Doc, input: SelectionAnnotationInput): SelectionAnnotationResult | null {
  const [cleanFrom, cleanTo] = String(input.blockPos).split("-").map(Number);
  if (!Number.isFinite(cleanFrom) || !Number.isFinite(cleanTo)) return null;
  const loc = locateAnchor(doc, cleanFrom!, cleanTo!, input.anchorText, input.prefix ?? "");
  if (loc) {
    const ann: NewAnnotation = input.kind === "suggestion"
      ? { kind: "suggestion", replacement: input.replacement ?? "", note: input.note, by: input.by }
      : { kind: "comment", body: input.body ?? "", by: input.by };
    return { source: annotate(doc, loc.start, loc.end, ann), anchorMode: "inline" };
  }

  // Replacing text requires exact source offsets. Comments can degrade safely to a quoted
  // annotation on the containing top-level block when rendered text crosses Markdown syntax.
  if (input.kind !== "comment") return null;
  const origFrom = doc.cleanToOrig(cleanFrom!);
  const origTo = doc.cleanToOrig(cleanTo!);
  const blocks = topBlocks(doc);
  const block = blocks.find((candidate) => candidate.start <= origFrom && candidate.end >= origTo)
    ?? blocks.find((candidate) => candidate.start < origTo && candidate.end > origFrom);
  if (!block) return null;
  return {
    source: annotateObject(doc, block.end, input.body ?? "", {
      block: block.id,
      quote: String(input.anchorText).slice(0, 500),
    }, input.by),
    anchorMode: "block",
  };
}
