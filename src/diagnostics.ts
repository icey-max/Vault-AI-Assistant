import type { Vault } from "obsidian";

export interface DiagnosticLogger {
  log(event: string, details?: Record<string, unknown>): void;
}

export const DIAGNOSTIC_LOG_FOLDER = "vault-ai-assistant/diagnostics";

const REDACTED = "[redacted]";
const MAX_DETAIL_STRING_LENGTH = 320;

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

    this.writeQueue = this.writeQueue
      .then(() => this.appendLine(line))
      .catch((error) => {
        console.error("Vault AI Assistant diagnostics could not be written.", error);
      });
  }

  private async appendLine(line: string): Promise<void> {
    await ensureFolder(this.vault, DIAGNOSTIC_LOG_FOLDER);
    const path = `${DIAGNOSTIC_LOG_FOLDER}/provider-events-${formatDate(new Date())}.jsonl`;
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

export function sanitizeDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnosticValue);
  }

  if (!value || typeof value !== "object") {
    return sanitizePrimitive(value);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = REDACTED;
      continue;
    }

    sanitized[key] = sanitizeDiagnosticValue(nestedValue);
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
    normalized === "authorization" ||
    normalized === "bearertoken" ||
    normalized === "content" ||
    normalized === "database64" ||
    normalized === "imageurl" ||
    normalized === "instructions" ||
    normalized === "newcontent" ||
    normalized === "previouscontent" ||
    normalized === "prompt" ||
    normalized === "secret" ||
    normalized === "systemprompt" ||
    normalized === "text"
  );
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
