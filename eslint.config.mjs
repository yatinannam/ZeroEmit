import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Node build scripts (not app code) — CommonJS require() is expected here.
    files: ["*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored worktrees/scratch space other tooling (e.g. Kilo Code) may
    // create inside this repo — not app code, shouldn't fail our lint gate.
    ".kilo/**",
  ]),
]);

export default eslintConfig;
