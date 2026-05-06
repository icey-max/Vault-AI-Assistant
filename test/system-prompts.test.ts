import assert from "node:assert/strict";
import test from "node:test";
import type { Vault } from "obsidian";
import {
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT_PRESET_ID,
  LEGACY_SYSTEM_PROMPT_FOLDER,
  SYSTEM_PROMPT_FOLDER,
  SYSTEM_PROMPT_PRESETS,
  VAULT_EDITOR_SYSTEM_PROMPT,
  createCustomSystemPromptPresetId,
  ensureSystemPromptFiles,
  listSystemPromptPresets,
  normalizeSystemPromptPresetId,
  readSelectedSystemPrompt
} from "../src/system-prompts";

test("normalizeSystemPromptPresetId accepts known ids and falls back to default", () => {
  assert.equal(normalizeSystemPromptPresetId("default-assistant"), "default-assistant");
  assert.equal(normalizeSystemPromptPresetId("vault-editor"), "vault-editor");
  assert.equal(
    normalizeSystemPromptPresetId(
      createCustomSystemPromptPresetId(`${SYSTEM_PROMPT_FOLDER}/research-editor.md`)
    ),
    createCustomSystemPromptPresetId(`${SYSTEM_PROMPT_FOLDER}/research-editor.md`)
  );
  assert.equal(normalizeSystemPromptPresetId("unknown"), DEFAULT_SYSTEM_PROMPT_PRESET_ID);
});

test("ensureSystemPromptFiles creates prompt folders and missing defaults", async () => {
  const vault = createMockVault();

  await ensureSystemPromptFiles(vault.vault);

  assert.deepEqual(vault.createFolderCalls, [
    "vault-ai-assistant",
    SYSTEM_PROMPT_FOLDER
  ]);
  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`), SYSTEM_PROMPT_PRESETS[0]?.defaultContent);
  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/vault-editor.md`), SYSTEM_PROMPT_PRESETS[1]?.defaultContent);
});

test("default prompt explains extension capabilities and vault boundaries", () => {
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /running inside Obsidian/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /explicitly served by the user/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /active note/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /attached images/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /prior chat messages/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /approval-gated markdown proposals|approve proposals/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /Delete, move\/rename, and copy-note operations are supported/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /folder copy remains unsupported/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /Do not invent note paths/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /organize, rewrite, summarize, correct grammar/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /attached note/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /Orchestrator Operations instead of a chat-only answer/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /edit target hints/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /not a hard authorization boundary/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /extension refreshes current file baselines before approval review/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /Every operation must use the `type` field, never `action`/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /move_note/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /delete_folder/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /Never print fake tool calls/);
  assert.match(DEFAULT_ASSISTANT_SYSTEM_PROMPT, /<function_calls>/);
  assert.match(VAULT_EDITOR_SYSTEM_PROMPT, /available vault-operation proposal tool/);
  assert.match(VAULT_EDITOR_SYSTEM_PROMPT, /edit-oriented requests over an attached note/);
  assert.match(VAULT_EDITOR_SYSTEM_PROMPT, /correct grammar/);
});

test("ensureSystemPromptFiles does not overwrite edited prompt files", async () => {
  const vault = createMockVault();
  vault.folders.add("vault-ai-assistant");
  vault.folders.add(SYSTEM_PROMPT_FOLDER);
  vault.files.set(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`, "edited default");

  await ensureSystemPromptFiles(vault.vault);

  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`), "edited default");
  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/vault-editor.md`), SYSTEM_PROMPT_PRESETS[1]?.defaultContent);
});

test("ensureSystemPromptFiles updates old unedited scaffold prompt files", async () => {
  const vault = createMockVault();
  vault.folders.add("vault-ai-assistant");
  vault.folders.add(SYSTEM_PROMPT_FOLDER);
  vault.files.set(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`, legacyDefaultAssistantPrompt());

  await ensureSystemPromptFiles(vault.vault);

  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`), DEFAULT_ASSISTANT_SYSTEM_PROMPT);
  assert.deepEqual(vault.processCalls, [`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`]);
});

test("ensureSystemPromptFiles migrates old hidden prompt content into visible folder", async () => {
  const vault = createMockVault();
  vault.folders.add(LEGACY_SYSTEM_PROMPT_FOLDER);
  vault.files.set(`${LEGACY_SYSTEM_PROMPT_FOLDER}/default-assistant.md`, "edited hidden prompt");

  await ensureSystemPromptFiles(vault.vault);

  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`), "edited hidden prompt");
  assert.equal(vault.files.get(`${SYSTEM_PROMPT_FOLDER}/vault-editor.md`), VAULT_EDITOR_SYSTEM_PROMPT);
});

test("readSelectedSystemPrompt creates missing defaults and returns selected content", async () => {
  const vault = createMockVault();

  const content = await readSelectedSystemPrompt(vault.vault, "vault-editor");

  assert.equal(content, SYSTEM_PROMPT_PRESETS[1]?.defaultContent);
  assert.ok(vault.files.has(`${SYSTEM_PROMPT_FOLDER}/default-assistant.md`));
  assert.ok(vault.files.has(`${SYSTEM_PROMPT_FOLDER}/vault-editor.md`));
});

test("listSystemPromptPresets discovers custom markdown prompt files after built-ins", async () => {
  const vault = createMockVault();
  vault.folders.add("vault-ai-assistant");
  vault.folders.add(SYSTEM_PROMPT_FOLDER);
  vault.files.set(`${SYSTEM_PROMPT_FOLDER}/research-editor.md`, "Research prompt");

  const presets = await listSystemPromptPresets(vault.vault);

  assert.deepEqual(
    presets.map((preset) => preset.id),
    [
      "default-assistant",
      "vault-editor",
      createCustomSystemPromptPresetId(`${SYSTEM_PROMPT_FOLDER}/research-editor.md`)
    ]
  );
  assert.equal(presets[2]?.label, "research editor");
});

test("readSelectedSystemPrompt reads custom prompt files and falls back when they disappear", async () => {
  const vault = createMockVault();
  const customPath = `${SYSTEM_PROMPT_FOLDER}/research-editor.md`;
  const customId = createCustomSystemPromptPresetId(customPath);
  vault.folders.add("vault-ai-assistant");
  vault.folders.add(SYSTEM_PROMPT_FOLDER);
  vault.files.set(customPath, "Research prompt");

  assert.equal(await readSelectedSystemPrompt(vault.vault, customId), "Research prompt");

  vault.files.delete(customPath);

  assert.equal(await readSelectedSystemPrompt(vault.vault, customId), DEFAULT_ASSISTANT_SYSTEM_PROMPT);
});

function createMockVault(): {
  vault: Vault;
  folders: Set<string>;
  files: Map<string, string>;
  createFolderCalls: string[];
  processCalls: string[];
} {
  const folders = new Set<string>();
  const files = new Map<string, string>();
  const createFolderCalls: string[] = [];
  const processCalls: string[] = [];

  const vault = {
    getFolderByPath(path: string) {
      return folders.has(path) ? ({ path } as never) : null;
    },
    async createFolder(path: string) {
      folders.add(path);
      createFolderCalls.push(path);
    },
    getFileByPath(path: string) {
      return files.has(path) ? ({ path } as never) : null;
    },
    getMarkdownFiles() {
      return Array.from(files.keys())
        .filter((path) => path.toLowerCase().endsWith(".md"))
        .map((path) => ({ path }) as never);
    },
    async create(path: string, content: string) {
      files.set(path, content);
      return { path } as never;
    },
    async process(file: { path: string }, fn: (data: string) => string) {
      const content = fn(files.get(file.path) ?? "");
      files.set(file.path, content);
      processCalls.push(file.path);
      return content;
    },
    async cachedRead(file: { path: string }) {
      return files.get(file.path) ?? "";
    },
    adapter: {
      async exists(path: string) {
        return folders.has(path) || files.has(path);
      },
      async read(path: string) {
        return files.get(path) ?? "";
      }
    }
  } as Vault;

  return { vault, folders, files, createFolderCalls, processCalls };
}

function legacyDefaultAssistantPrompt(): string {
  return [
    [
      "You are interacting with Obsidian through the Vault AI Assistant extension.",
      "The extension can provide only explicitly served notes, folders, images, and prior chat messages as request context.",
      "The extension can propose approval-gated markdown vault changes, but the user must approve them before anything is written.",
      "Do not imply direct vault access beyond the context and tools provided by this extension."
    ].join("\n"),
    [
      "You are Vault AI Assistant inside Obsidian.",
      "Use only explicitly attached markdown context for questions about the user's vault.",
      "If the attached context does not contain enough evidence, say what is missing instead of guessing.",
      "Do not claim to have searched or read files that were not included in the attached context."
    ].join("\n"),
    "Answer normally and concisely unless the user clearly asks for vault edits.",
    "Use attached context first, and say what is missing when the available context is not enough."
  ].join("\n\n");
}
