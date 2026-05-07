#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

const extraPlanningFiles = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => path.resolve(root, arg))
  .filter((filePath) => existsSync(filePath));

checkRequiredFiles();
checkManifest();
checkPackage();
checkGitReleaseArtifacts();
checkSourceFiles();
checkStyles();
checkPlanningFiles();

if (failures.length > 0) {
  console.error("Obsidian guideline compliance failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Obsidian guideline compliance checks passed.");

function checkRequiredFiles() {
  for (const filePath of [
    "README.md",
    "LICENSE",
    "manifest.json",
    "versions.json",
    "package-lock.json",
    "docs/obsidian-plugin-guardrails.md"
  ]) {
    if (!exists(filePath)) {
      fail(filePath, "required release/compliance file is missing");
    }
  }

  const gitignore = readText(".gitignore");
  if (!gitignore.includes("main.js")) {
    fail(".gitignore", "generated main.js must stay ignored and only ship as a release asset");
  }
}

function checkManifest() {
  const manifest = readJson("manifest.json");
  const packageJson = readJson("package.json");
  const versions = readJson("versions.json");

  for (const key of ["id", "name", "version", "minAppVersion", "description", "author"]) {
    if (typeof manifest[key] !== "string" || manifest[key].trim().length === 0) {
      fail("manifest.json", `${key} must be a non-empty string`);
    }
  }

  if (typeof manifest.isDesktopOnly !== "boolean") {
    fail("manifest.json", "isDesktopOnly must be a boolean");
  }

  if (typeof manifest.id === "string" && manifest.id.toLowerCase().includes("obsidian")) {
    fail("manifest.json", "plugin id must not contain obsidian");
  }

  if (typeof manifest.version === "string" && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    fail("manifest.json", "version must use x.y.z semantic version format");
  }

  if (manifest.version !== packageJson.version) {
    fail("manifest.json", "manifest version must match package.json version");
  }

  if (manifest.id !== packageJson.name) {
    fail("manifest.json", "manifest id should match package name for local plugin loading");
  }

  if (versions[manifest.version] !== manifest.minAppVersion) {
    fail("versions.json", "current plugin version must map to manifest minAppVersion");
  }
}

function checkPackage() {
  const packageJson = readJson("package.json");
  const dependencyGroups = {
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {}
  };

  for (const [groupName, dependencies] of Object.entries(dependencyGroups)) {
    for (const [name, version] of Object.entries(dependencies)) {
      if (version === "latest" || version === "*" || version === "x") {
        fail("package.json", `${groupName}.${name} must be pinned or range-bounded, not ${version}`);
      }
    }
  }

  if (packageJson.dependencies?.obsidian) {
    fail("package.json", "obsidian API package belongs in devDependencies because Obsidian provides it at runtime");
  }

  for (const scriptName of ["compliance", "lint", "test", "build", "check"]) {
    if (!packageJson.scripts?.[scriptName]) {
      fail("package.json", `missing npm script: ${scriptName}`);
    }
  }

  if (!packageJson.scripts.build.includes("npm run compliance")) {
    fail("package.json", "build must run compliance before producing release main.js");
  }
}

function checkGitReleaseArtifacts() {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return;
  }

  const tracked = new Set(result.stdout.split(/\r?\n/).filter(Boolean));
  for (const artifact of ["main.js", "main.js.map", "dist", "build"]) {
    if (tracked.has(artifact)) {
      fail(artifact, "generated build artifact must not be tracked in source control");
    }
  }
}

function checkSourceFiles() {
  const sourceFiles = walk(path.join(root, "src"), [".ts", ".tsx"]);
  const sourceRules = [
    {
      pattern: /\bhotkeys\s*:/,
      message: "do not set default hotkeys for community plugin commands"
    },
    {
      pattern: /globalThis\.fetch|window\.fetch|(?<![\w$.])fetch\s*\(/,
      message: "use Obsidian requestUrl through obsidianRequestFetch instead of fetch"
    },
    {
      pattern: /axios\.get\s*\(/,
      message: "use Obsidian requestUrl instead of axios.get"
    },
    {
      pattern: /process\.platform/,
      message: "use Obsidian Platform instead of process.platform"
    },
    {
      pattern: /window\.app|globalThis\.app/,
      message: "use the plugin instance app reference instead of the global app"
    },
    {
      pattern: /innerHTML|outerHTML|insertAdjacentHTML\s*\(/,
      message: "avoid HTML injection APIs; use Obsidian DOM helpers or textContent"
    },
    {
      pattern: /setAttr\(\s*["']style["']|setAttribute\(\s*["']style["']|\.style\.[A-Za-z]/,
      message: "do not assign hardcoded styles from TypeScript; use CSS classes"
    },
    {
      pattern: /(?<!vault-ai-assistant\/)\.obsidian\b/,
      message: "do not hardcode the .obsidian config directory"
    },
    {
      pattern: /\bvault\.modify\s*\(/,
      message: "use Vault.process for background note updates instead of Vault.modify"
    },
    {
      pattern: /\bvault\.delete\s*\(/,
      message: "use FileManager.trashFile instead of Vault.delete"
    },
    {
      pattern: /\bas\s+any\b|:\s*any\b/,
      message: "use precise types instead of any"
    },
    {
      pattern: /^\s*import\s+.*from\s+["'](?:node:|fs["']|path["']|os["']|electron["'])/m,
      message: "mobile-compatible plugin source must not import Node or Electron modules"
    },
    {
      pattern: /require\(\s*["'](?:node:|fs["']|path["']|os["']|electron["'])/,
      message: "desktop-only runtime imports must be explicitly gated behind Platform.isDesktopApp"
    }
  ];

  for (const filePath of sourceFiles) {
    const text = readText(filePath);
    for (const rule of sourceRules) {
      for (const match of text.matchAll(new RegExp(rule.pattern, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`))) {
        fail(filePath, rule.message, lineNumber(text, match.index ?? 0));
      }
    }
  }

  const settings = readText("src/settings.ts");
  for (const match of settings.matchAll(/createEl\(\s*["']h[12]["']/g)) {
    fail("src/settings.ts", "settings headings must use Setting#setHeading, not manual h1/h2 elements", lineNumber(settings, match.index ?? 0));
  }
}

function checkStyles() {
  const styles = readText("styles.css");
  const unsafeHostSelectors = /^(?:html|body|\.workspace|\.modal|\.setting-item|\.markdown-preview-view)\b/gm;
  for (const match of styles.matchAll(unsafeHostSelectors)) {
    fail("styles.css", "plugin CSS must be scoped to vault-ai-assistant classes and not override host UI globally", lineNumber(styles, match.index ?? 0));
  }
}

function checkPlanningFiles() {
  if (!exists(".planning")) {
    return;
  }

  const planningGuardrails = ".planning/GUARDRAILS.md";
  if (!exists(planningGuardrails)) {
    fail(planningGuardrails, "planning guardrail document is missing");
  }

  const project = readText(".planning/PROJECT.md");
  if (!/Obsidian guideline compliance gate/i.test(project)) {
    fail(".planning/PROJECT.md", "project constraints must include the Obsidian guideline compliance gate");
  }

  const roadmap = readText(".planning/ROADMAP.md");
  if (!/Obsidian guideline impact/i.test(roadmap)) {
    fail(".planning/ROADMAP.md", "roadmap must require Obsidian guideline impact in future plans");
  }

  for (const filePath of extraPlanningFiles) {
    checkPlanLikeFile(filePath);
  }
}

function checkPlanLikeFile(filePath) {
  const text = readText(filePath);
  const relativePath = path.relative(root, filePath);

  if (!/Obsidian guideline impact|Obsidian guideline compliance|Obsidian compliance/i.test(text)) {
    fail(relativePath, "planning docs must include an Obsidian guideline impact/compliance section");
  }

  if (/PLAN\.md$|-PLAN\.md$/i.test(relativePath) && !/npm run compliance/i.test(text)) {
    fail(relativePath, "implementation plans must include npm run compliance in verification");
  }

  const planningRules = [
    [/\bhotkeys\s*:/, "default hotkeys must not be planned"],
    [/globalThis\.fetch|window\.fetch|(?<![\w$.])fetch\s*\(/, "fetch must not be planned for plugin network calls"],
    [/process\.platform/, "process.platform must not be planned"],
    [/FileSystemAdapter/, "FileSystemAdapter use must not be planned unless gated and explicitly justified"],
    [/\bVault\.modify\b|\bvault\.modify\s*\(/, "Vault.modify must not be planned for background note updates"],
    [/\bvault\.delete\s*\(/, "vault.delete must not be planned"],
    [/innerHTML|outerHTML|insertAdjacentHTML/, "HTML injection APIs must not be planned"]
  ];

  for (const [pattern, message] of planningRules) {
    for (const match of text.matchAll(new RegExp(pattern, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
      const lineStart = text.lastIndexOf("\n", match.index ?? 0) + 1;
      const lineEnd = text.indexOf("\n", match.index ?? 0);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      if (!/\b(avoid|forbid|remove|replace|migrate|do not|don't|must not|instead|no longer|without)\b/i.test(line)) {
        fail(relativePath, message, lineNumber(text, match.index ?? 0));
      }
    }
  }
}

function walk(dirPath, extensions) {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(child, extensions));
      continue;
    }

    if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (error) {
    fail(filePath, `must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function readText(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return "";
  }

  return readFileSync(absolutePath, "utf8");
}

function exists(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  return existsSync(absolutePath);
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function fail(filePath, message, line) {
  const relativePath = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
  failures.push(`${relativePath}${line ? `:${line}` : ""} - ${message}`);
}
