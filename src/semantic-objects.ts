import { isMap, isSeq, parseDocument, type Node, type YAMLMap } from "yaml";
import { loadDoc, type Doc } from "./doc.ts";
import { explainerSectionChildren, renderExplainer } from "./explainer.ts";
import { topCodeFences, type CodeFence } from "./render.ts";

export type SemanticObject = {
  ref: string;
  block: string;
  target: string;
  kind: string;
  path: string;
  source: string;
};

export type ExplainerSourceObject = Omit<SemanticObject, "ref" | "block">;

type LocatedSourceObject = ExplainerSourceObject & {
  start: number;
  end: number;
  indent: string;
};

type LocatedObject = SemanticObject & Pick<LocatedSourceObject, "start" | "end" | "indent">;

type ExplainerFence = CodeFence;

function pathText(parts: Array<string | number>): string {
  return parts.map((part, index) => typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`).join("");
}

function normalizeNodeSource(source: string, start: number, end: number, indent: string): string {
  const raw = source.slice(start, end).replace(/\n$/, "");
  const lines = raw.split("\n");
  return [lines[0], ...lines.slice(1).map((line) => line.startsWith(indent) ? line.slice(indent.length) : line)].join("\n");
}

function objectsInSource(source: string): LocatedSourceObject[] {
  renderExplainer(source); // the rendering schema remains the single validation contract
  const document = parseDocument(source);
  if (document.errors.length) throw document.errors[0];
  const objects: LocatedSourceObject[] = [];

  const mapValue = (map: YAMLMap, key: string): Node | null => {
    const pair = map.items.find((item) => String((item.key as any)?.toJSON?.() ?? item.key ?? "") === key);
    return (pair?.value as Node | null) ?? null;
  };
  const add = (node: YAMLMap, parts: Array<string | number>, kind: string) => {
    const id = node.get("id");
    if (typeof id !== "string" || !id || !node.range) return;
    const lineStart = source.lastIndexOf("\n", node.range[0] - 1) + 1;
    const indent = " ".repeat(node.range[0] - lineStart);
    objects.push({
      target: id,
      kind,
      path: pathText(parts),
      source: normalizeNodeSource(source, node.range[0], node.range[1], indent),
      start: node.range[0],
      end: node.range[1],
      indent,
    });
  };

  if (!isMap(document.contents)) return objects;
  const sections = mapValue(document.contents, "sections");
  if (!isSeq(sections)) return objects;
  sections.items.forEach((sectionNode, sectionIndex) => {
    if (!isMap(sectionNode)) return;
    const type = sectionNode.get("type");
    if (typeof type !== "string") return;
    add(sectionNode, ["sections", sectionIndex], type);
    for (const child of explainerSectionChildren(type)) {
      const children = mapValue(sectionNode, child.key);
      if (!isSeq(children)) continue;
      children.items.forEach((childNode, childIndex) => {
        if (isMap(childNode)) add(childNode, ["sections", sectionIndex, child.key, childIndex], child.kind);
      });
    }
  });
  return objects;
}

export function listExplainerSourceObjects(source: string): ExplainerSourceObject[] {
  return objectsInSource(source).map(({ start: _start, end: _end, indent: _indent, ...object }) => object);
}

function objectsInFence(fence: ExplainerFence): LocatedObject[] {
  return objectsInSource(fence.source).map((object) => ({
    ...object,
    ref: semanticObjectRef(fence.block.id, object.target),
    block: fence.block.id,
    start: fence.sourceStart + object.start,
    end: fence.sourceStart + object.end,
  }));
}

function locatedObjects(doc: Doc): LocatedObject[] {
  const objects = topCodeFences(doc)
    .filter((fence) => fence.lang === "explainer")
    .flatMap(objectsInFence);
  const refs = new Set<string>();
  for (const object of objects) {
    if (refs.has(object.ref)) throw new Error(`ambiguous semantic object reference: ${object.ref}`);
    refs.add(object.ref);
  }
  return objects;
}

function semanticObjectRef(block: string, target: string): string {
  return `${block}›${target}`;
}

export function listSemanticObjects(doc: Doc): SemanticObject[] {
  return locatedObjects(doc).map(({ start: _start, end: _end, indent: _indent, ...object }) => object);
}

export function getSemanticObject(doc: Doc, ref: string): SemanticObject | null {
  return listSemanticObjects(doc).find((object) => object.ref === ref) ?? null;
}

function replacementMapping(source: string, expectedId: string): string {
  const normalized = source.trimEnd();
  const document = parseDocument(normalized);
  if (document.errors.length) throw document.errors[0];
  if (!isMap(document.contents)) throw new Error("replacement must be one YAML object");
  const id = (document.toJS() as Record<string, unknown>).id;
  if (id !== expectedId) throw new Error(`replacement id must remain ${expectedId}`);
  return normalized;
}

export function replaceSemanticObject(doc: Doc, ref: string, replacement: string): string {
  const object = locatedObjects(doc).find((candidate) => candidate.ref === ref);
  if (!object) throw new Error(`no semantic object ${ref}`);
  const normalized = replacementMapping(replacement, object.target);
  const lines = normalized.split("\n");
  let indented = [lines[0], ...lines.slice(1).map((line) => line ? object.indent + line : line)].join("\n");
  if (doc.body.slice(object.start, object.end).endsWith("\n")) indented += "\n";
  const body = doc.body.slice(0, object.start) + indented + doc.body.slice(object.end);
  const next = body + doc.endmatter.raw;
  listSemanticObjects(loadDoc(doc.path, next)); // reject edits that violate the complete explainer contract
  return next;
}
