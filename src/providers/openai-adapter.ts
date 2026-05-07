import type { ChatAdapter, ChatEvent, ChatRequest, ChatUsage } from "../chat-types";
import {
  createVaultOperationToolSchema,
  formatInvalidOrchestratorOperationMessage,
  handleOrchestratorOperationPayload,
  INVALID_ORCHESTRATOR_OPERATION_MESSAGE,
  type VaultOperationToolSchema
} from "../orchestrator-operations";
import { formatProviderHttpError } from "../provider-errors";
import { buildProviderSystemPrompt } from "./runtime-prompt";
import { serializeAssistantMessageForProviderHistory } from "./message-history";

export type ChatFetch = (input: string, init: RequestInit) => Promise<Response>;

interface OpenAIStreamEvent {
  type?: string;
  response?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  delta?: string;
  name?: string;
  arguments?: string;
  item?: {
    type?: string;
    name?: string;
    arguments?: string;
  };
  error?: {
    message?: string;
  };
}

type OpenAIUsage = NonNullable<OpenAIStreamEvent["response"]>["usage"];

interface OpenAIInputMessage {
  role: "user" | "assistant";
  content: string | OpenAIContentPart[];
}

type OpenAIContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" };

export class OpenAIChatAdapter implements ChatAdapter {
  private fetchImpl: ChatFetch;

  constructor(fetchImpl: ChatFetch) {
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      instructions: buildProviderSystemPrompt(request),
      input: buildOpenAIInput(request),
      stream: true,
      store: false
    };
    if (typeof request.maxOutputTokens === "number") {
      body.max_output_tokens = request.maxOutputTokens;
    }
    if (request.enableVaultOperations) {
      const schema = createVaultOperationToolSchema();
      body.tools = [toOpenAIFunctionTool(schema)];
      body.tool_choice = { type: "function", name: schema.name };
      body.parallel_tool_calls = false;
    }

    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      yield { type: "error", message: await formatProviderHttpError("OpenAI", response) };
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "OpenAI response stream could not be read." };
      return;
    }

    for await (const event of parseOpenAIStream(response.body, request, this.fetchImpl, signal)) {
      yield event;
    }
  }
}

function buildOpenAIInput(request: ChatRequest): OpenAIInputMessage[] {
  const messages = request.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message): OpenAIInputMessage => ({
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

function buildFinalUserContent(request: ChatRequest): string | OpenAIContentPart[] {
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
    ...imageAttachments.map((attachment): OpenAIContentPart => ({
      type: "input_image",
      image_url: `data:${attachment.mediaType};base64,${attachment.dataBase64}`,
      detail: "auto"
    })),
    { type: "input_text", text }
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

async function* parseOpenAIStream(
  stream: ReadableStream<Uint8Array>,
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal
): AsyncIterable<ChatEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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

        const mapped = await mapOpenAIEvent(event, request, fetchImpl, signal);
        if (mapped) {
          yield mapped;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseSsePart(buffer);
    const mapped = event ? await mapOpenAIEvent(event, request, fetchImpl, signal) : null;
    if (mapped) {
      yield mapped;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSsePart(part: string): OpenAIStreamEvent | null {
  const dataLines = part
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as OpenAIStreamEvent;
  } catch {
    return { type: "error", error: { message: "OpenAI response stream could not be read." } };
  }
}

async function mapOpenAIEvent(
  event: OpenAIStreamEvent,
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal
): Promise<ChatEvent | null> {
  if (event.type === "response.created") {
    return {
      type: "start",
      provider: "openai",
      model: request.model,
      messageId: event.response?.id ?? createEventId()
    };
  }

  if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
    return { type: "delta", text: event.delta };
  }

  if (event.type === "response.function_call_arguments.done") {
    const name = event.name ?? event.item?.name;
    if (name !== "propose_vault_operations") {
      return null;
    }

    return mapVaultOperationArguments(
      event.arguments ?? event.item?.arguments,
      request,
      fetchImpl,
      signal,
      false
    );
  }

  if (event.type === "response.completed") {
    return { type: "done", usage: mapUsage(event.response?.usage) };
  }

  if (event.type === "error") {
    return { type: "error", message: event.error?.message ?? "OpenAI response stream could not be read." };
  }

  return null;
}

async function mapVaultOperationArguments(
  argumentsJson: string | undefined,
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal,
  repairAttempted: boolean
): Promise<ChatEvent> {
  if (!argumentsJson) {
    return { type: "error", message: INVALID_ORCHESTRATOR_OPERATION_MESSAGE };
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    const result = handleOrchestratorOperationPayload(parsed, {
      readableContextPaths: request.context.files.map((file) => file.path),
      contextFiles: request.context.files,
      operationTargets: request.operationTargets
    });
    if (result.ok) {
      return { type: "proposal", proposal: result.proposal };
    }

    if (!repairAttempted) {
      const repaired = await repairOpenAIOrchestratorOperation(request, fetchImpl, signal, result.repairPrompt);
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

async function repairOpenAIOrchestratorOperation(
  request: ChatRequest,
  fetchImpl: ChatFetch,
  signal: AbortSignal,
  repairPrompt: string
): Promise<unknown> {
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: request.model,
      instructions: request.systemPrompt,
      input: [{ role: "user", content: repairPrompt }],
      max_output_tokens: request.maxOutputTokens,
      stream: false,
      store: false
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

  if (isRecord(body) && typeof body.output_text === "string") {
    return parseJsonPayload(body.output_text);
  }

  if (isRecord(body) && Array.isArray(body.output)) {
    for (const output of body.output) {
      if (!isRecord(output) || !Array.isArray(output.content)) {
        continue;
      }
      for (const content of output.content) {
        if (isRecord(content) && typeof content.text === "string") {
          const parsed = parseJsonPayload(content.text);
          if (parsed !== undefined) {
            return parsed;
          }
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

function toOpenAIFunctionTool(schema: VaultOperationToolSchema): Record<string, unknown> {
  return {
    type: "function",
    name: schema.name,
    description: schema.description,
    parameters: schema.input_schema,
    strict: true
  };
}

function mapUsage(usage: OpenAIUsage | undefined): ChatUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens
  };
}

function createEventId(): string {
  return `openai-${Date.now().toString(36)}`;
}
