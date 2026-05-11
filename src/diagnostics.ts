import type { Vault } from "obsidian";

export interface DiagnosticLogger {
  log(event: string, details?: Record<string, unknown>): void;
}

export const DIAGNOSTIC_LOG_FOLDER = "vault-ai-assistant/diagnostics";

const REDACTED = "[redacted]";
const MAX_DETAIL_STRING_LENGTH = 320;
const MAX_DETAIL_ARRAY_ITEMS = 25;
const MAX_DETAIL_OBJECT_KEYS = 50;
const MAX_DETAIL_DEPTH = 6;

export interface DiagnosticListSummary<T> {
  total: number;
  sample: T[];
  omitted: number;
}

export class VaultDiagnosticLogger implements DiagnosticLogger {
  private vault: Vault;
  private isEnabled: () => boolean;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(vault: Vault, isEnabled: () => boolean) {
    this.vault = vault;
    this.isEnabled = isEnabled;
  }

  log(event: string, details: Record<string, unknown> = {}): void {
    if (!this.isEnabled()) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      event,
      details: sanitizeDiagnosticValue(details)
    };
    const line = `${JSON.stringify(entry)}\n`;
    const path = getDiagnosticLogPath(details);

    this.writeQueue = this.writeQueue
      .then(() => this.appendLine(path, line))
      .catch((error) => {
        console.error("Vault AI Assistant diagnostics could not be written.", error);
      });
  }

  private async appendLine(path: string, line: string): Promise<void> {
    await ensureFolder(this.vault, getParentPath(path));
    const file = this.vault.getFileByPath(path);
    if (file) {
      await this.vault.append(file, line);
      return;
    }

    await this.vault.create(path, line);
  }
}

export function createDiagnosticRequestId(): string {
  return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDiagnosticLogPath(
  details: Record<string, unknown> = {},
  date = new Date()
): string {
  const fileName = getDiagnosticLogFileName(details);
  return `${DIAGNOSTIC_LOG_FOLDER}/${formatDate(date)}/${fileName}`;
}

export function summarizeDiagnosticList<T>(
  values: T[],
  sampleSize = MAX_DETAIL_ARRAY_ITEMS
): DiagnosticListSummary<T> {
  const normalizedSampleSize = Math.max(0, sampleSize);
  return {
    total: values.length,
    sample: values.slice(0, normalizedSampleSize),
    omitted: Math.max(0, values.length - normalizedSampleSize)
  };
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DETAIL_DEPTH) {
    return "[truncated-depth]";
  }

  if (Array.isArray(value)) {
    const sample = value.slice(0, MAX_DETAIL_ARRAY_ITEMS).map((item) => sanitizeDiagnosticValue(item, depth + 1));
    if (value.length <= MAX_DETAIL_ARRAY_ITEMS) {
      return sample;
    }

    return {
      total: value.length,
      sample,
      omitted: value.length - MAX_DETAIL_ARRAY_ITEMS
    };
  }

  if (!value || typeof value !== "object") {
    return sanitizePrimitive(value);
  }

  const sanitized: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_DETAIL_OBJECT_KEYS);
  for (const [key, nestedValue] of entries) {
    if (isSensitiveKey(key)) {
      sanitized[key] = REDACTED;
      continue;
    }

    sanitized[key] = sanitizeDiagnosticValue(nestedValue, depth + 1);
  }
  const omittedKeyCount = Object.keys(value).length - entries.length;
  if (omittedKeyCount > 0) {
    sanitized.__omittedKeyCount = omittedKeyCount;
  }

  return sanitized;
}

function sanitizePrimitive(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const withoutSecrets = value
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`)
    .replace(/\bx-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi, `x-api-key ${REDACTED}`);

  if (withoutSecrets.length <= MAX_DETAIL_STRING_LENGTH) {
    return withoutSecrets;
  }

  return `${withoutSecrets.slice(0, MAX_DETAIL_STRING_LENGTH - 3)}...`;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return (
    normalized.includes("apikey") ||
    normalized === "arguments" ||
    normalized === "authorization" ||
    normalized === "body" ||
    normalized === "bearertoken" ||
    normalized === "content" ||
    normalized === "database64" ||
    normalized === "delta" ||
    normalized === "imageurl" ||
    normalized === "input" ||
    normalized === "instructions" ||
    normalized === "messages" ||
    normalized === "newcontent" ||
    normalized === "previouscontent" ||
    normalized === "prompt" ||
    normalized === "secret" ||
    normalized === "systemprompt" ||
    normalized === "text"
  );
}

function getDiagnosticLogFileName(details: Record<string, unknown>): string {
  const requestId = typeof details.requestId === "string" ? details.requestId.trim() : "";
  if (!requestId) {
    return "general.jsonl";
  }

  return `${sanitizePathSegment(requestId)}.jsonl`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "request";
}

function getParentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (vault.getFolderByPath(current)) {
      continue;
    }
    await vault.createFolder(current);
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
