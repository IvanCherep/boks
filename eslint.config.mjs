import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deno, with its own globals and its own runtime.
    "supabase/functions/**",
  ]),
  {
    // boks navigates between reader, author and admin with plain anchors.
    // vinext's `next/link` client navigation throws `TypeError: e is not a
    // function` in this build and silently does nothing, so the rule's advice
    // produces dead links. A full navigation is also correct here: moving
    // between surfaces should reset the surface. Re-enable this rule once
    // vinext `Link` works.
    files: ["app/**/*.tsx", "components/boks/**/*.tsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from the shadcn registry (matching stylesheet:
      // vendor/shadcn-tailwind-4.13.0.css). Keep the registry source intact
      // while applying the stricter rules to app code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
