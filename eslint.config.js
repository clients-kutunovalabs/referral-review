import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-standalone/**", "**/node_modules/**", "**/.next/**", "packages/ui/reference/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "apps/*/scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly", process: "readonly", fetch: "readonly", Buffer: "readonly" } }
  },
  {
    // Money safety: no floating point parsing or Math rounding in money code.
    files: ["packages/money/src/**/*.ts", "packages/core/src/ledger/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-globals": ["error", "parseFloat"],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "round", message: "Use integer paise (bigint) maths." },
        { object: "Math", property: "floor", message: "Use integer paise (bigint) maths." },
        { object: "Math", property: "ceil", message: "Use integer paise (bigint) maths." }
      ]
    }
  }
);
