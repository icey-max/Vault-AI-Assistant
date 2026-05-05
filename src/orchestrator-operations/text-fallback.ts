import type { ContextPackageFile } from "../context-utils";

export interface TextOrchestratorOperationExtraction {
  text: string;
  payloads: unknown[];
  matchedOperationText: boolean;
  strippedOperationText: boolean;
  strippedIncompleteOperationText: boolean;
}

const RAW_OPERATION_BLOCK_PATTERN =
  /<function_?calls\b[^>]*>[\s\S]*?<\/function_?calls>|<tool_?use\b[^>]*>[\s\S]*?<\/tool_(?:invoke|use)>|<vault_operations?\b[^>]*>[\s\S]*?<\/vault_operations?>/gi;
const RAW_OPERATION_OPEN_PATTERN =
  /<function_?calls\b[^>]*>|<tool_?use\b[^>]*>|<vault_operations?\b[^>]*>/i;
const RAW_OPERATION_INCOMPLETE_PATTERN =
  /(?:<function_?calls\b[^>]*>|<tool_?use\b[^>]*>|<vault_operations?\b[^>]*>)[\s\S]*$/i;
const RAW_OPERATION_OPEN_TAGS = [
  "<function_calls",
  "<functioncalls",
  "<tooluse",
  "<tool_use",
  "<vault_operation",
  "<vault_operations"
];
const OPERATION_TYPE_HINTS = new Set([
  "append",
  "append_note",
  "copy",
  "copy_file",
  "copy_note",
  "create",
  "create_directory",
  "create_file",
  "create_folder",
  "create_note",
  "delete",
  "delete_folder",
  "delete_note",
  "duplicate",
  "duplicate_file",
  "duplicate_note",
  "edit",
  "folder",
  "make_folder",
  "mkdir",
  "modify",
  "modify_note",
  "move_file",
  "move_folder",
  "move_note",
  "relocate_file",
  "relocate_folder",
  "relocate_note",
  "remove_folder",
  "rename_file",
  "rename_folder",
  "rename_note",
  "rmdir",
  "trash_folder",
  "update"
]);

export function extractTextOrchestratorOperationPayloads(
  text: string
): TextOrchestratorOperationExtraction {
  const payloads: unknown[] = [];
  let matchedOperationText = false;
  let strippedOperationText = false;
  let strippedIncompleteOperationText = false;
  let cleaned = text.replace(RAW_OPERATION_BLOCK_PATTERN, (block) => {
    matchedOperationText = true;
    strippedOperationText = true;
    const payload = parsePayloadFromBlock(block);
    if (payload !== undefined) {
      payloads.push(payload);
    }
    return "";
  });

  cleaned = cleaned.replace(RAW_OPERATION_INCOMPLETE_PATTERN, (block) => {
    matchedOperationText = true;
    strippedOperationText = true;
    strippedIncompleteOperationText = true;
    const payload = parsePayloadFromBlock(block);
    if (payload !== undefined) {
      payloads.push(payload);
    }
    return "";
  });

  const standalone = extractStandaloneJsonOperationPayloads(cleaned);
  if (standalone.matchedOperationText || standalone.payloads.length > 0 || standalone.text !== cleaned) {
    matchedOperationText = matchedOperationText || standalone.matchedOperationText;
    strippedOperationText = strippedOperationText || standalone.strippedOperationText;
    strippedIncompleteOperationText =
      strippedIncompleteOperationText || standalone.strippedIncompleteOperationText;
    cleaned = standalone.text;
    payloads.push(...standalone.payloads);
  }

  if (!matchedOperationText) {
    return createTextExtraction(text, payloads, false, false, false);
  }

  return createTextExtraction(
    normalizeBlankLines(cleaned),
    payloads,
    matchedOperationText,
    strippedOperationText,
    strippedIncompleteOperationText
  );
}

export function stripTextOrchestratorOperationPayloads(text: string): string {
  return extractTextOrchestratorOperationPayloads(text).text;
}

export class TextOrchestratorOperationStreamFilter {
  private buffer = "";
  private quarantinedText = "";
  private quarantining = false;

  append(delta: string): string {
    this.buffer += delta;
    return this.drainVisibleText();
  }

  flushVisibleText(): string {
    if (this.quarantining || RAW_OPERATION_OPEN_PATTERN.test(this.buffer)) {
      this.quarantinedText += this.buffer;
      this.buffer = "";
      this.quarantining = false;
      return "";
    }

    const visible = this.buffer;
    this.buffer = "";
    return visible;
  }

  getQuarantinedText(): string {
    return this.quarantinedText;
  }

  private drainVisibleText(): string {
    let visible = "";

    while (this.buffer.length > 0) {
      if (this.quarantining) {
        const blockEnd = findRawOperationBlockEnd(this.buffer);
        if (blockEnd === -1) {
          this.quarantinedText += this.buffer;
          this.buffer = "";
          return visible;
        }

        this.quarantinedText += this.buffer.slice(0, blockEnd);
        this.buffer = this.buffer.slice(blockEnd);
        this.quarantining = false;
        continue;
      }

      const blockStart = findRawOperationBlockStart(this.buffer);
      if (blockStart !== -1) {
        visible += this.buffer.slice(0, blockStart);
        this.buffer = this.buffer.slice(blockStart);
        this.quarantining = true;
        continue;
      }

      const suffixLength = getPotentialRawOperationTagSuffixLength(this.buffer);
      if (suffixLength > 0) {
        visible += this.buffer.slice(0, this.buffer.length - suffixLength);
        this.buffer = this.buffer.slice(this.buffer.length - suffixLength);
        return visible;
      }

      visible += this.buffer;
      this.buffer = "";
    }

    return visible;
  }
}

export function hydrateTextOrchestratorOperationPayload(
  payload: unknown,
  contextFiles: ContextPackageFile[]
): unknown {
  const proposal = Array.isArray(payload)
    ? { summary: "Review proposed vault changes", operations: payload }
    : payload;

  if (!isRecord(proposal) || !Array.isArray(proposal.operations)) {
    return proposal;
  }

  return {
    ...proposal,
    summary:
      typeof proposal.summary === "string" && proposal.summary.trim()
        ? proposal.summary
        : "Review proposed vault changes",
    operations: proposal.operations.map((operation) => hydrateOperation(operation, contextFiles))
  };
}

function hydrateOperation(operation: unknown, contextFiles: ContextPackageFile[]): unknown {
  if (!isRecord(operation)) {
    return operation;
  }

  const type = getOperationType(operation);
  const isModify = type === "modify" || type === "edit" || type === "update" || type === "modify_note";
  if (!isModify) {
    return operation;
  }

  if (typeof operation.newContent === "string") {
    return operation;
  }

  if (typeof operation.content !== "string") {
    return operation;
  }

  const path = typeof operation.path === "string" ? operation.path.trim() : "";
  const contextFile = contextFiles.find((file) => file.path === path);

  return {
    ...operation,
    previousContent:
      typeof operation.previousContent === "string"
        ? operation.previousContent
        : contextFile?.content ?? "",
    newContent: operation.content
  };
}

function parsePayloadFromBlock(block: string): unknown {
  const inner = block
    .replace(/^<function_?calls\b[^>]*>/i, "")
    .replace(/<\/function_?calls>$/i, "")
    .replace(/^<tool_?use\b[^>]*>/i, "")
    .replace(/<\/tool_(?:invoke|use)>$/i, "")
    .replace(/^<vault_operations?\b[^>]*>/i, "")
    .replace(/<\/vault_operations?>$/i, "");
  const operationsParameter = inner.match(
    /<(?:atml:parameter|tool_parameter)\b[^>]*\bname=["']operations["'][^>]*>([\s\S]*?)<\/(?:atml:parameter|tool_parameter)>/i
  );
  if (operationsParameter?.[1]) {
    const operations = parseJsonCandidate(operationsParameter[1]);
    if (operations !== undefined) {
      return { summary: "Review proposed vault changes", operations };
    }
  }

  const direct = parseJsonCandidate(inner);
  if (direct !== undefined) {
    return direct;
  }

  const arrayStart = inner.indexOf("[");
  const arrayEnd = inner.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const parsedArray = parseJsonCandidate(inner.slice(arrayStart, arrayEnd + 1));
    if (parsedArray !== undefined) {
      return parsedArray;
    }
  }

  const objectStart = inner.indexOf("{");
  const objectEnd = inner.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return parseJsonCandidate(inner.slice(objectStart, objectEnd + 1));
  }

  return undefined;
}

function parseJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate.trim()) as unknown;
  } catch {
    return undefined;
  }
}

function extractStandaloneJsonOperationPayloads(text: string): TextOrchestratorOperationExtraction {
  const payloads: unknown[] = [];
  let cleaned = "";
  let lastIndex = 0;
  let matchedOperationText = false;
  let strippedOperationText = false;
  let strippedIncompleteOperationText = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== "{" && char !== "[") {
      continue;
    }

    const endIndex = findJsonCandidateEnd(text, index);
    if (endIndex === -1) {
      const incompleteCandidate = text.slice(index);
      if (looksLikeIncompleteOrchestratorOperationJson(incompleteCandidate)) {
        cleaned += text.slice(lastIndex, index);
        lastIndex = text.length;
        matchedOperationText = true;
        strippedOperationText = true;
        strippedIncompleteOperationText = true;
        break;
      }
      continue;
    }

    const candidate = text.slice(index, endIndex);
    const parsed = parseJsonCandidate(candidate);
    if (!looksLikeOrchestratorOperationPayload(parsed)) {
      continue;
    }

    cleaned += text.slice(lastIndex, index);
    payloads.push(parsed);
    matchedOperationText = true;
    strippedOperationText = true;
    lastIndex = endIndex;
    index = endIndex - 1;
  }

  if (!matchedOperationText) {
    return createTextExtraction(text, payloads, false, false, false);
  }

  cleaned += text.slice(lastIndex);
  return createTextExtraction(
    normalizeBlankLines(cleaned),
    payloads,
    matchedOperationText,
    strippedOperationText,
    strippedIncompleteOperationText
  );
}

function createTextExtraction(
  text: string,
  payloads: unknown[],
  matchedOperationText: boolean,
  strippedOperationText: boolean,
  strippedIncompleteOperationText: boolean
): TextOrchestratorOperationExtraction {
  return {
    text,
    payloads,
    matchedOperationText,
    strippedOperationText,
    strippedIncompleteOperationText
  };
}

function findJsonCandidateEnd(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
}

function looksLikeOrchestratorOperationPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(looksLikeOperation);
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.operations) &&
    value.operations.length > 0 &&
    value.operations.every(looksLikeOperation)
  );
}

function looksLikeOperation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const type = getOperationType(value);
  return hasOperationPathValue(value) && OPERATION_TYPE_HINTS.has(type);
}

function looksLikeIncompleteOrchestratorOperationJson(candidate: string): boolean {
  return hasOperationContainerHint(candidate) && hasOperationTypeHint(candidate) && hasOperationPathHint(candidate);
}

function hasOperationContainerHint(candidate: string): boolean {
  return /"operations"\s*:/.test(candidate) || /^\s*\[\s*\{/.test(candidate);
}

function hasOperationTypeHint(candidate: string): boolean {
  return /"(?:type|action|operation)"\s*:\s*"(?:append|append_note|copy|copy_file|copy_note|create|create_directory|create_file|create_folder|create_note|delete|delete_folder|delete_note|duplicate|duplicate_file|duplicate_note|edit|folder|make_folder|mkdir|modify|modify_note|move_file|move_folder|move_note|relocate_file|relocate_folder|relocate_note|remove_folder|rename_file|rename_folder|rename_note|rmdir|trash_folder|update)"/i.test(candidate);
}

function hasOperationPathHint(candidate: string): boolean {
  return /"(?:path|sourcePath|source|oldPath|old_path|from)"\s*:\s*"/i.test(candidate);
}

function hasOperationPathValue(value: Record<string, unknown>): boolean {
  return (
    typeof value.path === "string" ||
    typeof value.sourcePath === "string" ||
    typeof value.source === "string" ||
    typeof value.oldPath === "string" ||
    typeof value.old_path === "string" ||
    typeof value.from === "string"
  );
}

function findRawOperationBlockStart(text: string): number {
  const match = RAW_OPERATION_OPEN_PATTERN.exec(text);
  return match?.index ?? -1;
}

function findRawOperationBlockEnd(text: string): number {
  const closingPatterns = [
    /<\/function_?calls>/i,
    /<\/tool_(?:invoke|use)>/i,
    /<\/vault_operations?>/i
  ];
  let earliest = -1;
  let closingLength = 0;

  for (const pattern of closingPatterns) {
    const match = pattern.exec(text);
    if (!match) {
      continue;
    }

    if (earliest === -1 || match.index < earliest) {
      earliest = match.index;
      closingLength = match[0].length;
    }
  }

  return earliest === -1 ? -1 : earliest + closingLength;
}

function getPotentialRawOperationTagSuffixLength(text: string): number {
  const lowerText = text.toLowerCase();
  const maxLength = Math.min(
    lowerText.length,
    Math.max(...RAW_OPERATION_OPEN_TAGS.map((tag) => tag.length)) - 1
  );

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = lowerText.slice(lowerText.length - length);
    if (RAW_OPERATION_OPEN_TAGS.some((tag) => tag.startsWith(suffix))) {
      return length;
    }
  }

  return 0;
}

function normalizeBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOperationType(value: Record<string, unknown>): string {
  if (typeof value.type === "string") {
    return value.type;
  }
  if (typeof value.action === "string") {
    return value.action;
  }
  if (typeof value.operation === "string") {
    return value.operation;
  }

  return "";
}
