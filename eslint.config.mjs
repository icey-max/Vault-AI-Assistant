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
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-restricted-globals": [
        "error",
        {
          name: "app",
          message: "Use the Plugin instance app reference, such as this.app, instead of Obsidian's global app."
        },
        {
          name: "fetch",
          message: "Use Obsidian requestUrl through obsidianRequestFetch for provider network calls."
        }
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message: "This plugin is mobile-compatible; gate Electron usage behind Platform.isDesktopApp and a runtime import."
            },
            {
              name: "fs",
              message: "Use Obsidian Vault/FileManager APIs instead of Node filesystem APIs in plugin source."
            },
            {
              name: "node:fs",
              message: "Use Obsidian Vault/FileManager APIs instead of Node filesystem APIs in plugin source."
            },
            {
              name: "path",
              message: "Use Obsidian normalizePath and vault-relative paths in plugin source."
            },
            {
              name: "node:path",
              message: "Use Obsidian normalizePath and vault-relative paths in plugin source."
            },
            {
              name: "os",
              message: "Use Obsidian Platform APIs instead of Node platform APIs in plugin source."
            },
            {
              name: "node:os",
              message: "Use Obsidian Platform APIs instead of Node platform APIs in plugin source."
            }
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Node built-ins must not be imported by mobile-compatible plugin source."
            }
          ]
        }
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "globalThis",
          property: "fetch",
          message: "Use Obsidian requestUrl through obsidianRequestFetch for provider network calls."
        },
        {
          object: "window",
          property: "app",
          message: "Use the Plugin instance app reference, such as this.app, instead of Obsidian's global app."
        },
        {
          object: "window",
          property: "fetch",
          message: "Use Obsidian requestUrl through obsidianRequestFetch for provider network calls."
        },
        {
          property: "innerHTML",
          message: "Use Obsidian DOM helpers or textContent instead of HTML injection."
        },
        {
          property: "outerHTML",
          message: "Use Obsidian DOM helpers or textContent instead of HTML injection."
        }
      ],
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }]
    }
  }
);
