export type VaultOperationType =
  | "create_note"
  | "create_folder"
  | "modify_note"
  | "append_note"
  | "delete_note"
  | "move_note"
  | "move_folder"
  | "copy_note"
  | "delete_folder";
export type VaultOperationStatus =
  | "pending"
  | "applying"
  | "applied"
  | "rejected"
  | "failed"
  | "invalid";

export interface VaultOperationBase {
  id: string;
  type: VaultOperationType;
  path: string;
  description: string;
  rationale?: string;
  status: VaultOperationStatus;
  error?: string;
  preview?: string;
  baseContentHash?: string;
  baseContentLength?: number;
  appliedAt?: string;
}

export interface CreateNoteOperation extends VaultOperationBase {
  type: "create_note";
  content: string;
}

export interface CreateFolderOperation extends VaultOperationBase {
  type: "create_folder";
}

export interface ModifyNoteOperation extends VaultOperationBase {
  type: "modify_note";
  previousContent: string;
  newContent: string;
  diff?: string;
}

export interface AppendNoteOperation extends VaultOperationBase {
  type: "append_note";
  content: string;
  appendMode: "end";
}

export interface DeleteNoteOperation extends VaultOperationBase {
  type: "delete_note";
}

export interface MoveNoteOperation extends VaultOperationBase {
  type: "move_note";
  sourcePath: string;
  destinationPath: string;
}

export interface MoveFolderOperation extends VaultOperationBase {
  type: "move_folder";
  sourcePath: string;
  destinationPath: string;
}

export interface CopyNoteOperation extends VaultOperationBase {
  type: "copy_note";
  sourcePath: string;
  destinationPath: string;
}

export interface DeleteFolderOperation extends VaultOperationBase {
  type: "delete_folder";
}

export type VaultOperation =
  | CreateNoteOperation
  | CreateFolderOperation
  | ModifyNoteOperation
  | AppendNoteOperation
  | DeleteNoteOperation
  | MoveNoteOperation
  | MoveFolderOperation
  | CopyNoteOperation
  | DeleteFolderOperation;

export interface VaultOperationProposal {
  id: string;
  summary: string;
  createdAt: string;
  operations: VaultOperation[];
  source?: string;
}

export interface RawVaultOperationBase {
  id?: unknown;
  type?: unknown;
  path?: unknown;
  sourcePath?: unknown;
  destinationPath?: unknown;
  templatePath?: unknown;
  contentSourcePath?: unknown;
  title?: unknown;
  description?: unknown;
  rationale?: unknown;
  baseContentHash?: unknown;
  baseContentLength?: unknown;
}

export interface RawCreateNoteOperation extends RawVaultOperationBase {
  type?: "create_note";
  content?: unknown;
}

export interface RawCreateFolderOperation extends RawVaultOperationBase {
  type?: "create_folder";
}

export interface RawModifyNoteOperation extends RawVaultOperationBase {
  type?: "modify_note";
  previousContent?: unknown;
  newContent?: unknown;
}

export interface RawAppendNoteOperation extends RawVaultOperationBase {
  type?: "append_note";
  content?: unknown;
  appendMode?: unknown;
}

export interface RawDeleteNoteOperation extends RawVaultOperationBase {
  type?: "delete_note";
}

export interface RawMoveNoteOperation extends RawVaultOperationBase {
  type?: "move_note";
}

export interface RawMoveFolderOperation extends RawVaultOperationBase {
  type?: "move_folder";
}

export interface RawCopyNoteOperation extends RawVaultOperationBase {
  type?: "copy_note";
}

export interface RawDeleteFolderOperation extends RawVaultOperationBase {
  type?: "delete_folder";
}

export type RawVaultOperation =
  | RawCreateNoteOperation
  | RawCreateFolderOperation
  | RawModifyNoteOperation
  | RawAppendNoteOperation
  | RawDeleteNoteOperation
  | RawMoveNoteOperation
  | RawMoveFolderOperation
  | RawCopyNoteOperation
  | RawDeleteFolderOperation
  | RawVaultOperationBase;

export interface RawVaultOperationProposal {
  id?: unknown;
  summary?: unknown;
  operations?: unknown;
  source?: unknown;
}

export type VaultOperationValidationResult =
  | { ok: true; proposal: VaultOperationProposal }
  | { ok: false; errors: string[] };

export interface VaultOperationToolSchema {
  name: "propose_vault_operations";
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export function validateVaultOperationProposal(
  input: unknown,
  options: { now?: string; idPrefix?: string } = {}
): VaultOperationValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["Proposal must be an object."] };
  }

  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) {
    errors.push("Proposal summary is required.");
  }

  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    errors.push("Proposal must include at least one operation.");
  }

  const operations: VaultOperation[] = [];
  if (Array.isArray(input.operations)) {
    input.operations.forEach((rawOperation, index) => {
      const operation = validateOperation(rawOperation, index, errors);
      if (operation) {
        operations.push(operation);
      }
    });
  }

  if (errors.length === 0) {
    validateBatchOperationConflicts(operations, errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const idPrefix = options.idPrefix ?? "proposal";
  return {
    ok: true,
    proposal: {
      id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : `${idPrefix}-1`,
      summary,
      createdAt: options.now ?? new Date().toISOString(),
      operations,
      source: typeof input.source === "string" && input.source.trim() ? input.source.trim() : undefined
    }
  };
}

export function isSafeMarkdownPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\")) {
    return false;
  }

  const segments = trimmed.split("/");
  if (segments.some((segment) => !segment || segment === ".." || segment.includes(":"))) {
    return false;
  }

  return path.toLowerCase().endsWith(".md");
}

export function isSafeVaultFolderPath(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, "");
  if (
    !trimmed ||
    trimmed === "/" ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.toLowerCase().endsWith(".md")
  ) {
    return false;
  }

  const segments = trimmed.split("/");
  return !segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes(":"));
}

export function createUnifiedDiff(
  path: string,
  previousContent: string,
  newContent: string
): string {
  const previousLines = splitLines(previousContent);
  const newLines = splitLines(newContent);
  const lineCount = Math.max(previousLines.length, newLines.length);
  const lines = [`--- ${path}`, `+++ ${path}`];

  for (let index = 0; index < lineCount; index += 1) {
    const previousLine = previousLines[index];
    const newLine = newLines[index];
    if (previousLine === newLine && previousLine !== undefined) {
      lines.push(` ${previousLine}`);
      continue;
    }

    if (previousLine !== undefined) {
      lines.push(`-${previousLine}`);
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
    }
  }

  return lines.join("\n");
}

export function createOperationPreview(operation: VaultOperation): string {
  if (operation.type === "create_note") {
    return operation.content;
  }

  if (operation.type === "create_folder") {
    return `Create folder after approval\n\nPath: ${operation.path}`;
  }

  if (operation.type === "modify_note") {
    return operation.diff ?? createUnifiedDiff(operation.path, operation.previousContent, operation.newContent);
  }

  if (operation.type === "delete_note") {
    return `Delete note after approval\n\nPath: ${operation.path}`;
  }

  if (operation.type === "delete_folder") {
    return `Delete folder after approval\n\nPath: ${operation.path}`;
  }

  if (operation.type === "move_note" || operation.type === "move_folder") {
    return [
      `${operation.type === "move_note" ? "Move note" : "Move folder"} after approval`,
      "",
      `Source: ${operation.sourcePath}`,
      `Destination: ${operation.destinationPath}`
    ].join("\n");
  }

  if (operation.type === "copy_note") {
    return [
      "Copy note after approval",
      "",
      `Source: ${operation.sourcePath}`,
      `Destination: ${operation.destinationPath}`
    ].join("\n");
  }

  return `Append to end of note\n\n${operation.content}`;
}

export function createContentHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createVaultOperationToolSchema(): VaultOperationToolSchema {
  return {
    name: "propose_vault_operations",
    description:
      "Propose markdown note and folder vault operations for user approval. These are proposals only and must not be described as already applied.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "operations"],
      properties: {
        summary: {
          type: "string",
          description: "A short summary of the proposed vault changes."
        },
        operations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "path", "description"],
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "create_note",
                  "create_folder",
                  "modify_note",
                  "append_note",
                  "delete_note",
                  "move_note",
                  "move_folder",
                  "copy_note",
                  "delete_folder"
                ]
              },
              path: {
                type: "string",
                description:
                  "Primary relative vault path. For move_note, move_folder, and copy_note this is the source path."
              },
              sourcePath: {
                type: "string",
                description: "Required source path for move_note, move_folder, and copy_note."
              },
              destinationPath: {
                type: "string",
                description: "Required destination path for move_note, move_folder, and copy_note."
              },
              description: {
                type: "string",
                description: "A concise description of this proposed file change."
              },
              rationale: { type: "string" },
              content: {
                type: "string",
                description:
                  "Required for create_note and append_note operations unless create_note uses templatePath with an attached readable markdown template."
              },
              templatePath: {
                type: "string",
                description:
                  "Optional attached readable markdown template path for create_note. Use for many notes that share the same template instead of repeating the full template content."
              },
              contentSourcePath: {
                type: "string",
                description:
                  "Alias for templatePath. Must refer to an attached readable markdown context file."
              },
              title: {
                type: "string",
                description:
                  "Optional title used to fill common template title placeholders or the first markdown heading when templatePath/contentSourcePath is used."
              },
              previousContent: {
                type: "string",
                description: "Required for modify_note operations."
              },
              newContent: {
                type: "string",
                description: "Required for modify_note operations."
              },
              appendMode: {
                type: "string",
                enum: ["end"],
                description: "Append placement. Phase 4 supports only end-of-note append."
              },
              baseContentHash: {
                type: "string",
                description: "Optional conflict baseline captured before review for existing-file operations."
              },
              baseContentLength: {
                type: "number",
                description: "Optional conflict baseline length captured before review for existing-file operations."
              }
            }
          }
        }
      }
    }
  };
}

function validateOperation(
  rawOperation: unknown,
  index: number,
  errors: string[]
): VaultOperation | null {
  if (!isRecord(rawOperation)) {
    errors.push(`Operation ${index + 1} must be an object.`);
    return null;
  }

  const type = rawOperation.type;
  if (
    type !== "create_note" &&
    type !== "create_folder" &&
    type !== "modify_note" &&
    type !== "append_note" &&
    type !== "delete_note" &&
    type !== "move_note" &&
    type !== "move_folder" &&
    type !== "copy_note" &&
    type !== "delete_folder"
  ) {
    errors.push(`Operation ${index + 1} has unsupported operation type.`);
    return null;
  }

  const rawPath = typeof rawOperation.path === "string" ? rawOperation.path.trim() : "";
  const rawSourcePath = typeof rawOperation.sourcePath === "string" ? rawOperation.sourcePath.trim() : "";
  const rawDestinationPath =
    typeof rawOperation.destinationPath === "string" ? rawOperation.destinationPath.trim() : "";
  const sourcePath = getPrimarySourcePath(type, rawPath, rawSourcePath);
  const destinationPath =
    type === "move_folder"
      ? rawDestinationPath.replace(/\/+$/, "")
      : rawDestinationPath;
  const path =
    type === "create_folder" || type === "delete_folder"
      ? rawPath.replace(/\/+$/, "")
      : type === "move_note" || type === "move_folder" || type === "copy_note"
        ? sourcePath
        : rawPath;

  if (type === "move_note" || type === "copy_note") {
    if (!sourcePath) {
      errors.push(`Operation ${index + 1} ${type} sourcePath is required.`);
    } else if (!isSafeMarkdownPath(sourcePath)) {
      errors.push(`Operation ${index + 1} has an unsafe source markdown path.`);
    }
    if (!destinationPath) {
      errors.push(`Operation ${index + 1} ${type} destinationPath is required.`);
    } else if (!isSafeMarkdownPath(destinationPath)) {
      errors.push(`Operation ${index + 1} has an unsafe destination markdown path.`);
    }
  } else if (type === "move_folder") {
    if (!sourcePath) {
      errors.push(`Operation ${index + 1} move_folder sourcePath is required.`);
    } else if (!isSafeVaultFolderPath(sourcePath)) {
      errors.push(`Operation ${index + 1} has an unsafe source folder path.`);
    }
    if (!destinationPath) {
      errors.push(`Operation ${index + 1} move_folder destinationPath is required.`);
    } else if (!isSafeVaultFolderPath(destinationPath)) {
      errors.push(`Operation ${index + 1} has an unsafe destination folder path.`);
    }
  } else if (type === "create_folder" || type === "delete_folder") {
    if (!isSafeVaultFolderPath(path)) {
      errors.push(`Operation ${index + 1} has an unsafe folder path.`);
    }
  } else if (!isSafeMarkdownPath(path)) {
    errors.push(`Operation ${index + 1} has an unsafe markdown path.`);
  }

  const description =
    typeof rawOperation.description === "string" && rawOperation.description.trim()
      ? rawOperation.description.trim()
      : `${getOperationLabel(type)} ${path || "note"}`;
  const base = {
    id:
      typeof rawOperation.id === "string" && rawOperation.id.trim()
        ? rawOperation.id.trim()
        : `operation-${index + 1}`,
    path,
    description,
    rationale:
      typeof rawOperation.rationale === "string" && rawOperation.rationale.trim()
        ? rawOperation.rationale.trim()
        : undefined,
    status: "pending" as const,
    baseContentHash:
      typeof rawOperation.baseContentHash === "string" && rawOperation.baseContentHash.trim()
        ? rawOperation.baseContentHash.trim()
        : undefined,
    baseContentLength:
      typeof rawOperation.baseContentLength === "number" && Number.isFinite(rawOperation.baseContentLength)
        ? rawOperation.baseContentLength
        : undefined
  };

  if (type === "move_note") {
    const operation: MoveNoteOperation = {
      ...base,
      type,
      sourcePath,
      destinationPath
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "move_folder") {
    const operation: MoveFolderOperation = {
      ...base,
      type,
      sourcePath,
      destinationPath
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "copy_note") {
    const operation: CopyNoteOperation = {
      ...base,
      type,
      sourcePath,
      destinationPath
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "create_note") {
    if (typeof rawOperation.content !== "string") {
      errors.push(`Operation ${index + 1} create_note content is required.`);
      return null;
    }
    const operation: CreateNoteOperation = {
      ...base,
      type,
      content: rawOperation.content
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "create_folder") {
    const operation: CreateFolderOperation = {
      ...base,
      type
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "modify_note") {
    if (
      typeof rawOperation.previousContent !== "string" ||
      typeof rawOperation.newContent !== "string"
    ) {
      errors.push(`Operation ${index + 1} modify_note previousContent and newContent are required.`);
      return null;
    }
    const diff = createUnifiedDiff(path, rawOperation.previousContent, rawOperation.newContent);
    return {
      ...base,
      type,
      previousContent: rawOperation.previousContent,
      newContent: rawOperation.newContent,
      diff,
      preview: diff
    };
  }

  if (type === "delete_note") {
    const operation: DeleteNoteOperation = {
      ...base,
      type
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (type === "delete_folder") {
    const operation: DeleteFolderOperation = {
      ...base,
      type
    };
    return { ...operation, preview: createOperationPreview(operation) };
  }

  if (typeof rawOperation.content !== "string") {
    errors.push(`Operation ${index + 1} append_note content is required.`);
    return null;
  }
  const operation: AppendNoteOperation = {
    ...base,
    type,
    content: rawOperation.content,
    appendMode: "end"
  };
  return { ...operation, preview: createOperationPreview(operation) };
}

function validateBatchOperationConflicts(operations: VaultOperation[], errors: string[]): void {
  const primaryPathOwners = new Map<string, string[]>();
  const destinationPathOwners = new Map<string, string[]>();

  for (const operation of operations) {
    addPathOwner(primaryPathOwners, operation.path, operation.id);

    const destinationPath = getDestinationPath(operation);
    if (destinationPath) {
      addPathOwner(destinationPathOwners, destinationPath, operation.id);
    }
  }

  for (const [path, owners] of primaryPathOwners) {
    if (owners.length > 1) {
      errors.push(`Proposal has conflicting operations on one primary path: ${path}.`);
    }
  }

  for (const [path, owners] of destinationPathOwners) {
    if (owners.length > 1) {
      errors.push(`Proposal has conflicting destination path: ${path}.`);
    }
  }
}

function getDestinationPath(operation: VaultOperation): string | undefined {
  if (
    operation.type === "create_note" ||
    operation.type === "create_folder" ||
    operation.type === "move_note" ||
    operation.type === "move_folder" ||
    operation.type === "copy_note"
  ) {
    return operation.type === "move_note" ||
      operation.type === "move_folder" ||
      operation.type === "copy_note"
      ? operation.destinationPath
      : operation.path;
  }

  return undefined;
}

function addPathOwner(ownersByPath: Map<string, string[]>, path: string, owner: string): void {
  const owners = ownersByPath.get(path) ?? [];
  owners.push(owner);
  ownersByPath.set(path, owners);
}

function getPrimarySourcePath(
  type: VaultOperationType,
  rawPath: string,
  rawSourcePath: string
): string {
  if (type === "move_folder") {
    return rawSourcePath.replace(/\/+$/, "");
  }
  if (type === "move_note" || type === "copy_note") {
    return rawSourcePath;
  }

  return rawPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }

  return value.replace(/\n$/, "").split("\n");
}

function getOperationLabel(type: VaultOperationType): string {
  if (type === "create_note") {
    return "Create";
  }
  if (type === "create_folder") {
    return "Create folder";
  }
  if (type === "modify_note") {
    return "Modify";
  }
  if (type === "delete_note") {
    return "Delete";
  }
  if (type === "move_note") {
    return "Move";
  }
  if (type === "move_folder") {
    return "Move folder";
  }
  if (type === "copy_note") {
    return "Copy";
  }
  if (type === "delete_folder") {
    return "Delete folder";
  }
  return "Append";
}
