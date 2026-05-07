import { normalizeOrchestratorOperationProposal } from "./normalize";
import {
  validateOrchestratorOperationProposal,
  type OrchestratorOperationValidationOptions
} from "./validate";
import type { VaultOperationProposal } from "./schema";
import type { ContextPackageFile } from "../context-utils";

export const INVALID_ORCHESTRATOR_OPERATION_MESSAGE =
  "Provider returned an invalid Orchestrator Operation proposal.";

export type OrchestratorOperationControllerResult =
  | { ok: true; proposal: VaultOperationProposal }
  | {
      ok: false;
      message: typeof INVALID_ORCHESTRATOR_OPERATION_MESSAGE;
      errors: string[];
      repairPrompt: string;
    };

export function handleOrchestratorOperationPayload(
  input: unknown,
  options: OrchestratorOperationValidationOptions = {}
): OrchestratorOperationControllerResult {
  const normalized = normalizeOrchestratorOperationProposal(input);
  const hydratedCreates = hydrateTemplateBackedCreateOperations(
    normalized,
    options.contextFiles ?? []
  );
  const hydrated = hydrateContextBackedModifyOperations(
    hydratedCreates,
    options.contextFiles ?? []
  );
  const result = validateOrchestratorOperationProposal(hydrated, options);
  if (result.ok) {
    return { ok: true, proposal: result.proposal };
  }

  return {
    ok: false,
    message: INVALID_ORCHESTRATOR_OPERATION_MESSAGE,
    errors: result.errors,
    repairPrompt: createRepairPrompt(normalized, result.errors)
  };
}

function hydrateContextBackedModifyOperations(
  input: unknown,
  contextFiles: ContextPackageFile[]
): unknown {
  if (contextFiles.length === 0 || !isRecord(input) || !Array.isArray(input.operations)) {
    return input;
  }

  return {
    ...input,
    operations: input.operations.map((operation) =>
      hydrateContextBackedModifyOperation(operation, contextFiles)
    )
  };
}

function hydrateContextBackedModifyOperation(
  operation: unknown,
  contextFiles: ContextPackageFile[]
): unknown {
  if (!isRecord(operation) || operation.type !== "modify_note") {
    return operation;
  }

  const replacementContent =
    typeof operation.newContent === "string"
      ? operation.newContent
      : typeof operation.content === "string"
        ? operation.content
        : undefined;
  if (replacementContent === undefined) {
    return operation;
  }

  const hasPreviousContent = typeof operation.previousContent === "string";
  if (hasPreviousContent && typeof operation.newContent === "string") {
    return operation;
  }

  const path = firstString(operation.path);
  const contextFile = path ? contextFiles.find((file) => file.path === path) : undefined;
  if (!hasPreviousContent && !contextFile) {
    return operation;
  }

  return {
    ...operation,
    previousContent: hasPreviousContent ? operation.previousContent : contextFile?.content,
    newContent: replacementContent
  };
}

export function formatInvalidOrchestratorOperationMessage(errors: string[] = []): string {
  const details = errors
    .map((error) => error.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (details.length === 0) {
    return INVALID_ORCHESTRATOR_OPERATION_MESSAGE;
  }

  return `${INVALID_ORCHESTRATOR_OPERATION_MESSAGE} ${details.join(" ")}`;
}

function createRepairPrompt(input: unknown, errors: string[]): string {
  return [
    "Return valid Orchestrator Operation JSON only.",
    "Do not include markdown, prose, XML, ATML, or function-call wrappers.",
    "Allowed operation types: create_note, create_folder, modify_note, append_note, delete_note, move_note, move_folder, copy_note, delete_folder.",
    "Required shape: {\"summary\":\"...\",\"operations\":[{\"type\":\"create_note|create_folder|modify_note|append_note|delete_note|move_note|move_folder|copy_note|delete_folder\",\"path\":\"relative/path.md or relative/folder\",\"description\":\"...\"}]}",
    "Required fields: create_note.content unless using an attached readable templatePath plus optional title, modify_note.previousContent and modify_note.newContent, append_note.content, move_note.sourcePath and move_note.destinationPath, move_folder.sourcePath and move_folder.destinationPath, copy_note.sourcePath and copy_note.destinationPath. create_folder, delete_note, and delete_folder require no content fields.",
    "Use vault-relative paths exactly as requested by the user.",
    `Validation errors: ${errors.join("; ")}`,
    `Invalid payload: ${safeStringify(input)}`
  ].join("\n");
}

function hydrateTemplateBackedCreateOperations(
  input: unknown,
  contextFiles: ContextPackageFile[]
): unknown {
  if (contextFiles.length === 0 || !isRecord(input) || !Array.isArray(input.operations)) {
    return input;
  }

  return {
    ...input,
    operations: input.operations.map((operation) =>
      hydrateTemplateBackedCreateOperation(operation, contextFiles)
    )
  };
}

function hydrateTemplateBackedCreateOperation(
  operation: unknown,
  contextFiles: ContextPackageFile[]
): unknown {
  if (!isRecord(operation) || operation.type !== "create_note" || typeof operation.content === "string") {
    return operation;
  }

  const templatePath = getTemplatePath(operation);
  if (!templatePath) {
    return operation;
  }

  const templateFile = contextFiles.find((file) => file.path === templatePath);
  if (!templateFile) {
    return operation;
  }

  const title =
    firstString(operation.title, operation.noteTitle, operation.heading) ??
    deriveTitleFromPath(firstString(operation.path) ?? "");
  return {
    ...operation,
    content: applyTemplateTitle(templateFile.content, title)
  };
}

function getTemplatePath(operation: Record<string, unknown>): string | undefined {
  const rawPath = firstString(
    operation.templatePath,
    operation.contentSourcePath,
    operation.content_source_path,
    operation.fromTemplate
  );
  if (!rawPath) {
    return undefined;
  }

  return rawPath.trim().replace(/^\/+/, "");
}

function applyTemplateTitle(templateContent: string, title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return templateContent;
  }

  let content = templateContent;
  let replacedPlaceholder = false;
  for (const pattern of [
    /\{\{\s*title\s*\}\}/gi,
    /\{\{\s*noteTitle\s*\}\}/g,
    /\{\{\s*chapter_title\s*\}\}/gi,
    /\{\{\s*chapterTitle\s*\}\}/g,
    /\{\{\s*strategy_title\s*\}\}/gi,
    /\{\{\s*strategyTitle\s*\}\}/g,
    /\[chapter title\]/gi,
    /\[strategy title\]/gi,
    /\[strategy name\]/gi
  ]) {
    content = content.replace(pattern, () => {
      replacedPlaceholder = true;
      return trimmedTitle;
    });
  }
  if (replacedPlaceholder) {
    return content;
  }

  return replaceOrPrependHeading(content, trimmedTitle);
}

function replaceOrPrependHeading(content: string, title: string): string {
  const lines = content.split(/\r?\n/);
  const frontmatterEnd = findFrontmatterEnd(lines);
  const headingIndex = findFirstNonEmptyLine(lines, frontmatterEnd + 1);
  const headingLine = headingIndex === -1 ? undefined : lines[headingIndex];
  if (headingLine && /^#\s+/.test(headingLine.trim())) {
    const updatedLines = [...lines];
    updatedLines[headingIndex] = `# ${title}`;
    return updatedLines.join("\n");
  }

  if (frontmatterEnd >= 0) {
    const updatedLines = [...lines];
    updatedLines.splice(frontmatterEnd + 1, 0, "", `# ${title}`, "");
    return updatedLines.join("\n").replace(/\n{4,}/g, "\n\n\n");
  }

  return [`# ${title}`, "", content.replace(/^\s+/, "")].join("\n");
}

function findFrontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") {
    return -1;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      return index;
    }
  }

  return -1;
}

function findFirstNonEmptyLine(lines: string[], startIndex: number): number {
  for (let index = Math.max(0, startIndex); index < lines.length; index += 1) {
    if (lines[index]?.trim()) {
      return index;
    }
  }

  return -1;
}

function deriveTitleFromPath(path: string): string {
  const fileName = path.trim().replace(/^\/+/, "").split("/").pop() ?? "";
  return fileName.replace(/\.md$/i, "").trim();
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable payload]";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
