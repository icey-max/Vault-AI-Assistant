import type { ChatAdapter, ChatEvent, ChatRequest, ChatUsage } from "../chat-types";
import {
  createVaultOperationToolSchema,
  formatInvalidOrchestratorOperationMessage,
  handleOrchestratorOperationPayload,
  INVALID_ORCHESTRATOR_OPERATION_MESSAGE,
  type VaultOperationToolSchema
} from "../orchestrator-operations";
import { formatProviderHttpError } from "../provider-errors";
import { defaultChatFetch, type ChatFetch } from "./openai-adapter";
import { serializeAssistantMessageForProviderHistory } from "./message-history";
import { buildProviderSystemPrompt } from "./runtime-prompt";

interface AnthropicStreamEvent {
  type?: string;
  message?: {
    id?: string;
    usage?: AnthropicUsage;
  };
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
    input?: unknown;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
    usage?: AnthropicUsage;
  };
  usage?: AnthropicUsage;
  error?: {
    message?: string;
  };
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

interface AnthropicToolBuffer {
  name: string;
  input?: unknown;
  partialJson: string;
}

const ANTHROPIC_DEFAULT_MAX_TOKENS = 1000;
const ANTHROPIC_OPERATION_MAX_TOKENS = 8000;
const INCOMPLETE_ANTHROPIC_OPERATION_MESSAGE =
  "Anthropic stopped before finishing the Orchestrator Operation proposal. No vault files were changed. Retry the request or ask for fewer or smaller file changes.";

export class AnthropicChatAdapter implements ChatAdapter {
  private fetchImpl: ChatFetch;

  constructor(fetchImpl: ChatFetch = defaultChatFetch) {
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens:
        request.maxOutputTokens ??
        (request.enableVaultOperations
          ? ANTHROPIC_OPERATION_MAX_TOKENS
          : ANTHROPIC_DEFAULT_MAX_TOKENS),
      stream: true,
      system: buildProviderSystemPrompt(request),
      messages: buildAnthropicMessages(request)
    };
    if (request.enableVaultOperations) {
      const schema = createVaultOperationToolSchema();
      body.tools = [toAnthropicTool(schema)];
      body.tool_choice = {
        type: "tool",
        name: schema.name,
        disable_parallel_tool_use: true
      };
    }

    const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      yield { type: "error", message: await formatProviderHttpError("Anthropic", response) };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "Anthropic response stream could not be read." };
      return;
    }

    for await (const event of parseAnthropicStream(response.body, request, this.fetchImpl, signal)) {
      yield event;
    }
  }
}

function buildAnthropicMessages(request: ChatRequest): AnthropicMessage[] {
  const messages = request.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message): AnthropicMessage => ({
      role: message.role,
      content:
        message.role === "assistant"
          ? serializeAssistantMessageForProviderHistory(message)
          : message.content
    }));

  messages.push({
    role: "user",
    content: buildFinalUserContent(request)
  });

  return messages;
}

function buildFinalUserContent(request: ChatRequest): string | AnthropicContentBlock[] {
  const text = [serializeContext(request), serializeOperationTargets(request), request.userMessage]
    .filter(Boolean)
    .join("\n\n");
  const imageAttachments = request.imageAttachments?.filter(
    (attachment) => attachment.status === "persisted"
  );

  if (!imageAttachments || imageAttachments.length === 0) {
    return text;
  }

  return [
    ...imageAttachments.map((attachment): AnthropicContentBlock => ({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType,
        data: attachment.dataBase64
      }
    })),
    { type: "text", text }
  ];
}

function serializeOperationTargets(request: ChatRequest): string {
  const targets = request.operationTargets.sources;
  if (targets.length === 0) {
    return "Available edit target hints:\n- Edit target folder: / (default create target; contents not included)";
  }

  return [
    "Available edit target hints:",
    ...targets.map((target) =>
      target.type === "folder"
        ? `- Edit target folder: ${target.path} (contents not included)`
        : `- Edit target file: ${target.path} (contents not included unless also sent as context)`
    )
  ].join("\n");
}

function serializeContext(request: ChatRequest): string {
  if (request.context.files.length === 0) {
    return "Attached markdown context: none.";
  }

  const files = request.context.files.map((file) => {
    return [`<file path="${file.path}">`, file.content, "</file>"].join("\n");
  });

  return ["Attached markdown context:", ...files].join("\n\n");
}

async function* parseAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal
): AsyncIterable<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  let failed = false;
  const toolBuffers = new Map<number, AnthropicToolBuffer>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const event = parseSsePart(part);
        if (!event) {
          continue;
        }

        const mapped = await mapAnthropicEvent(event, request, toolBuffers, fetchImpl, signal);
        if (mapped) {
          if (failed) {
            continue;
          }
          if (mapped.type === "error") {
            failed = true;
          }
          if (mapped.type === "done") {
            if (completed) {
              continue;
            }
            completed = true;
          }
          yield mapped;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseSsePart(buffer);
    const mapped = event ? await mapAnthropicEvent(event, request, toolBuffers, fetchImpl, signal) : null;
    if (mapped) {
      if (failed) {
        return;
      }
      if (mapped.type === "error") {
        failed = true;
      }
      if (mapped.type === "done" && completed) {
        return;
      }
      yield mapped;
    }

    if (!failed && toolBuffers.size > 0) {
      toolBuffers.clear();
      yield { type: "error", message: INCOMPLETE_ANTHROPIC_OPERATION_MESSAGE };
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSsePart(part: string): AnthropicStreamEvent | null {
  const dataLines = part
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join("\n")) as AnthropicStreamEvent;
  } catch {
    return { type: "error", error: { message: "Anthropic response stream could not be read." } };
  }
}

function mapAnthropicEvent(
  event: AnthropicStreamEvent,
  request: ChatRequest,
  toolBuffers: Map<number, AnthropicToolBuffer>,
  fetchImpl: ChatFetch,
  signal: AbortSignal
): Promise<ChatEvent | null> | ChatEvent | null {
  if (event.type === "message_start") {
    return {
      type: "start",
      provider: "anthropic",
      model: request.model,
      messageId: event.message?.id ?? createEventId()
    };
  }

  if (
    event.type === "content_block_start" &&
    event.content_block?.type === "tool_use" &&
    event.content_block.name === "propose_vault_operations"
  ) {
    toolBuffers.set(event.index ?? 0, {
      name: event.content_block.name,
      input: event.content_block.input,
      partialJson: ""
    });
    return null;
  }

  if (
    event.type === "content_block_delta" &&
    event.delta?.type === "text_delta" &&
    typeof event.delta.text === "string"
  ) {
    return { type: "delta", text: event.delta.text };
  }

  if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
    const toolBuffer = toolBuffers.get(event.index ?? 0);
    if (toolBuffer && typeof event.delta.partial_json === "string") {
      toolBuffer.partialJson += event.delta.partial_json;
    }
    return null;
  }

  if (event.type === "content_block_stop") {
    const index = event.index ?? 0;
    const toolBuffer = toolBuffers.get(index);
    if (!toolBuffer || toolBuffer.name !== "propose_vault_operations") {
      return null;
    }

    toolBuffers.delete(index);
    return mapVaultOperationToolInput(toolBuffer, request, fetchImpl, signal, false);
  }

  if (event.type === "message_delta") {
    if (event.delta?.stop_reason === "max_tokens" && (request.enableVaultOperations || toolBuffers.size > 0)) {
      toolBuffers.clear();
      return { type: "error", message: INCOMPLETE_ANTHROPIC_OPERATION_MESSAGE };
    }

    return { type: "done", usage: mapUsage(event.usage ?? event.delta?.usage) };
  }

  if (event.type === "message_stop") {
    return { type: "done" };
  }

  if (event.type === "error") {
    return { type: "error", message: event.error?.message ?? "Anthropic response stream could not be read." };
  }

  return null;
}

async function mapVaultOperationToolInput(
  toolBuffer: AnthropicToolBuffer,
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal,
  repairAttempted: boolean
): Promise<ChatEvent> {
  try {
    const input = toolBuffer.partialJson.trim()
      ? (JSON.parse(toolBuffer.partialJson) as unknown)
      : toolBuffer.input;
    const result = handleOrchestratorOperationPayload(input, {
      readableContextPaths: request.context.files.map((file) => file.path),
      contextFiles: request.context.files,
      operationTargets: request.operationTargets
    });
    if (result.ok) {
      return { type: "proposal", proposal: result.proposal };
    }

    if (!repairAttempted) {
      const repaired = await repairAnthropicOrchestratorOperation(request, fetchImpl, signal, result.repairPrompt);
      const repairedResult = handleOrchestratorOperationPayload(repaired, {
        readableContextPaths: request.context.files.map((file) => file.path),
        contextFiles: request.context.files,
        operationTargets: request.operationTargets
      });
      if (repairedResult.ok) {
        return { type: "proposal", proposal: repairedResult.proposal };
      }
    }

    return { type: "error", message: formatInvalidOrchestratorOperationMessage(result.errors) };
  } catch {
    return { type: "error", message: INVALID_ORCHESTRATOR_OPERATION_MESSAGE };
  }
}

async function repairAnthropicOrchestratorOperation(
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal,
  repairPrompt: string
): Promise<unknown> {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 600,
      stream: false,
      system: request.systemPrompt,
      messages: [{ role: "user", content: repairPrompt }]
    }),
    signal
  });

  if (!response.ok) {
    return undefined;
  }

  try {
    return extractRepairPayload(await response.json());
  } catch {
    return undefined;
  }
}

function extractRepairPayload(body: unknown): unknown {
  if (hasProposalShape(body)) {
    return body;
  }

  if (isRecord(body) && Array.isArray(body.content)) {
    for (const content of body.content) {
      if (isRecord(content) && content.type === "tool_use" && content.name === "propose_vault_operations") {
        return content.input;
      }
      if (isRecord(content) && typeof content.text === "string") {
        const parsed = parseJsonPayload(content.text);
        if (parsed !== undefined) {
          return parsed;
        }
      }
    }
  }

  return undefined;
}

function parseJsonPayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function hasProposalShape(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.operations);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAnthropicTool(schema: VaultOperationToolSchema): Record<string, unknown> {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: schema.input_schema
  };
}

function mapUsage(usage: AnthropicUsage | undefined): ChatUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens:
      typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number"
        ? usage.input_tokens + usage.output_tokens
        : undefined
  };
}

function createEventId(): string {
  return `anthropic-${Date.now().toString(36)}`;
}
