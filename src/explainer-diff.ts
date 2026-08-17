import { parse as parseYaml } from "yaml";
import { renderExplainer } from "./explainer.ts";

type Primitive = string | number | boolean | null;
type Fields = Map<string, Primitive>;

export type ExplainerChange = { id: string; field: string; before: Primitive; after: Primitive };

function semanticObjects(source: string): Map<string, Fields> {
  renderExplainer(source); // use the renderer's schema, ID, locality, and evidence validation contract
  const root = parseYaml(source);
  const objects = new Map<string, Fields>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") {
      const fields = new Map<string, Primitive>();
      for (const [field, fieldValue] of Object.entries(record)) {
        if (field === "id" || field === "type" || (fieldValue !== null && typeof fieldValue === "object")) continue;
        if (["string", "number", "boolean"].includes(typeof fieldValue) || fieldValue === null) fields.set(field, fieldValue as Primitive);
      }
      objects.set(record.id, fields);
    }
    Object.values(record).forEach(visit);
  };
  visit(root);
  return objects;
}

export function diffExplainers(beforeSource: string, afterSource: string): ExplainerChange[] {
  const before = semanticObjects(beforeSource), after = semanticObjects(afterSource);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  const changes: ExplainerChange[] = [];
  for (const id of ids) {
    const beforeFields = before.get(id) ?? new Map(), afterFields = after.get(id) ?? new Map();
    const fields = [...new Set([...beforeFields.keys(), ...afterFields.keys()])];
    for (const field of fields) {
      const beforeValue = beforeFields.get(field) ?? null, afterValue = afterFields.get(field) ?? null;
      if (!Object.is(beforeValue, afterValue)) changes.push({ id, field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}
