// Where an installed dependency lives. A global install may hoist dependencies out of
// mydraft's own node_modules (bun add -g, pnpm), so ask the resolver instead of assuming
// `ROOT/node_modules/<name>`. Packages like vega export no `./package.json`, so resolve the
// entry point and walk up to the directory whose package.json carries that name.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dirs = new Map<string, string>();

export function packageDir(name: string): string {
  const known = dirs.get(name);
  if (known) return known;
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, "utf8")).name === name) break;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot locate package directory for ${name}`);
    dir = parent;
  }
  dirs.set(name, dir);
  return dir;
}

/** Splits `/vendor/<pkg>/<file>` into the package's directory and the file within it. */
export function vendorFile(rel: string): { base: string; file: string } | null {
  const parts = rel.split("/");
  const nameLength = parts[0]?.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, nameLength).join("/");
  if (!name || parts.length <= nameLength) return null;
  try { return { base: packageDir(name), file: parts.slice(nameLength).join("/") }; } catch { return null; }
}
