import { requestUrl } from "obsidian";
import type { ChatFetch } from "./providers/openai-adapter";

export const obsidianRequestFetch: ChatFetch = async (input, init) => {
  const signal = init.signal;
  if (signal?.aborted) {
    throw createAbortError();
  }

  const response = await requestUrl({
    url: input,
    method: init.method,
    headers: normalizeHeaders(init.headers),
    contentType: getContentType(init.headers),
    body: normalizeBody(init.body),
    throw: false
  });

  if (signal?.aborted) {
    throw createAbortError();
  }

  return new Response(response.text, {
    status: response.status,
    headers: response.headers
  });
};

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const normalized: Record<string, string> = {};
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
    return normalized;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function getContentType(headers: HeadersInit | undefined): string | undefined {
  const normalized = normalizeHeaders(headers);
  return normalized["Content-Type"] ?? normalized["content-type"];
}

function normalizeBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return body;
  }

  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  throw new Error("Unsupported provider request body.");
}

function createAbortError(): Error {
  return new DOMException("The provider request was aborted.", "AbortError");
}
