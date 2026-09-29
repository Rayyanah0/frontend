// `npm run api:check` — validates checked-in backend fixtures against the Zod
// schemas and diffs their key sets, so backend drift (renamed/added/removed
// fields) is caught before it reaches the UI. Fixtures live in
// contracts/fixtures/<SchemaName>.json; regenerate them from the backend
// (curl each endpoint) whenever the backend contract changes. Once the
// backend publishes OpenAPI, replace the fixture source with that file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as S from "../src/lib/api/schemas";

const dir = join(__dirname, "..", "contracts", "fixtures");
const schemas = S as unknown as Record<string, z.ZodTypeAny>;
let failed = false;

function shapeKeys(schema: z.ZodTypeAny): string[] | null {
  if (schema instanceof z.ZodObject) return Object.keys(schema.shape);
  if (schema instanceof z.ZodArray) return shapeKeys(schema.element);
  return null;
}
const firstItem = (v: unknown) => (Array.isArray(v) ? v[0] : v);

for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const name = file.replace(/\.json$/, "");
  const schema = schemas[name];
  if (!schema) { console.error(`FAIL ${name}: no exported schema`); failed = true; continue; }
  const payload = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const res = schema.safeParse(payload);
  if (!res.success) {
    console.error(`FAIL ${name}:`, res.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    failed = true;
    continue;
  }
  const expected = shapeKeys(schema);
  const item = firstItem(payload);
  if (expected && item && typeof item === "object") {
    const extra = Object.keys(item).filter(k => !expected.includes(k));
    if (extra.length) { console.error(`DRIFT ${name}: fixture has fields not in schema: ${extra.join(", ")}`); failed = true; continue; }
  }
  console.log(`ok   ${name}`);
}
process.exit(failed ? 1 : 0);
