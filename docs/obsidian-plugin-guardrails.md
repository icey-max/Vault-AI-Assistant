# Obsidian Plugin Guardrails

Source documents:

- Obsidian plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Obsidian plugin checklist: https://docs.obsidian.md/oo/plugin
- Submit your plugin: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Manifest reference: https://docs.obsidian.md/Reference/Manifest
- Optimize plugin load time: https://docs.obsidian.md/plugins/guides/load-time

These rules are a project gate. Code, specs, plans, reviews, and release work must preserve them.

## Code Guardrails

- Keep `manifest.json`, `package.json`, and `versions.json` versions aligned. Manifest versions must use `x.y.z`, and the manifest id must not contain `obsidian`.
- Do not track generated release assets such as `main.js`; build them for releases only.
- Keep provider network calls on Obsidian `requestUrl` through `obsidianRequestFetch`. Do not introduce `fetch`, `globalThis.fetch`, `window.fetch`, or `axios.get` in plugin source.
- Because `isDesktopOnly` is `false`, do not import Node or Electron modules in plugin source. Any future desktop-only behavior needs an explicit mobile fallback and `Platform.isDesktopApp` gate.
- Do not set default command hotkeys. Do not include the plugin name or plugin id in command names.
- Use the plugin instance app reference (`this.app` or an explicit local `App` parameter), not the global `app` or `window.app`.
- Use Obsidian vault APIs for vault-relative files. Use `Vault.process` for background note updates, `FileManager.trashFile` for deletes, `FileManager.renameFile` for renames, and `normalizePath` for user-defined paths.
- Do not manually read/write frontmatter. Use `FileManager.processFrontMatter` when frontmatter support is added.
- Do not use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` in plugin UI. Use Obsidian DOM helpers, React rendering, or `textContent`.
- Do not assign hardcoded styles from TypeScript. Put styling in `styles.css`, scope selectors under `.vault-ai-assistant-*`, and use Obsidian theme variables.
- Settings UI text uses sentence case. Settings headings use `Setting#setHeading()` and should not include redundant words like "settings" or "options".
- Keep `onload()` lightweight: register views, commands, settings, and events there; defer expensive startup work to `workspace.onLayoutReady()`.
- Keep the README disclosure current for account requirements, network calls, provider data sharing, external file access, telemetry, payments, and closed-source components. This plugin must not add client-side telemetry.
- Treat every new dependency as a review item. Keep a lockfile committed, avoid `"latest"` ranges, and keep `obsidian` in `devDependencies`.

## Planning Guardrails

Every future `SPEC.md`, `AI-SPEC.md`, `UI-SPEC.md`, `RESEARCH.md`, and `PLAN.md` must include an `Obsidian guideline impact` section. If the phase does not touch an area, write `N/A` for that area rather than omitting it.

The section must cover:

- Manifest/release impact.
- Mobile compatibility impact.
- Network and data disclosure impact.
- Vault API and filesystem impact.
- Command/hotkey impact.
- Settings/UI text and styling impact.
- Startup/load-time impact.
- Dependency impact.

Implementation plans must include `npm run compliance` in verification. Any planned exception to these guardrails needs a source link, explicit rationale, and a reviewer decision before implementation.

## Automated Gate

Run:

```bash
npm run compliance
npm run check
```

`npm run build` runs compliance before building `main.js`, and CI runs the full check suite.

When a local `.planning` directory exists, `npm run compliance` also verifies `.planning/GUARDRAILS.md`, `.planning/PROJECT.md`, and `.planning/ROADMAP.md`. To check a specific new plan before approval, pass it explicitly:

```bash
node scripts/check-obsidian-guidelines.mjs .planning/phases/example/PLAN.md
```
