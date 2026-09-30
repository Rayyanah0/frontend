import { dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Security rules (XSS sinks, target=_blank, script URLs, allowlisted
// dangerouslySetInnerHTML wrapper) are defined once in .eslintrc.json and
// shared here so flat-config and legacy `next lint` enforce the same policy.
const legacy = JSON.parse(readFileSync(new URL("./.eslintrc.json", import.meta.url), "utf8"));

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: legacy.rules },
  ...legacy.overrides.map(({ files, rules }) => ({ files, rules })),
];

export default eslintConfig;
