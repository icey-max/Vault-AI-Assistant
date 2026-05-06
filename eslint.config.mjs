import js from "@eslint/js";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".codex/**",
      ".planning/**",
      "node_modules/**",
      "main.js"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      obsidianmd
    },
    rules: {
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }]
    }
  }
);
