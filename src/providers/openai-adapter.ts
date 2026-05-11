import type { ChatAdapter, ChatEvent, ChatRequest, ChatUsage } from "../chat-types";
import { summarizeDiagnosticList } from "../diagnostics";
import {
  createVaultOperationToolSchema,
  formatInvalidOrchestratorOperationMessage,
  handleOrchestratorOperationPayload,
  INVALID_ORCHESTRATOR_OPERATION_MESSAGE,
  type VaultOperationProposal,
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

interface OpenAIStreamDiagnosticsSummary {
  totalEvents: number;
  eventCounts: Record<string, number>;
  outputTextDeltaCount: number;
  outputTextDeltaBytes: number;
  functionArgumentDeltaCount: number;
  functionArgumentDeltaBytes: number;
  functionArgumentSnapshotBytesMax: number;
  errorEventCount: number;
}

interface OpenAIInputMessage {
  role: "user" | "assistant";
  content: string | OpenAIContentPart[];
}

type OpenAIContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" };

const INCOMPLETE_OPENAI_OPERATION_MESSAGE =
  "OpenAI completed without returning an Orchestrator Operation proposal. No vault files were changed. Retry the request or ask for fewer or smaller file changes.";

export class OpenAIChatAdapter implements ChatAdapter {
  private fetchImpl: ChatFetch;

  constructor(fetchImpl: ChatFetch) {
    this.fetchImpl = fetchImpl;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    let operationTool: Record<string, unknown> | undefined;
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
      operationTool = toOpenAIFunctionTool(schema);
      body.tools = [operationTool];
      body.tool_choice = { type: "function", name: schema.name };
      body.parallel_tool_calls = false;
    }
    request.diagnostics?.log("openai.request", {
      requestId: request.diagnosticRequestId,
      model: request.model,
      enableVaultOperations: request.enableVaultOperations === true,
      maxOutputTokens: request.maxOutputTokens,
      messageCount: request.messages.length,
      contextFileCount: request.context.files.length,
      operationTargetCount: request.operationTargets.sources.length,
      imageAttachmentCount: request.imageAttachments?.length ?? 0,
      toolAttached: request.enableVaultOperations === true,
      toolChoice: request.enableVaultOperations ? "propose_vault_operations" : null
    });
    if (operationTool) {
      logOpenAIToolSchema(request, operationTool);
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
    request.diagnostics?.log("openai.response", {
      requestId: request.diagnosticRequestId,
      status: response.status,
      ok: response.ok,
      hasBody: Boolean(response.body)
    });

    if (!response.ok) {
      yield { type: "error", message: await formatProviderHttpError("OpenAI", response) };
      return;
    }

    if (!response.body) {
      request.diagnostics?.log("openai.stream_missing_body", {
        requestId: request.diagnosticRequestId
      });
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
  let sawTextOutput = false;
  let sawVaultOperationResult = false;
  const streamDiagnostics = createOpenAIStreamDiagnosticsSummary();

  const mapAndTrackEvent = async (event: OpenAIStreamEvent): Promise<ChatEvent | null> => {
    trackOpenAIStreamEvent(streamDiagnostics, event);
    if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta) {
      sawTextOutput = true;
    }
    if (
      event.type === "response.function_call_arguments.done" &&
      isVaultOperationFunctionCall(event, request)
    ) {
      sawVaultOperationResult = true;
    }

    const mapped = await mapOpenAIEvent(event, request, fetchImpl, signal);
    if (
      mapped?.type === "done" &&
      request.enableVaultOperations &&
      !sawTextOutput &&
      !sawVaultOperationResult
    ) {
      request.diagnostics?.log("openai.operation_missing", {
        requestId: request.diagnosticRequestId,
        sawTextOutput,
        sawVaultOperationResult
      });
      return { type: "error", message: INCOMPLETE_OPENAI_OPERATION_MESSAGE };
    }

    return mapped;
  };

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

        const mapped = await mapAndTrackEvent(event);
        if (mapped) {
          yield mapped;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseSsePart(buffer);
    const mapped = event ? await mapAndTrackEvent(event) : null;
    if (mapped) {
      yield mapped;
    }
  } finally {
    request.diagnostics?.log("openai.stream_summary", {
      requestId: request.diagnosticRequestId,
      ...streamDiagnostics
    });
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
    if (!isVaultOperationFunctionCall(event, request)) {
      return null;
    }

    return mapVaultOperationArguments(
      getOpenAIFunctionArguments(event),
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
  request.diagnostics?.log("openai.function_arguments_done", {
    requestId: request.diagnosticRequestId,
    argumentsLength: argumentsJson?.length ?? 0,
    repairAttempted
  });
  if (!argumentsJson) {
    request.diagnostics?.log("openai.function_arguments_missing", {
      requestId: request.diagnosticRequestId,
      repairAttempted
    });
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
      request.diagnostics?.log("openai.proposal_validated", {
        requestId: request.diagnosticRequestId,
        repairAttempted,
        ...summarizeProposal(result.proposal)
      });
      return { type: "proposal", proposal: result.proposal };
    }

    request.diagnostics?.log("openai.proposal_invalid", {
      requestId: request.diagnosticRequestId,
      repairAttempted,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 3)
    });
    if (!repairAttempted) {
      const repaired = await repairOpenAIOrchestratorOperation(request, fetchImpl, signal, result.repairPrompt);
      const repairedResult = handleOrchestratorOperationPayload(repaired, {
        readableContextPaths: request.context.files.map((file) => file.path),
        contextFiles: request.context.files,
        operationTargets: request.operationTargets
      });
      if (repairedResult.ok) {
        request.diagnostics?.log("openai.proposal_repaired", {
          requestId: request.diagnosticRequestId,
          ...summarizeProposal(repairedResult.proposal)
        });
        return { type: "proposal", proposal: repairedResult.proposal };
      }
      request.diagnostics?.log("openai.proposal_repair_failed", {
        requestId: request.diagnosticRequestId,
        errorCount: repairedResult.errors.length,
        errors: repairedResult.errors.slice(0, 3)
      });
    }

    request.diagnostics?.log("openai.proposal_failed", {
      requestId: request.diagnosticRequestId,
      errorCount: result.errors.length,
      errors: result.errors.slice(0, 3)
    });
    return { type: "error", message: formatInvalidOrchestratorOperationMessage(result.errors) };
  } catch {
    request.diagnostics?.log("openai.function_arguments_parse_failed", {
      requestId: request.diagnosticRequestId,
      argumentsLength: argumentsJson.length,
      repairAttempted
    });
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

function logOpenAIToolSchema(request: ChatRequest, tool: Record<string, unknown>): void {
  const parameters = isRecord(tool.parameters) ? tool.parameters : {};
  const properties = isRecord(parameters.properties) ? parameters.properties : {};
  const operations = isRecord(properties.operations) ? properties.operations : {};
  const operationItems = isRecord(operations.items) ? operations.items : {};
  const operationProperties = isRecord(operationItems.properties) ? operationItems.properties : {};
  const operationRequired = getStringArray(operationItems.required);

  request.diagnostics?.log("openai.tool_schema", {
    requestId: request.diagnosticRequestId,
    strict: tool.strict === true,
    topRequired: getStringArray(parameters.required),
    operationPropertyCount: Object.keys(operationProperties).length,
    operationRequiredCount: operationRequired.length,
    operationRequiredIncludesId: operationRequired.includes("id")
  });
}

function createOpenAIStreamDiagnosticsSummary(): OpenAIStreamDiagnosticsSummary {
  return {
    totalEvents: 0,
    eventCounts: {},
    outputTextDeltaCount: 0,
    outputTextDeltaBytes: 0,
    functionArgumentDeltaCount: 0,
    functionArgumentDeltaBytes: 0,
    functionArgumentSnapshotBytesMax: 0,
    errorEventCount: 0
  };
}

function trackOpenAIStreamEvent(
  summary: OpenAIStreamDiagnosticsSummary,
  event: OpenAIStreamEvent
): void {
  const type = event.type ?? "unknown";
  summary.totalEvents += 1;
  summary.eventCounts[type] = (summary.eventCounts[type] ?? 0) + 1;

  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    summary.outputTextDeltaCount += 1;
    summary.outputTextDeltaBytes += event.delta.length;
  }
  if (type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
    summary.functionArgumentDeltaCount += 1;
    summary.functionArgumentDeltaBytes += event.delta.length;
  }
  const argumentsText = getOpenAIFunctionArguments(event);
  if (typeof argumentsText === "string") {
    summary.functionArgumentSnapshotBytesMax = Math.max(
      summary.functionArgumentSnapshotBytesMax,
      argumentsText.length
    );
  }
  if (type === "error") {
    summary.errorEventCount += 1;
  }
}

function isVaultOperationFunctionCall(event: OpenAIStreamEvent, request: ChatRequest): boolean {
  const name = getOpenAIFunctionName(event);
  if (name === "propose_vault_operations") {
    return true;
  }

  // The Responses stream can omit the name on function_call_arguments.done.
  // We force tool_choice and disable parallel tool calls for vault operations,
  // so an unnamed completed argument payload belongs to the requested tool.
  return (
    request.enableVaultOperations === true &&
    !name &&
    typeof getOpenAIFunctionArguments(event) === "string"
  );
}

function getOpenAIFunctionName(event: OpenAIStreamEvent): string | undefined {
  return event.name ?? event.item?.name;
}

function getOpenAIFunctionArguments(event: OpenAIStreamEvent): string | undefined {
  return event.arguments ?? event.item?.arguments;
}

function summarizeProposal(proposal: VaultOperationProposal): Record<string, unknown> {
  return {
    operationCount: proposal.operations.length,
    operationTypeCounts: countOperationTypes(proposal.operations),
    operationPaths: summarizeDiagnosticList(proposal.operations.map((operation) => operation.path))
  };
}

function countOperationTypes(operations: VaultOperationProposal["operations"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const operation of operations) {
    counts[operation.type] = (counts[operation.type] ?? 0) + 1;
  }
  return counts;
}

function toOpenAIFunctionTool(schema: VaultOperationToolSchema): Record<string, unknown> {
  return {
    type: "function",
    name: schema.name,
    description: schema.description,
    parameters: toOpenAIStrictSchema(schema.input_schema),
    strict: true
  };
}

function toOpenAIStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toOpenAIStrictSchema(item));
  }

  if (!isRecord(schema)) {
    return schema;
  }

  const output: Record<string, unknown> = {};
  const requiredKeys = new Set(getStringArray(schema.required));

  for (const [key, value] of Object.entries(schema)) {
    if (key === "required" || key === "properties" || key === "items") {
      continue;
    }
    if (key === "minItems") {
      continue;
    }
    output[key] = toOpenAIStrictSchema(value);
  }

  if (isRecord(schema.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      const propertySchema = toOpenAIStrictSchema(value);
      properties[key] = requiredKeys.has(key) ? propertySchema : makeNullableSchema(propertySchema);
    }
    output.properties = properties;
    output.required = Object.keys(properties);
    output.additionalProperties = false;
  }

  if (schema.items !== undefined) {
    output.items = toOpenAIStrictSchema(schema.items);
  }

  return output;
}

function makeNullableSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return schema;
  }

  const output: Record<string, unknown> = { ...schema };
  if (typeof output.type === "string") {
    output.type = output.type === "null" ? output.type : [output.type, "null"];
  } else if (Array.isArray(output.type)) {
    output.type = output.type.includes("null") ? output.type : [...output.type, "null"];
  }

  if (Array.isArray(output.enum) && !output.enum.includes(null)) {
    output.enum = [...output.enum, null];
  }

  return output;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
