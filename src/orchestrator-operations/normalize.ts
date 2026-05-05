const OPERATION_TYPE_ALIASES: Record<string, string> = {
  append: "append_note",
  copy: "copy_note",
  copy_file: "copy_note",
  copy_note: "copy_note",
  create: "create_note",
  create_directory: "create_folder",
  create_folder: "create_folder",
  create_file: "create_note",
  delete: "delete_note",
  delete_folder: "delete_folder",
  duplicate: "copy_note",
  duplicate_file: "copy_note",
  duplicate_note: "copy_note",
  edit: "modify_note",
  folder: "create_folder",
  make_folder: "create_folder",
  mkdir: "create_folder",
  modify: "modify_note",
  move_file: "move_note",
  move_folder: "move_folder",
  move_note: "move_note",
  relocate_file: "move_note",
  relocate_folder: "move_folder",
  relocate_note: "move_note",
  remove_folder: "delete_folder",
  rename_file: "move_note",
  rename_folder: "move_folder",
  rename_note: "move_note",
  rmdir: "delete_folder",
  trash_folder: "delete_folder",
  update: "modify_note",
  append_note: "append_note",
  delete_note: "delete_note",
  modify_note: "modify_note"
};

export function normalizeOrchestratorOperationProposal(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const normalized: Record<string, unknown> = { ...input };
  if (Array.isArray(input.operations)) {
    normalized.operations = input.operations.map(normalizeOperation);
  }

  return normalized;
}

function normalizeOperation(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const type =
    typeof input.type === "string"
      ? input.type
      : typeof input.action === "string"
        ? input.action
        : typeof input.operation === "string"
          ? input.operation
          : undefined;
  if (!type) {
    return { ...input };
  }

  const operation = withoutOperationAliases(input);
  const normalizedType = OPERATION_TYPE_ALIASES[type] ?? type;
  if (normalizedType === "move_note" || normalizedType === "copy_note") {
    const sourcePath = normalizeMarkdownPath(
      firstString(
        operation.sourcePath,
        operation.source,
        operation.oldPath,
        operation.old_path,
        operation.from,
        operation.path
      )
    );
    const destinationPath = normalizeMarkdownPath(
      firstString(
        operation.destinationPath,
        operation.destination,
        operation.newPath,
        operation.new_path,
        operation.to
      )
    );
    return {
      ...operation,
      type: normalizedType,
      path: sourcePath,
      sourcePath,
      destinationPath
    };
  }

  if (normalizedType === "move_folder") {
    const sourcePath = normalizeFolderPath(
      firstString(
        operation.sourcePath,
        operation.source,
        operation.oldPath,
        operation.old_path,
        operation.from,
        operation.path
      )
    );
    const destinationPath = normalizeFolderPath(
      firstString(
        operation.destinationPath,
        operation.destination,
        operation.newPath,
        operation.new_path,
        operation.to
      )
    );
    return {
      ...operation,
      type: normalizedType,
      path: sourcePath,
      sourcePath,
      destinationPath
    };
  }

  const normalized: Record<string, unknown> = {
    ...operation,
    type: normalizedType,
    path:
      normalizedType === "create_folder" || normalizedType === "delete_folder"
        ? normalizeFolderPath(operation.path)
        : normalizeMarkdownPath(operation.path)
  };

  if (typeof normalized.content !== "string") {
    normalized.content = firstString(operation.markdown, operation.text, operation.body);
  }
  if (typeof normalized.previousContent !== "string") {
    normalized.previousContent = firstString(
      operation.previous_content,
      operation.oldContent,
      operation.old_content
    );
  }
  if (typeof normalized.newContent !== "string") {
    normalized.newContent = firstString(operation.new_content);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutOperationAliases(input: Record<string, unknown>): Record<string, unknown> {
  const operation: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== "action" && key !== "operation") {
      operation[key] = value;
    }
  }

  return operation;
}

function normalizeMarkdownPath(path: unknown): unknown {
  if (typeof path !== "string") {
    return path;
  }

  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.toLowerCase().endsWith(".md")) {
    return sanitizeObsidianPathSegments(trimmed);
  }

  const name = trimmed.split("/").pop() ?? "";
  if (!name || name.includes(".")) {
    return sanitizeObsidianPathSegments(trimmed);
  }

  return sanitizeObsidianPathSegments(`${trimmed}.md`);
}

function normalizeFolderPath(path: unknown): unknown {
  if (typeof path !== "string") {
    return path;
  }

  return sanitizeObsidianPathSegments(path.trim().replace(/^\/+/, "").replace(/\/+$/, ""));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function sanitizeObsidianPathSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.replace(/:/g, " -").replace(/\s+/g, " ").trim())
    .join("/");
}
