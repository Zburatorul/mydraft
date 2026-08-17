import { parse as parseYaml } from "yaml";
import { listExplainerSourceObjects } from "./semantic-objects.ts";

type Primitive = string | number | boolean | null;
type Fields = Map<string, Primitive>;

export type ExplainerChange = { id: string; field: string; before: Primitive; after: Primitive };

function semanticObjects(source: string): Map<string, Fields> {
  const objects = new Map<string, Fields>();
  for (const object of listExplainerSourceObjects(source)) {
    const record = parseYaml(object.source) as Record<string, unknown>;
    const fields = new Map<string, Primitive>();
    for (const [field, fieldValue] of Object.entries(record)) {
      if (field === "id" || field === "type" || (fieldValue !== null && typeof fieldValue === "object")) continue;
      if (["string", "number", "boolean"].includes(typeof fieldValue) || fieldValue === null) {
        fields.set(field, fieldValue as Primitive);
      }
    }
    objects.set(object.target, fields);
  }
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
