import type { Vault } from "obsidian";
import type { ChatAttachment, ChatMessage, ChatUsage, ContextSnapshot } from "./chat-types";
import type { OperationTargetSnapshot } from "./context-utils";
import type { ProviderId } from "./settings";
import { formatTokenUsageForMarkdown } from "./token-usage";
import type {
  VaultOperation,
  VaultOperationProposal,
  VaultOperationStatus
} from "./vault-operations";

export type ConversationSaveStatus = "idle" | "saving" | "saved" | "error";

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  filePath?: string;
  saveStatus: ConversationSaveStatus;
  saveError?: string;
}

export interface ChatStoreState {
  activeConversation: ChatConversation;
}

export interface SavedConversationSummary {
  filePath: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedConversationMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const DEFAULT_CONVERSATION_FOLDER = "vault-ai-assistant/conversations";
const CONVERSATION_METADATA_START = "<!-- vault-ai-assistant:conversation -->";
const CONVERSATION_METADATA_END = "<!-- /vault-ai-assistant:conversation -->";

export class ChatStore {
  private vault: Vault;
  private onChange: () => void;
  private activeConversation: ChatConversation;

  constructor(vault: Vault, onChange: () => void) {
    this.vault = vault;
    this.onChange = onChange;
    this.activeConversation = createConversation();
  }

  getState(): ChatStoreState {
    return {
      activeConversation: cloneConversation(this.activeConversation)
    };
  }

  appendUserMessage(content: string, attachments: ChatAttachment[] = []): ChatMessage {
    const message: ChatMessage = {
      id: createId("user"),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      status: "completed",
      attachments: cloneAttachments(attachments)
    };

    this.activeConversation = {
      ...this.activeConversation,
      updatedAt: message.createdAt,
      messages: this.activeConversation.messages.concat(message)
    };
    this.emitChange();
    return { ...message };
  }

  startAssistantMessage(
    provider: ProviderId,
    model: string,
    contextSnapshot: ContextSnapshot,
    operationTargetSnapshot?: OperationTargetSnapshot
  ): ChatMessage {
    const message: ChatMessage = {
      id: createId("assistant"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
      provider,
      model,
      contextSnapshot: cloneContextSnapshot(contextSnapshot),
      operationTargetSnapshot: operationTargetSnapshot
        ? cloneOperationTargetSnapshot(operationTargetSnapshot)
        : undefined
    };

    this.activeConversation = {
      ...this.activeConversation,
      updatedAt: message.createdAt,
      messages: this.activeConversation.messages.concat(message)
    };
    this.emitChange();
    return cloneMessage(message);
  }

  appendAssistantDelta(messageId: string, text: string): void {
    this.updateMessage(messageId, (message) => ({
      ...message,
      content: `${message.content}${text}`,
      status: "streaming"
    }));
  }

  appendAssistantProposal(messageId: string, proposal: VaultOperationProposal): void {
    this.updateMessage(messageId, (message) => ({
      ...message,
      proposals: (message.proposals ?? []).concat(cloneProposal(proposal))
    }));
  }

  replaceAssistantContent(messageId: string, content: string): void {
    this.updateMessage(messageId, (message) => ({
      ...message,
      content
    }));
  }

  async updateOperationStatus(
    messageId: string,
    proposalId: string,
    operationId: string,
    status: VaultOperationStatus,
    error?: string
  ): Promise<void> {
    const appliedAt = status === "applied" ? new Date().toISOString() : undefined;
    this.updateMessage(messageId, (message) => ({
      ...message,
      proposals: (message.proposals ?? []).map((proposal) =>
        proposal.id === proposalId
          ? {
              ...proposal,
              operations: proposal.operations.map((operation) =>
                operation.id === operationId
                  ? {
                      ...operation,
                      status,
                      appliedAt: appliedAt ?? operation.appliedAt,
                      error: error ?? (status === "failed" ? operation.error : undefined)
                    }
                  : operation
              )
            }
          : proposal
      )
    }));

    if (isTerminalOperationStatus(status)) {
      await this.autosave();
    }
  }

  async rejectOperation(
    messageId: string,
    proposalId: string,
    operationId: string
  ): Promise<void> {
    const operation = this.findOperation(messageId, proposalId, operationId);
    if (!operation || operation.status !== "pending") {
      return;
    }

    await this.updateOperationStatus(messageId, proposalId, operationId, "rejected");
  }

  async rejectProposal(messageId: string, proposalId: string): Promise<void> {
    const proposal = this.activeConversation.messages
      .find((message) => message.id === messageId)
      ?.proposals?.find((candidate) => candidate.id === proposalId);
    if (!proposal) {
      return;
    }

    this.updateMessage(messageId, (message) => ({
      ...message,
      proposals: (message.proposals ?? []).map((candidate) =>
        candidate.id === proposalId
          ? {
              ...candidate,
              operations: candidate.operations.map((operation) =>
                operation.status === "pending"
                  ? { ...operation, status: "rejected" as const, error: undefined }
                  : operation
              )
            }
          : candidate
      )
    }));
    await this.autosave();
  }

  private findOperation(
    messageId: string,
    proposalId: string,
    operationId: string
  ): VaultOperation | undefined {
    return this.activeConversation.messages
      .find((message) => message.id === messageId)
      ?.proposals?.find((proposal) => proposal.id === proposalId)
      ?.operations.find((operation) => operation.id === operationId);
  }

  async completeAssistantMessage(messageId: string, usage?: ChatUsage): Promise<void> {
    this.updateMessage(messageId, (message) => ({
      ...message,
      status: message.status === "error" ? "error" : "completed",
      usage: usage ? { ...usage } : message.usage
    }));
    await this.autosave();
  }

  async stopAssistantMessage(messageId: string): Promise<void> {
    this.updateMessage(messageId, (message) => ({
      ...message,
      status: "stopped"
    }));
    await this.autosave();
  }

  async failAssistantMessage(messageId: string, error: string): Promise<void> {
    this.updateMessage(messageId, (message) => ({
      ...message,
      status: "error",
      error
    }));
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || this.activeConversation.id !== conversationId) {
      return false;
    }

    this.activeConversation = {
      ...this.activeConversation,
      title: normalizedTitle,
      updatedAt: new Date().toISOString()
    };
    this.emitChange();

    if (this.activeConversation.filePath && this.activeConversation.messages.length > 0) {
      await this.autosave();
    }

    return true;
  }

  async newChat(): Promise<void> {
    if (this.activeConversation.messages.length > 0) {
      await this.autosave();
    }

    this.activeConversation = createConversation();
    this.emitChange();
  }

  async listSavedConversations(): Promise<SavedConversationSummary[]> {
    const files = this.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${DEFAULT_CONVERSATION_FOLDER}/`));
    const summaries: SavedConversationSummary[] = [];

    for (const file of files) {
      const markdown = await this.vault.cachedRead(file);
      const conversation = parseConversationFromMarkdown(markdown, file.path);
      if (!conversation) {
        continue;
      }

      summaries.push({
        filePath: file.path,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      });
    }

    return summaries.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  }

  async pruneSavedConversations(retentionDays: number, now: Date = new Date()): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return 0;
    }

    const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    const files = this.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${DEFAULT_CONVERSATION_FOLDER}/`));

    for (const file of files) {
      if (file.path === this.activeConversation.filePath) {
        continue;
      }

      const markdown = await this.vault.cachedRead(file);
      const conversation = parseConversationFromMarkdown(markdown, file.path);
      if (!conversation) {
        continue;
      }

      const updatedAt = new Date(conversation.updatedAt).getTime();
      if (Number.isNaN(updatedAt) || updatedAt >= cutoff) {
        continue;
      }

      await this.vault.trash(file, true);
      deletedCount += 1;
    }

    return deletedCount;
  }

  async openConversation(filePath: string): Promise<ChatConversation | null> {
    const file = this.vault.getFileByPath(filePath);
    if (!file) {
      return null;
    }

    const markdown = await this.vault.cachedRead(file);
    const conversation = parseConversationFromMarkdown(markdown, file.path);
    if (!conversation) {
      return null;
    }

    this.activeConversation = conversation;
    this.emitChange();
    return cloneConversation(conversation);
  }

  async autosave(): Promise<void> {
    if (this.activeConversation.messages.length === 0) {
      return;
    }

    this.setSaveStatus("saving");
    try {
      await this.ensureFolder(DEFAULT_CONVERSATION_FOLDER);
      const markdown = serializeConversationToMarkdown(this.activeConversation);
      const filePath =
        this.activeConversation.filePath ??
        `${DEFAULT_CONVERSATION_FOLDER}/${this.activeConversation.id}.md`;
      const file = this.vault.getFileByPath(filePath);
      if (file) {
        await this.vault.modify(file, markdown);
      } else {
        await this.vault.create(filePath, markdown);
      }

      this.activeConversation = {
        ...this.activeConversation,
        filePath,
        saveStatus: "saved",
        saveError: undefined
      };
      this.emitChange();
    } catch (error) {
      this.activeConversation = {
        ...this.activeConversation,
        saveStatus: "error",
        saveError: error instanceof Error ? error.message : "Unable to save conversation."
      };
      this.emitChange();
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.vault.getFolderByPath(current)) {
        continue;
      }

      await this.vault.createFolder(current);
    }
  }

  private updateMessage(
    messageId: string,
    update: (message: ChatMessage) => ChatMessage
  ): void {
    const updatedAt = new Date().toISOString();
    this.activeConversation = {
      ...this.activeConversation,
      updatedAt,
      messages: this.activeConversation.messages.map((message) =>
        message.id === messageId ? update(message) : message
      )
    };
    this.emitChange();
  }

  private setSaveStatus(saveStatus: ConversationSaveStatus): void {
    this.activeConversation = {
      ...this.activeConversation,
      saveStatus
    };
    this.emitChange();
  }

  private emitChange(): void {
    this.onChange();
  }
}

export function serializeConversationToMarkdown(conversation: ChatConversation): string {
  const metadata = serializeConversationMetadata(conversation);
  const lines = [
    CONVERSATION_METADATA_START,
    JSON.stringify(metadata, null, 2),
    CONVERSATION_METADATA_END,
    "",
    "# Vault AI Assistant Conversation",
    "",
    `- Created: ${conversation.createdAt}`,
    `- Updated: ${conversation.updatedAt}`,
    `- Status: ${conversation.saveStatus}`,
    ""
  ];

  for (const message of conversation.messages) {
    if (message.role === "user") {
      lines.push("## User", "", message.content, "");
      continue;
    }

    lines.push("## Assistant", "");
    if (message.provider) {
      lines.push(`Provider: ${message.provider}`);
    }
    if (message.model) {
      lines.push(`Model: ${message.model}`);
    }
    if (message.status) {
      lines.push(`Status: ${message.status}`);
    }
    if (message.usage) {
      lines.push(`Usage: ${formatTokenUsageForMarkdown(message.usage, message.provider, message.model)}`);
    }
    if (message.contextSnapshot) {
      lines.push(`Context: ${formatContextSummary(message.contextSnapshot)}`);
      for (const file of message.contextSnapshot.files) {
        lines.push(
          `- ${file.path} (${file.estimatedTokens} est. tokens; sources: ${file.sourceIds.join(", ")})`
        );
      }
    }
    if (message.operationTargetSnapshot) {
      lines.push(`Edit targets: ${formatTargetSummary(message.operationTargetSnapshot)}`);
      for (const target of message.operationTargetSnapshot.targets) {
        lines.push(`- ${target.type === "folder" ? "Folder" : "File"}: ${target.path}`);
      }
    }
    if (message.error) {
      lines.push(`Error: ${message.error}`);
    }
    if (message.proposals && message.proposals.length > 0) {
      lines.push("Proposals:");
      for (const proposal of message.proposals) {
        lines.push(`- ${proposal.summary}`);
        for (const operation of proposal.operations) {
          const status = formatOperationStatus(operation.status);
          const error = operation.error ? `; error: ${operation.error}` : "";
          const applied = operation.appliedAt ? `; applied: ${operation.appliedAt}` : "";
          lines.push(`  - ${operation.type}: ${operation.path} (${status}${applied}${error})`);
        }
      }
    }
    lines.push("", message.content, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function parseConversationFromMarkdown(
  markdown: string,
  filePath?: string
): ChatConversation | null {
  const startIndex = markdown.indexOf(CONVERSATION_METADATA_START);
  const endIndex = markdown.indexOf(CONVERSATION_METADATA_END);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null;
  }

  const json = markdown
    .slice(startIndex + CONVERSATION_METADATA_START.length, endIndex)
    .trim();

  try {
    const parsed = JSON.parse(json) as Partial<SerializedConversationMetadata>;
    if (!parsed.id || !parsed.title || !parsed.createdAt || !parsed.updatedAt) {
      return null;
    }

    const conversation: ChatConversation = {
      id: parsed.id,
      title: parsed.title,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      messages: Array.isArray(parsed.messages) ? parsed.messages.map(cloneMessage) : [],
      filePath,
      saveStatus: "saved"
    };

    return cloneConversation(conversation);
  } catch {
    return null;
  }
}

function serializeConversationMetadata(
  conversation: ChatConversation
): SerializedConversationMetadata {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((message) => sanitizeMessageForMetadata(message))
  };
}

function sanitizeMessageForMetadata(message: ChatMessage): ChatMessage {
  return cloneMessage({
    ...message,
    attachments: message.attachments?.map((attachment) => {
      if (attachment.kind === "image") {
        const safeAttachment: typeof attachment & {
          dataBase64?: string;
        } = { ...attachment };
        delete safeAttachment.dataBase64;
        return { ...safeAttachment };
      }

      return { ...attachment };
    })
  });
}

function createConversation(): ChatConversation {
  const now = new Date().toISOString();
  const id = createId("conversation");
  return {
    id,
    title: "Vault AI Assistant Conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
    saveStatus: "idle"
  };
}

function cloneConversation(conversation: ChatConversation): ChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(cloneMessage)
  };
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    usage: message.usage ? { ...message.usage } : undefined,
    contextSnapshot: message.contextSnapshot
      ? cloneContextSnapshot(message.contextSnapshot)
      : undefined,
    operationTargetSnapshot: message.operationTargetSnapshot
      ? cloneOperationTargetSnapshot(message.operationTargetSnapshot)
      : undefined,
    attachments: message.attachments ? cloneAttachments(message.attachments) : undefined,
    proposals: message.proposals?.map(cloneProposal)
  };
}

function cloneAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

function cloneProposal(proposal: VaultOperationProposal): VaultOperationProposal {
  return {
    ...proposal,
    operations: proposal.operations.map(cloneOperation)
  };
}

function cloneOperation(operation: VaultOperation): VaultOperation {
  return { ...operation };
}

function cloneContextSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  return {
    ...snapshot,
    files: snapshot.files.map((file) => ({
      ...file,
      sourceIds: file.sourceIds.slice()
    })),
    sourceIds: snapshot.sourceIds.slice()
  };
}

function cloneOperationTargetSnapshot(
  snapshot: OperationTargetSnapshot
): OperationTargetSnapshot {
  return {
    ...snapshot,
    targets: snapshot.targets.map((target) => ({ ...target }))
  };
}

function formatContextSummary(snapshot: ContextSnapshot): string {
  return `${snapshot.fileCount} ${snapshot.fileCount === 1 ? "file" : "files"}, ${snapshot.totalEstimatedTokens} est. tokens`;
}

function formatTargetSummary(snapshot: OperationTargetSnapshot): string {
  return snapshot.targets.map((target) => target.path).join(", ") || snapshot.defaultPath;
}

function formatOperationStatus(status: VaultOperationStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isTerminalOperationStatus(status: VaultOperationStatus): boolean {
  return status === "applied" || status === "rejected" || status === "failed" || status === "invalid";
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
