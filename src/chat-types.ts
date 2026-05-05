import type {
  ContextAttachmentMode,
  ContextPackage,
  OperationTargetScope,
  OperationTargetSnapshot,
  OperationTargetType
} from "./context-utils";
import type { ProviderId } from "./settings";
import type { VaultOperationProposal } from "./vault-operations";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "pending" | "streaming" | "completed" | "stopped" | "error";

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ContextSnapshotFile {
  path: string;
  sourceIds: string[];
  charCount: number;
  estimatedTokens: number;
}

export interface ContextSnapshot {
  files: ContextSnapshotFile[];
  fileCount: number;
  totalCharacters: number;
  totalEstimatedTokens: number;
  sourceIds: string[];
}

export type ChatImageAttachmentStatus = "draft" | "persisted" | "missing";

export interface ChatMarkdownAttachment {
  kind: "markdown";
  id: string;
  sourceType: "current-note" | "note" | "folder";
  path: string;
  label: string;
  mode?: ContextAttachmentMode;
  targetType?: OperationTargetType;
  automatic?: boolean;
}

export interface ChatImageAttachment {
  kind: "image";
  id: string;
  label: string;
  mediaType: string;
  originalPath?: string;
  persistedPath?: string;
  status: ChatImageAttachmentStatus;
  size?: number;
  createdAt?: string;
}

export type ChatAttachment = ChatMarkdownAttachment | ChatImageAttachment;

export interface ChatRequestImageAttachment extends Omit<ChatImageAttachment, "status"> {
  status: "persisted";
  dataBase64: string;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  status?: ChatMessageStatus;
  provider?: ProviderId;
  model?: string;
  usage?: ChatUsage;
  contextSnapshot?: ContextSnapshot;
  operationTargetSnapshot?: OperationTargetSnapshot;
  attachments?: ChatAttachment[];
  proposals?: VaultOperationProposal[];
  error?: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  userMessage: string;
  context: ContextPackage;
  contextSnapshot: ContextSnapshot;
  operationTargets: OperationTargetScope;
  operationTargetSnapshot: OperationTargetSnapshot;
  systemPrompt: string;
  enableVaultOperations?: boolean;
  maxOutputTokens?: number;
  imageAttachments?: ChatRequestImageAttachment[];
}

export type ChatEvent =
  | { type: "start"; provider: ProviderId; model: string; messageId: string }
  | { type: "delta"; text: string }
  | { type: "proposal"; proposal: VaultOperationProposal }
  | { type: "done"; usage?: ChatUsage }
  | { type: "error"; message: string };

export interface ChatAdapter {
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
