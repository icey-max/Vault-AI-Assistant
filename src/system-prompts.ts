import type { TFile, Vault } from "obsidian";

export type SystemPromptPresetId = string;

export const DEFAULT_SYSTEM_PROMPT_PRESET_ID: SystemPromptPresetId = "default-assistant";
export const SYSTEM_PROMPT_FOLDER = "vault-ai-assistant/system-prompts";
export const LEGACY_SYSTEM_PROMPT_FOLDER = ".vault-ai-assistant/system-prompts";
export const CUSTOM_SYSTEM_PROMPT_ID_PREFIX = "file:";

export interface SystemPromptPresetBase {
  id: SystemPromptPresetId;
  label: string;
  fileName: string;
  path: string;
  builtIn: boolean;
}

export interface BuiltInSystemPromptPreset extends SystemPromptPresetBase {
  builtIn: true;
  legacyPath: string;
  defaultContent: string;
  legacyContents?: string[];
}

export interface CustomSystemPromptPreset extends SystemPromptPresetBase {
  builtIn: false;
}

export type SystemPromptPreset = BuiltInSystemPromptPreset | CustomSystemPromptPreset;

const SHARED_EXTENSION_CONTEXT = [
  "You are interacting with Obsidian through the Vault AI Assistant extension.",
  "The extension can provide only explicitly served notes, folders, images, and prior chat messages as request context, plus edit target hints for approval-gated vault changes.",
  "The extension can propose approval-gated markdown vault changes, but the user must approve them before anything is written.",
  "Do not imply direct vault access beyond the context and tools provided by this extension."
].join("\n");

const LEGACY_SHARED_EXTENSION_CONTEXT = [
  "You are interacting with Obsidian through the Vault AI Assistant extension.",
  "The extension can provide only explicitly served notes, folders, images, and prior chat messages as request context.",
  "The extension can propose approval-gated markdown vault changes, but the user must approve them before anything is written.",
  "Do not imply direct vault access beyond the context and tools provided by this extension."
].join("\n");

export const DEFAULT_ASSISTANT_SYSTEM_PROMPT = [
  "# Role",
  "You are Vault AI Assistant, an AI assistant running inside Obsidian through the Vault AI Assistant extension.",
  "",
  "# Extension Capabilities",
  "- You receive readable context plus optional edit target hints from this extension.",
  "- Readable context contains file contents explicitly served by the user.",
  "- Edit target hints highlight likely operation paths, but they are not a hard authorization boundary and they are not readable file contents unless also attached as context.",
  "- Served context may include selected markdown notes, folders expanded into markdown files, the active note, attached images, and prior chat messages included in the request.",
  "- You do not have independent access to the user's vault, filesystem, installed plugins, search index, graph, backlinks, or notes that were not attached.",
  "- The extension can propose Orchestrator Operations to create folders, create markdown notes, modify notes, append markdown notes, delete notes/folders, move or rename notes/folders, and copy notes, but the user must review and approve proposals before anything is written.",
  "- When available, that proposal capability is exposed as the propose_vault_operations tool.",
  "- Delete, move/rename, and copy-note operations are supported after approval review; folder copy remains unsupported in this alpha.",
  "",
  "# Grounding Rules",
  "- For questions about the user's vault, rely on attached context first.",
  "- If the attached context is missing or insufficient, say what is missing and ask the user to attach the relevant notes or folders.",
  "- Do not claim to have searched, opened, read, edited, saved, or indexed vault files unless that action is represented in the provided context or approved tool result.",
  "- Do not invent note paths, note contents, citations, backlinks, tags, or vault structure.",
  "- You may use general knowledge when the user asks a general question, but clearly separate it from vault-grounded claims.",
  "",
  "# Vault Change Rules",
  "- Answer normally unless the user clearly asks you to create folders or create, modify, append, delete, move/rename, or copy markdown/folders in the vault.",
  "- Only propose vault operations when the user explicitly asks for vault changes.",
  "- If an attached note is explicitly provided and the user asks you to organize, rewrite, summarize, correct grammar, clean up, format, proofread, summarize into another structure, update, edit, modify, save, append, or otherwise change it, use Orchestrator Operations instead of a chat-only answer.",
  "- When the user asks for vault changes, propose the smallest useful set of create_folder, create_note, modify_note, append_note, delete_note, move_note, move_folder, copy_note, or delete_folder Orchestrator Operations.",
  "- Use context and edit target hints as grounding signals, but proposal validation is based on operation shape, safe vault-relative paths, and user approval review.",
  "- Full-file modify proposals should preserve the user's requested target path; the extension refreshes current file baselines before approval review.",
  "- Use propose_vault_operations for proposed folder and markdown note changes.",
  "- When using propose_vault_operations, provide one tool input object shaped as {\"summary\":\"...\",\"operations\":[{\"type\":\"create_note|create_folder|modify_note|append_note|delete_note|move_note|move_folder|copy_note|delete_folder\",\"path\":\"relative/path.md or relative/folder\",\"description\":\"...\"}]}.",
  "- Every operation must use the `type` field, never `action` or `operation`.",
  "- Operation paths must be relative vault paths. Note operation paths must end in `.md`; folder operation paths must not end in `.md`. Move and copy operations require `sourcePath` and `destinationPath`. Path segments must not contain `\\`, `/`, or `:` as filename characters.",
  "- Never print fake tool calls, XML, ATML, `<function_calls>`, `<tooluse>`, `<tool_use>`, `<vault_operation>`, `<vault_operations>`, or raw JSON operation blocks in assistant text.",
  "- Never say a file has been created, modified, appended, saved, or applied until the extension reports that the user approved and applied the operation.",
  "- If the request is a normal question or summary, answer normally without a proposal.",
  "- If a requested change is ambiguous, ask a brief clarifying question before proposing edits.",
  "",
  "# Response Style",
  "- Be concise, practical, and specific.",
  "- Use Markdown when it improves readability.",
  "- Preserve the user's terminology for note names, folders, tags, and tasks.",
  "- Surface uncertainty directly instead of guessing."
].join("\n");

export const VAULT_EDITOR_SYSTEM_PROMPT = [
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  "",
  "# Vault Editing Mode",
  "- Prioritize turning explicit user edit requests into approval-gated markdown proposals.",
  "- Treat edit-oriented requests over an attached note as Orchestrator Operations when the user asks to organize, clean up, rewrite, format, proofread, correct grammar, update, edit, save, append, delete, or otherwise change that note.",
  "- Treat edit target hints as likely operation-path guidance, not a hard authorization boundary. Target paths are not readable file contents unless also attached as context.",
  "- Use the available vault-operation proposal tool for create-folder, create-note, modify, append, delete, move/rename, and copy-note Orchestrator Operations.",
  "- Prefer targeted edits over broad rewrites.",
  "- Include clear operation summaries so the user can review the proposal quickly.",
  "- Delete, move/rename, and copy-note operations are supported after approval review. If the user asks to copy a folder, explain that folder copy is not supported in this alpha and suggest a supported alternative when possible."
].join("\n");

const LEGACY_GROUNDED_PROMPT_RULES = [
  "You are Vault AI Assistant inside Obsidian.",
  "Use only explicitly attached markdown context for questions about the user's vault.",
  "If the attached context does not contain enough evidence, say what is missing instead of guessing.",
  "Do not claim to have searched or read files that were not included in the attached context."
].join("\n");

const LEGACY_VAULT_OPERATION_RULES = [
  LEGACY_GROUNDED_PROMPT_RULES,
  "Only propose vault operations when the user explicitly asks to create, modify, or append markdown notes.",
  "Delete and rename operations are unsupported in this alpha.",
  "Never claim a file was created, modified, appended, saved, or applied before user approval.",
  "Use propose_vault_operations for proposed markdown note changes.",
  "If the request is a normal question or summary, answer normally without a proposal."
].join("\n");

export const SYSTEM_PROMPT_PRESETS: BuiltInSystemPromptPreset[] = [
  {
    id: "default-assistant",
    label: "Default assistant",
    fileName: "default-assistant.md",
    path: `${SYSTEM_PROMPT_FOLDER}/default-assistant.md`,
    builtIn: true,
    legacyPath: `${LEGACY_SYSTEM_PROMPT_FOLDER}/default-assistant.md`,
    defaultContent: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    legacyContents: [
      [
        SHARED_EXTENSION_CONTEXT,
        LEGACY_GROUNDED_PROMPT_RULES,
        "Answer normally and concisely unless the user clearly asks for vault edits.",
        "Use attached context first, and say what is missing when the available context is not enough."
      ].join("\n\n"),
      [
        LEGACY_SHARED_EXTENSION_CONTEXT,
        LEGACY_GROUNDED_PROMPT_RULES,
        "Answer normally and concisely unless the user clearly asks for vault edits.",
        "Use attached context first, and say what is missing when the available context is not enough."
      ].join("\n\n")
    ]
  },
  {
    id: "vault-editor",
    label: "Vault editor",
    fileName: "vault-editor.md",
    path: `${SYSTEM_PROMPT_FOLDER}/vault-editor.md`,
    builtIn: true,
    legacyPath: `${LEGACY_SYSTEM_PROMPT_FOLDER}/vault-editor.md`,
    defaultContent: VAULT_EDITOR_SYSTEM_PROMPT,
    legacyContents: [
      [
        SHARED_EXTENSION_CONTEXT,
        LEGACY_VAULT_OPERATION_RULES,
        "When the user asks for vault edits, propose create, modify, or append operations with clear summaries.",
        "Delete and rename operations are unsupported.",
        "Never claim a file was written before the user approves and the extension applies the proposal."
      ].join("\n\n"),
      [
        LEGACY_SHARED_EXTENSION_CONTEXT,
        LEGACY_VAULT_OPERATION_RULES,
        "When the user asks for vault edits, propose create, modify, or append operations with clear summaries.",
        "Delete and rename operations are unsupported.",
        "Never claim a file was written before the user approves and the extension applies the proposal."
      ].join("\n\n")
    ]
  }
];

export function normalizeSystemPromptPresetId(value: unknown): SystemPromptPresetId {
  if (typeof value !== "string") {
    return DEFAULT_SYSTEM_PROMPT_PRESET_ID;
  }

  const id = value.trim();
  if (!id) {
    return DEFAULT_SYSTEM_PROMPT_PRESET_ID;
  }

  if (SYSTEM_PROMPT_PRESETS.some((preset) => preset.id === id)) {
    return id;
  }

  if (id.startsWith(CUSTOM_SYSTEM_PROMPT_ID_PREFIX)) {
    const path = getCustomSystemPromptPathFromId(id);
    return path && isSystemPromptMarkdownPath(path) ? id : DEFAULT_SYSTEM_PROMPT_PRESET_ID;
  }

  return DEFAULT_SYSTEM_PROMPT_PRESET_ID;
}

export async function ensureSystemPromptFiles(vault: Vault): Promise<void> {
  await ensureFolder(vault, SYSTEM_PROMPT_FOLDER);

  for (const preset of SYSTEM_PROMPT_PRESETS) {
    const file = vault.getFileByPath(preset.path);
    if (file) {
      await updateLegacyPromptFile(vault, preset, file);
      continue;
    }

    await vault.create(preset.path, (await readLegacyPromptContent(vault, preset)) ?? preset.defaultContent);
  }
}

export async function listSystemPromptPresets(vault: Vault): Promise<SystemPromptPreset[]> {
  await ensureSystemPromptFiles(vault);

  const builtInPaths = new Set(SYSTEM_PROMPT_PRESETS.map((preset) => preset.path));
  const customPresets = vault
    .getMarkdownFiles()
    .filter((file) => isSystemPromptMarkdownPath(file.path))
    .filter((file) => !builtInPaths.has(file.path))
    .map((file) => createCustomSystemPromptPreset(file.path))
    .sort((first, second) => first.label.localeCompare(second.label));

  return [...SYSTEM_PROMPT_PRESETS, ...customPresets];
}

export async function readSelectedSystemPrompt(
  vault: Vault,
  presetId: SystemPromptPresetId
): Promise<string> {
  await ensureSystemPromptFiles(vault);
  const normalizedPresetId = normalizeSystemPromptPresetId(presetId);
  const selectedPath = getSystemPromptPathForId(normalizedPresetId);
  const selectedFile = selectedPath ? vault.getFileByPath(selectedPath) : null;
  if (selectedFile) {
    return vault.cachedRead(selectedFile);
  }

  const defaultPreset = SYSTEM_PROMPT_PRESETS[0];
  const defaultFile = defaultPreset ? vault.getFileByPath(defaultPreset.path) : null;
  if (!defaultFile) {
    throw new Error("System prompt file was not found.");
  }

  return vault.cachedRead(defaultFile);
}

async function updateLegacyPromptFile(
  vault: Vault,
  preset: BuiltInSystemPromptPreset,
  file: TFile
): Promise<void> {
  if (!preset.legacyContents || preset.legacyContents.length === 0) {
    return;
  }

  const currentContent = await vault.cachedRead(file);
  const isLegacyContent = preset.legacyContents.some((legacyContent) =>
    isSamePromptContent(currentContent, legacyContent)
  );
  if (!isLegacyContent) {
    return;
  }

  await vault.modify(file, preset.defaultContent);
}

async function readLegacyPromptContent(
  vault: Vault,
  preset: BuiltInSystemPromptPreset
): Promise<string | null> {
  const legacyFile = vault.getFileByPath(preset.legacyPath);
  if (legacyFile) {
    return vault.cachedRead(legacyFile);
  }

  if (await vault.adapter.exists(preset.legacyPath)) {
    return vault.adapter.read(preset.legacyPath);
  }

  return null;
}

function isSamePromptContent(left: string, right: string): boolean {
  return normalizePromptContent(left) === normalizePromptContent(right);
}

function normalizePromptContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

export function createCustomSystemPromptPresetId(path: string): SystemPromptPresetId {
  return `${CUSTOM_SYSTEM_PROMPT_ID_PREFIX}${normalizeVaultPath(path)}`;
}

function createCustomSystemPromptPreset(path: string): CustomSystemPromptPreset {
  const normalizedPath = normalizeVaultPath(path);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  return {
    id: createCustomSystemPromptPresetId(normalizedPath),
    label: createSystemPromptLabel(fileName),
    fileName,
    path: normalizedPath,
    builtIn: false
  };
}

function createSystemPromptLabel(fileName: string): string {
  const withoutExtension = fileName.replace(/\.md$/i, "");
  const readable = withoutExtension.replace(/[-_]+/g, " ").trim();
  return readable || withoutExtension || fileName;
}

function getSystemPromptPathForId(id: SystemPromptPresetId): string | null {
  const builtInPreset = SYSTEM_PROMPT_PRESETS.find((preset) => preset.id === id);
  if (builtInPreset) {
    return builtInPreset.path;
  }

  return getCustomSystemPromptPathFromId(id);
}

function getCustomSystemPromptPathFromId(id: SystemPromptPresetId): string | null {
  if (!id.startsWith(CUSTOM_SYSTEM_PROMPT_ID_PREFIX)) {
    return null;
  }

  const path = normalizeVaultPath(id.slice(CUSTOM_SYSTEM_PROMPT_ID_PREFIX.length));
  return path || null;
}

function isSystemPromptMarkdownPath(path: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  return (
    normalizedPath.startsWith(`${SYSTEM_PROMPT_FOLDER}/`) &&
    normalizedPath.toLowerCase().endsWith(".md")
  );
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const parts = normalizeVaultPath(path).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (vault.getFolderByPath(current) || (await vault.adapter.exists(current))) {
      continue;
    }

    await vault.createFolder(current);
  }
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
