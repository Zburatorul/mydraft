// Source-of-truth model for a Markdown document with Roughdraft-flavored CriticMarkup.
// The file is the model. This module only *reads* it into a shape the renderer and
// annotation layer can use, and *splices* annotations back at exact source offsets.
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { extractRoughdraftReviewIndex } from "../vendor/rfm/index.js";

export type ReviewItem = {
  id: string;
  kind: "comment" | "suggestion" | "reply";
  suggestionKind?: "addition" | "deletion" | "substitution";
  parentId: string | null;
  author: string | null;
  createdAt: string | null;
  status: string | null;
  text: string;
  anchorText?: string;
  originalText?: string;
  replacementText?: string;
  offset: number;      // original-source offsets
  endOffset: number;
  line: number;
  column: number;
  cleanOffset: number; // offsets in the "clean" (marker-stripped) source
  cleanEndOffset: number;
  anchor?: { block?: string; target?: string; quote?: string } | null; // object anchors (extension)
};

export type Doc = {
  path: string;
  source: string;        // exact file bytes
  version: string;       // content hash
  body: string;          // source minus endmatter
  clean: string;         // body minus CriticMarkup markers (anchor text kept)
  endmatter: Endmatter;  // parsed YAML endmatter (comments/suggestions maps)
  items: ReviewItem[];
  cleanToOrig(o: number): number;
  /** Like cleanToOrig, but for the END of a range: a clean offset on a boundary maps past any markup that
   *  closes there, so a block ending in `{==x==}{>>note<<}{#c1}` keeps its whole annotation. */
  cleanToOrigEnd(o: number): number;
  origToClean(o: number): number;
};

export type Endmatter = {
  raw: string;                    // "" if absent, else the "\n---\n..." tail
  comments: Record<string, any>;
  suggestions: Record<string, any>;
};

const ENDMATTER_RE = /\n---\n(?=(?:comments|suggestions):)/;

export function splitEndmatter(source: string): { body: string; endmatter: Endmatter } {
  const m = ENDMATTER_RE.exec(source);
  if (!m) return { body: source, endmatter: { raw: "", comments: {}, suggestions: {} } };
  const raw = source.slice(m.index);
  const yamlText = raw.replace(/^\n---\n/, "");
  let parsed: any = {};
  try { parsed = parseYaml(yamlText) ?? {}; } catch { parsed = {}; }
  return {
    body: source.slice(0, m.index),
    endmatter: { raw, comments: parsed.comments ?? {}, suggestions: parsed.suggestions ?? {} },
  };
}

export function serializeEndmatter(e: Endmatter): string {
  const obj: any = {};
  if (Object.keys(e.comments).length) obj.comments = e.comments;
  if (Object.keys(e.suggestions).length) obj.suggestions = e.suggestions;
  if (!Object.keys(obj).length) return "";
  return "\n---\n" + stringifyYaml(obj, { lineWidth: 0 });
}

// CriticMarkup marker patterns. We strip markers but keep visible text:
//  {==x==}      -> x          {>>c<<}  -> ""        {#c1} / {id="…"} -> ""
//  {++x++}      -> x          {--x--}  -> x (kept, rendered struck via anchor)
//  {~~a~>b~~}   -> a          (suggestion shown as annotation over the original)
const MARKER_RE = /\{==([\s\S]*?)==\}|\{>>[\s\S]*?<<\}|\{#[cs][0-9]+\}|\{id="[^"]*"(?:\s+[a-z]+="[^"]*")*\}|\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>[\s\S]*?~~\}/g;

type Seg = { cleanStart: number; origStart: number; len: number }; // copied runs

function stripMarkers(body: string): { clean: string; segs: Seg[] } {
  const segs: Seg[] = [];
  let clean = "";
  let last = 0;
  // Do not touch fenced code blocks: CriticMarkup inside them is literal.
  const fences = fenceRanges(body);
  const inFence = (i: number) => fences.some(([s, e]) => i >= s && i < e);
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(body))) {
    if (inFence(m.index)) continue;
    // copy text before the marker
    if (m.index > last) {
      segs.push({ cleanStart: clean.length, origStart: last, len: m.index - last });
      clean += body.slice(last, m.index);
    }
    const kept = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    if (kept) {
      // kept text sits inside the marker: {==<kept>==}, {++<kept>++}, {--<kept>--}, {~~<kept>~>…~~}
      const inner = m.index + 3; // after "{==" / "{++" / "{--" / "{~~"
      segs.push({ cleanStart: clean.length, origStart: inner, len: kept.length });
      clean += kept;
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) {
    segs.push({ cleanStart: clean.length, origStart: last, len: body.length - last });
    clean += body.slice(last);
  }
  return { clean, segs };
}

export function fenceRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function makeMaps(segs: Seg[], bodyLength: number) {
  const cleanToOrigEnd = (o: number) => {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i]!;
      if (o < s.cleanStart || o > s.cleanStart + s.len) continue;
      // at the very end of the last kept run, only stripped markup can follow: it closes this range
      return i === segs.length - 1 && o === s.cleanStart + s.len ? bodyLength : s.origStart + (o - s.cleanStart);
    }
    return bodyLength;
  };
  const cleanToOrig = (o: number) => {
    for (const s of segs) if (o >= s.cleanStart && o <= s.cleanStart + s.len) return s.origStart + (o - s.cleanStart);
    const l = segs[segs.length - 1];
    return l ? l.origStart + l.len : o;
  };
  const origToClean = (o: number) => {
    for (const s of segs) {
      if (o >= s.origStart && o <= s.origStart + s.len) return s.cleanStart + (o - s.origStart);
      if (o < s.origStart) return s.cleanStart; // inside a stripped marker → collapse to next run
    }
    const l = segs[segs.length - 1];
    return l ? l.cleanStart + l.len : 0;
  };
  return { cleanToOrig, cleanToOrigEnd, origToClean };
}

export function hashVersion(source: string): string {
  return new Bun.CryptoHasher("sha1").update(source).digest("hex").slice(0, 12);
}

export function loadDoc(path: string, source: string): Doc {
  const { body, endmatter } = splitEndmatter(source);
  const { clean, segs } = stripMarkers(body);
  const { cleanToOrig, cleanToOrigEnd, origToClean } = makeMaps(segs, body.length);
  const idx = extractRoughdraftReviewIndex(source) as any;
  const items: ReviewItem[] = (idx.items as any[]).map((it) => {
    const meta = endmatter.comments[it.id] ?? endmatter.suggestions[it.id] ?? {};
    return {
      ...it,
      cleanOffset: origToClean(it.offset),
      cleanEndOffset: origToClean(it.endOffset),
      anchor: meta.anchor ?? null,
    };
  });
  return { path, source, version: hashVersion(source), body, clean, endmatter, items, cleanToOrig, cleanToOrigEnd, origToClean };
}

// ---------- mutations (surgical splices; everything else byte-identical) ----------

export function nextId(doc: Doc, prefix: "c" | "s"): string {
  let n = 0;
  for (const it of doc.items) {
    const m = /^([cs])(\d+)$/.exec(it.id);
    if (m && m[1] === prefix) n = Math.max(n, Number(m[2]));
  }
  for (const k of Object.keys(prefix === "c" ? doc.endmatter.comments : doc.endmatter.suggestions)) {
    const m = /^([cs])(\d+)$/.exec(k);
    if (m && m[1] === prefix) n = Math.max(n, Number(m[2]));
  }
  return `${prefix}${n + 1}`;
}

/** Locate `anchorText` inside the ORIGINAL source within [cleanFrom, cleanTo) of the clean text,
 * tolerating Markdown punctuation between characters (bold/italic/code markers, link brackets).
 * `prefix` (clean text immediately before the selection) disambiguates repeats. */
export function locateAnchor(doc: Doc, cleanFrom: number, cleanTo: number, anchorText: string, prefix = ""): { start: number; end: number } | null {
  const origFrom = doc.cleanToOrig(cleanFrom);
  const origTo = doc.cleanToOrig(cleanTo);
  const slice = doc.body.slice(origFrom, origTo);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const between = "[*_`~\\[\\]\\\\]*";
  const pat = anchorText.split("").map(esc).join(between);
  const re = new RegExp(pat, "g");
  const cands: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice))) { cands.push({ start: origFrom + m.index, end: origFrom + m.index + m[0].length }); if (m[0].length === 0) re.lastIndex++; }
  if (!cands.length) return null;
  if (cands.length === 1 || !prefix) return cands[0]!;
  // choose the candidate whose preceding clean text best matches `prefix`
  let best = cands[0]!, bestScore = -1;
  for (const c of cands) {
    const before = doc.clean.slice(Math.max(0, doc.origToClean(c.start) - prefix.length), doc.origToClean(c.start));
    let score = 0; for (let i = 1; i <= Math.min(before.length, prefix.length); i++) { if (before.slice(-i) === prefix.slice(-i)) score = i; else break; }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export type NewAnnotation =
  | { kind: "comment"; body: string; by?: string }
  | { kind: "suggestion"; replacement: string; by?: string; note?: string };

/** Insert a highlight+comment or a substitution suggestion around [start,end) of the ORIGINAL body. */
export function annotate(doc: Doc, start: number, end: number, ann: NewAnnotation, now = new Date().toISOString()): string {
  const by = ann.by ?? "user";
  const target = doc.body.slice(start, end);
  const em: Endmatter = { raw: "", comments: { ...doc.endmatter.comments }, suggestions: { ...doc.endmatter.suggestions } };
  let markup: string;
  if (ann.kind === "comment") {
    const id = nextId(doc, "c");
    markup = `{==${target}==}{>>${ann.body}<<}{#${id}}`;
    em.comments[id] = { by, at: now };
  } else {
    const id = nextId(doc, "s");
    markup = `{~~${target}~>${ann.replacement}~~}{#${id}}`;
    em.suggestions[id] = { by, at: now };
    if (ann.note) { const cid = nextId({ ...doc, endmatter: em } as Doc, "c"); em.comments[cid] = { body: ann.note, by, at: now, re: id }; }
  }
  const body = doc.body.slice(0, start) + markup + doc.body.slice(end);
  return body + serializeEndmatter(em);
}

/** Comment anchored to an object (a whole block, or a target inside it), placed as a standalone
 * CriticMarkup comment on its own line right after the block; the object anchor lives in endmatter. */
export function annotateObject(doc: Doc, blockOrigEnd: number, body: string, anchor: { block: string; target?: string; quote?: string }, by = "user", now = new Date().toISOString()): string {
  const id = nextId(doc, "c");
  const at = blockOrigEnd;
  const em: Endmatter = { raw: "", comments: { ...doc.endmatter.comments, [id]: { by, at: now, anchor } }, suggestions: { ...doc.endmatter.suggestions } };
  const ins = `\n{>>${body}<<}{#${id}}\n`;
  const newBody = doc.body.slice(0, at) + ins + doc.body.slice(at);
  return newBody + serializeEndmatter(em);
}

export function reply(doc: Doc, parentId: string, message: string, by = "AI", now = new Date().toISOString()): string {
  if (!doc.items.some((i) => i.id === parentId) && !doc.endmatter.comments[parentId] && !doc.endmatter.suggestions[parentId]) throw new Error(`Review item not found: ${parentId}`);
  const id = nextId(doc, "c");
  const em: Endmatter = { raw: "", comments: { ...doc.endmatter.comments, [id]: { body: message, by, at: now, re: parentId } }, suggestions: { ...doc.endmatter.suggestions } };
  return doc.body + serializeEndmatter(em);
}

export function resolve(doc: Doc, targetId: string, by = "AI", now = new Date().toISOString(), summary?: string): string {
  const em: Endmatter = { raw: "", comments: { ...doc.endmatter.comments }, suggestions: { ...doc.endmatter.suggestions } };
  const bucket = em.comments[targetId] ? em.comments : em.suggestions[targetId] ? em.suggestions : (doc.items.find(i => i.id === targetId)?.kind === "suggestion" ? em.suggestions : em.comments);
  bucket[targetId] = { ...(bucket[targetId] ?? {}), status: "resolved", resolvedBy: by, resolvedAt: now, ...(summary ? { resolution: summary } : {}) };
  return doc.body + serializeEndmatter(em);
}
