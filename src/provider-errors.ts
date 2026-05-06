const MAX_ERROR_DETAIL_LENGTH = 280;

export type ProviderErrorKind =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "request_too_large"
  | "invalid_request"
  | "not_found"
  | "server"
  | "overloaded"
  | "network"
  | "stream"
  | "invalid_proposal"
  | "unknown";

export interface ProviderErrorRecovery {
  kind: ProviderErrorKind;
  message: string;
  detail?: string;
}

interface ProviderErrorDetail {
  detail: string;
  type?: string;
  code?: string;
}

export async function formatProviderHttpError(
  providerLabel: string,
  response: Response
): Promise<string> {
  const error = await readProviderErrorDetail(response);
  const recovery = classifyProviderError(providerLabel, response, error);

  const detail = recovery.detail ? `: ${recovery.detail}` : "";
  return `${recovery.message} (${response.status})${detail}`;
}

function classifyProviderError(
  providerLabel: string,
  response: Response,
  error: ProviderErrorDetail
): ProviderErrorRecovery {
  const status = response.status;
  const retryAfter = response.headers.get("retry-after");
  const typeOrCode = `${error.type ?? ""} ${error.code ?? ""}`.toLowerCase();
  const detail = error.detail ? sanitizeProviderErrorDetail(error.detail) : undefined;

  if (status === 401) {
    return {
      kind: "authentication",
      message: `${providerLabel} authentication failed. Check the API key in plugin settings.`,
      detail
    };
  }

  if (status === 403) {
    return {
      kind: "permission",
      message: `${providerLabel} permission denied. Check the key permissions and selected model.`,
      detail
    };
  }

  if (status === 404) {
    return {
      kind: "not_found",
      message: `${providerLabel} resource was not found. Check the selected model.`,
      detail
    };
  }

  if (status === 413 || typeOrCode.includes("request_too_large")) {
    return {
      kind: "request_too_large",
      message: `${providerLabel} request is too large. Remove attached context or shorten the message.`,
      detail
    };
  }

  if (status === 429 || typeOrCode.includes("rate_limit")) {
    const retry = retryAfter ? ` Retry after ${retryAfter}.` : "";
    return {
      kind: "rate_limit",
      message: `${providerLabel} rate limit reached. Wait and try again.${retry}`,
      detail
    };
  }

  if (status === 529 || typeOrCode.includes("overloaded_error")) {
    return {
      kind: "overloaded",
      message: `${providerLabel} is temporarily overloaded. Wait and try again.`,
      detail
    };
  }

  if (status >= 500 && status <= 599) {
    return {
      kind: "server",
      message: `${providerLabel} service error. Wait and try again.`,
      detail
    };
  }

  if (status === 400 || typeOrCode.includes("invalid_request")) {
    return {
      kind: "invalid_request",
      message: `${providerLabel} rejected the request. Check the selected model and request content.`,
      detail
    };
  }

  return {
    kind: "unknown",
    message: `${providerLabel} request failed.`,
    detail
  };
}

async function readProviderErrorDetail(response: Response): Promise<ProviderErrorDetail> {
  try {
    const raw = await response.text();
    if (!raw.trim()) {
      return { detail: "" };
    }

    const parsed = parseJson(raw);
    return parsed ? extractProviderError(parsed) ?? { detail: raw } : { detail: raw };
  } catch {
    return { detail: "" };
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractProviderError(parsed: unknown): ProviderErrorDetail | null {
  if (!isRecord(parsed)) {
    return null;
  }

  const error = parsed.error;
  if (typeof error === "string") {
    return { detail: error };
  }

  if (isRecord(error)) {
    const type = stringValue(error.type) ?? undefined;
    const code = stringValue(error.code) ?? undefined;
    const parts = [
      stringValue(error.message),
      labelValue("type", type),
      labelValue("code", code),
      labelValue("param", error.param)
    ].filter((part): part is string => Boolean(part));

    return parts.length > 0 ? { detail: parts.join(" "), type, code } : null;
  }

  const message = stringValue(parsed.message);
  return message ? { detail: message } : null;
}

function sanitizeProviderErrorDetail(detail: string): string {
  const sanitized = detail
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\bx-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi, "x-api-key [redacted]")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length <= MAX_ERROR_DETAIL_LENGTH) {
    return sanitized;
  }

  return `${sanitized.slice(0, MAX_ERROR_DETAIL_LENGTH - 3)}...`;
}

function labelValue(label: string, value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? `${label}=${value.trim()}`
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
