import { ItemView, MarkdownRenderer, setIcon, WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ChatAttachment,
  ChatEvent,
  ChatImageAttachment,
  ChatMessage,
  ChatRequestImageAttachment,
  ContextSnapshot
} from "./chat-types";
import type { SavedConversationSummary } from "./chat-store";
import { createFallbackChatTitle, generateChatTitleFromFirstMessage } from "./chat-title";
import {
  openFolderPicker,
  openMarkdownNotesPicker
} from "./context-picker";
import {
  ContextSource,
  type ContextAttachmentMode,
  type ContextPackageFile,
  evaluateContextWarnings,
  type OperationTargetSnapshot,
  type OperationTargetSource,
  type OperationTargetScope
} from "./context-utils";
import {
  createDraftImageAttachment,
  getDefaultImageExtension,
  getImageMediaType,
  getImageMediaTypeFromMime,
  isSupportedImagePath,
  persistImageAttachment,
  readPersistedImageAttachmentData
} from "./image-attachments";
import type VaultAIAssistantPlugin from "./main";
import {
  createContextSnapshot,
  createOperationTargetSnapshot,
  getActiveProviderConfig
} from "./provider-adapters";
import { obsidianRequestFetch } from "./obsidian-request-fetch";
import {
  extractTextOrchestratorOperationPayloads,
  formatInvalidOrchestratorOperationMessage,
  handleOrchestratorOperationPayload,
  hydrateTextOrchestratorOperationPayload,
  shouldEnableVaultOperationsForRequest,
  TextOrchestratorOperationStreamFilter
} from "./orchestrator-operations";
import { AnthropicChatAdapter } from "./providers/anthropic-adapter";
import { OpenAIChatAdapter } from "./providers/openai-adapter";
import {
  getSelectedModelForProvider,
  hasAnyAvailableProvider,
  hasAvailableProviderKey,
  MODEL_OPTIONS,
  modelSupportsImages,
  modelSupportsVoice,
  ProviderId,
  setSelectedModelForProvider
} from "./settings";
import { formatTokenUsageForDisplay } from "./token-usage";
import {
  SYSTEM_PROMPT_PRESETS,
  listSystemPromptPresets,
  type SystemPromptPresetId,
  normalizeSystemPromptPresetId,
  readSelectedSystemPrompt
} from "./system-prompts";
import {
  createOperationPreview,
  type VaultOperation,
  type VaultOperationProposal
} from "./vault-operations";
import {
  ComposerModelSelector,
  type ComposerModelProviderGroup
} from "./ui/components/composer-model-selector";
import { Composer } from "./ui/components/composer";
import type {
  ComposerChatHistoryRow,
  ComposerSystemPromptOption
} from "./ui/components/composer-toolbar";
import {
  createOpenAISpeechAudio,
  getVoiceAudioFileName,
  isVoiceModeError,
  mergeVoiceTranscriptDraft,
  transcribeEnglishAudio
} from "./voice-mode";

export const VAULT_AI_ASSISTANT_VIEW_TYPE = "vault-ai-assistant-view";
const INCOMPLETE_ORCHESTRATOR_OPERATION_RECOVERY_MESSAGE =
  "The provider returned an incomplete Orchestrator Operation proposal. No vault files were changed. Retry the request or ask for fewer file changes.";
const VOICE_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg"
] as const;
const VOICE_RECORDER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
const VOICE_RECORDER_TIMESLICE_MS = 1000;

interface MessageScrollSnapshot {
  top: number;
  shouldStickToBottom: boolean;
}

export class VaultAIAssistantView extends ItemView {
  private plugin: VaultAIAssistantPlugin;
  private composerValue = "";
  private activeAbortController: AbortController | null = null;
  private activeAssistantMessageId: string | null = null;
  private imageAttachments: ChatImageAttachment[] = [];
  private chatHistoryOpen = false;
  private chatSettingsOpen = false;
  private chatHistoryLoading = false;
  private chatHistoryRows: SavedConversationSummary[] = [];
  private systemPromptOptions: ComposerSystemPromptOption[] = SYSTEM_PROMPT_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label
  }));
  private modelPickerOpen = false;
  private composerHelperMessage = "";
  private composerHelperIsError = false;
  private composerScopeMode: ContextAttachmentMode = "context";
  private voiceRecorder: MediaRecorder | null = null;
  private voiceRecordingStream: MediaStream | null = null;
  private voiceChunks: Blob[] = [];
  private voiceIsRecording = false;
  private voiceIsTranscribing = false;
  private voiceShouldTranscribeOnStop = true;
  private spokenAudio: HTMLAudioElement | null = null;
  private spokenAudioUrl: string | null = null;
  private spokenMessageId: string | null = null;
  private spokenLoadingMessageId: string | null = null;
  private spokenPlaybackRequestId = 0;
  private outsidePointerDisposers: Array<() => void> = [];
  private reactRoots: Root[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: VaultAIAssistantPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VAULT_AI_ASSISTANT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Vault AI assistant";
  }

  getIcon(): string {
    return "message-square";
  }

  onOpen(): Promise<void> {
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.stopSpokenPlayback();
    this.stopVoiceRecording(false);
    this.unmountReactRoots();
    this.clearOutsidePointerDisposers();
    return Promise.resolve();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    const messageScroll = this.captureMessageScroll();
    this.unmountReactRoots();
    this.clearOutsidePointerDisposers();
    container.empty();
    container.addClass("vault-ai-assistant-view");

    const header = container.createDiv({ cls: "vault-ai-assistant-header" });
    const headerText = header.createDiv({ cls: "vault-ai-assistant-header-text" });
    headerText.createDiv({ cls: "vault-ai-assistant-title", text: "Vault AI" });
    headerText.createDiv({
      cls: "vault-ai-assistant-chat-title",
      text: this.getActiveConversationDisplayTitle()
    });

    const providerConfigured = hasAnyAvailableProvider(this.app, this.plugin.settings);
    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    const headerSide = header.createDiv({ cls: "vault-ai-assistant-header-side" });
    const status = headerSide.createDiv({
      cls: providerConfigured
        ? "vault-ai-assistant-status vault-ai-assistant-status-pill vault-ai-assistant-status-ready"
        : "vault-ai-assistant-status vault-ai-assistant-status-pill vault-ai-assistant-status-setup"
    });
    status.createSpan({ cls: "vault-ai-assistant-status-dot" });
    status.createSpan({
      text: providerConfigured
        ? `${providerConfig.label} · ${providerConfig.modelLabel}`
        : "Setup needed"
    });

    if (providerConfigured) {
      this.renderReadyState(container);
      this.restoreMessageScroll(messageScroll);
      return;
    }

    this.renderSetupState(container);
  }

  private getActiveConversationDisplayTitle(): string {
    const activeConversation = this.plugin.chatStore.getState().activeConversation;
    if (activeConversation.messages.length === 0) {
      return "New chat";
    }

    return activeConversation.title;
  }

  private renderSetupState(container: HTMLElement): void {
    const setup = container.createDiv({ cls: "vault-ai-assistant-setup" });
    setup.createEl("h2", { text: "Set up a provider" });
    setup.createEl("p", {
      text: "Add a provider API key in plugin settings to start using the assistant."
    });

    const action = setup.createEl("button", {
      cls: "vault-ai-assistant-primary",
      text: "Open settings"
    });
    action.addEventListener("click", () => this.plugin.openSettings());

    setup.createDiv({
      cls: "vault-ai-assistant-disabled-note",
      text: "Chat and vault context unlock after setup."
    });
  }

  private renderReadyState(container: HTMLElement): void {
    this.renderChat(container);
  }

  private renderNewChatAction(container: HTMLElement): void {
    const action = container.createEl("button", {
      cls: "vault-ai-assistant-icon-action vault-ai-assistant-new-chat"
    });
    action.type = "button";
    setIcon(action, "message-square-plus");
    setIconActionLabel(action, "New chat");
    action.addEventListener("click", () => {
      void this.startNewChat();
    });
  }

  private async startNewChat(): Promise<void> {
    this.stopSpokenPlayback();
    await this.plugin.chatStore.newChat();
    this.clearConversationDraftState();
    this.render();
  }

  private clearConversationDraftState(): void {
    this.stopSpokenPlayback();
    this.composerValue = "";
    this.composerHelperMessage = "";
    this.composerHelperIsError = false;
    this.imageAttachments = [];
    this.composerScopeMode = "context";
    this.modelPickerOpen = false;
    this.chatHistoryOpen = false;
    this.chatSettingsOpen = false;
    this.plugin.contextManager.clearSourcesAndTargets();
  }

  private renderChat(container: HTMLElement): void {
    const chat = container.createDiv({ cls: "vault-ai-assistant-chat" });
    this.renderSaveStatus(chat);
    this.renderMessageList(chat);
    this.renderComposer(chat);
  }

  private renderSaveStatus(container: HTMLElement): void {
    const { activeConversation } = this.plugin.chatStore.getState();
    if (activeConversation.saveStatus === "idle") {
      return;
    }

    const textByStatus = {
      saving: "Saving...",
      saved: "Autosaved",
      error: "Save failed - check the conversation folder and try again.",
      idle: ""
    };

    container.createDiv({
      cls: `vault-ai-assistant-save-status vault-ai-assistant-save-status-${activeConversation.saveStatus}`,
      text: textByStatus[activeConversation.saveStatus]
    });
  }

  private renderMessageList(container: HTMLElement): void {
    const messages = this.plugin.chatStore.getState().activeConversation.messages;
    const list = container.createDiv({ cls: "vault-ai-assistant-messages" });

    if (messages.length === 0) {
      const empty = list.createDiv({ cls: "vault-ai-assistant-chat-empty" });
      empty.createDiv({ cls: "vault-ai-assistant-chat-empty-kicker", text: "Vault context" });
      empty.createEl("h3", { text: "Start a chat" });
      empty.createEl("p", {
        text:
          "Ask about attached vault context, then review any proposed Markdown changes before they touch your notes."
      });

      if (this.plugin.contextManager.getSummary().fileCount === 0) {
        const noContext = empty.createDiv({ cls: "vault-ai-assistant-chat-empty-status" });
        noContext.createSpan({ text: "No context attached" });
        noContext.createSpan({
          text: "Attach notes or folders from the composer for vault-grounded answers."
        });
      }
      return;
    }

    for (const message of messages) {
      this.renderMessage(list, message);
    }
  }

  private captureMessageScroll(): MessageScrollSnapshot | null {
    const list = this.containerEl.querySelector<HTMLElement>(".vault-ai-assistant-messages");
    if (!list) {
      return null;
    }

    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    return {
      top: list.scrollTop,
      shouldStickToBottom: distanceFromBottom < 48
    };
  }

  private restoreMessageScroll(snapshot: MessageScrollSnapshot | null): void {
    if (!snapshot) {
      return;
    }

    const restore = () => {
      const list = this.containerEl.querySelector<HTMLElement>(".vault-ai-assistant-messages");
      if (!list) {
        return;
      }

      list.scrollTop = snapshot.shouldStickToBottom ? list.scrollHeight : snapshot.top;
    };

    restore();
    window.requestAnimationFrame(restore);
  }

  private renderMessage(container: HTMLElement, message: ChatMessage): void {
    const row = container.createDiv({
      cls: `vault-ai-assistant-message vault-ai-assistant-message-${message.role}`
    });

    this.renderMessageContent(row, message);

    if (message.role === "user") {
      this.renderMessageAttachments(row, message);
    }

    if (message.role === "assistant") {
      for (const proposal of message.proposals ?? []) {
        this.renderProposalCard(row, message, proposal);
      }

      const provider = message.provider ? this.getProviderLabel(message.provider) : "Assistant";
      const model =
        message.provider && message.model
          ? this.getModelLabel(message.provider, message.model)
          : message.model;
      const metadata = row.createDiv({ cls: "vault-ai-assistant-message-meta" });
      metadata.setText(model ? `${provider} · ${model}` : provider);
      if (message.usage) {
        metadata.createSpan({
          cls: "vault-ai-assistant-token-usage",
          text: ` · ${formatTokenUsageForDisplay(message.usage, message.provider, message.model)}`
        });
      }
      if (message.status === "streaming") {
        metadata.createSpan({ text: " · Thinking..." });
      }
      if (message.status === "stopped") {
        metadata.createSpan({ cls: "vault-ai-assistant-stopped", text: " · Stopped" });
      }
      if (message.status === "error" && message.error) {
        row.createDiv({
          cls: "vault-ai-assistant-message-error",
          text: message.error
        });
      }
    } else {
      row.createDiv({ cls: "vault-ai-assistant-message-meta", text: "You" });
    }

    if (message.role === "assistant") {
      if (message.contextSnapshot) {
        this.renderContextUsed(row, message.contextSnapshot, Boolean(message.operationTargetSnapshot));
      }
      if (message.operationTargetSnapshot) {
        this.renderTargetsUsed(row, message.operationTargetSnapshot);
      }
      this.renderAssistantMessageActions(row, message);
    }
  }

  private renderMessageContent(container: HTMLElement, message: ChatMessage): void {
    const content = container.createDiv({ cls: "vault-ai-assistant-message-content" });
    const text = message.content || (message.status === "streaming" ? "Thinking..." : "");

    if (message.role !== "assistant" || !message.content) {
      content.setText(text);
      return;
    }

    content.addClass("vault-ai-assistant-message-markdown");
    content.addClass("markdown-rendered");
    void MarkdownRenderer.render(
      this.app,
      message.content,
      content,
      this.getMarkdownRenderSourcePath(message),
      this
    ).catch(() => {
      content.empty();
      content.setText(message.content);
    });
  }

  private renderMessageAttachments(container: HTMLElement, message: ChatMessage): void {
    const attachments = message.attachments ?? [];
    if (attachments.length === 0) {
      return;
    }

    const bubbles = container.createDiv({ cls: "vault-ai-assistant-message-attachments" });
    for (const attachment of attachments) {
      const isScope = attachment.kind === "markdown" && attachment.mode === "target";
      const bubble = bubbles.createDiv({
        cls: [
          "vault-ai-assistant-message-attachment",
          isScope
            ? "vault-ai-assistant-message-attachment-scope"
            : "vault-ai-assistant-message-attachment-context"
        ].join(" ")
      });

      const icon = bubble.createSpan({ cls: "vault-ai-assistant-message-attachment-icon" });
      setIcon(icon, this.getMessageAttachmentIcon(attachment));

      const text = bubble.createSpan({ cls: "vault-ai-assistant-message-attachment-text" });
      text.createSpan({
        cls: "vault-ai-assistant-message-attachment-label",
        text: this.getMessageAttachmentLabel(attachment)
      });
      text.createSpan({
        cls: "vault-ai-assistant-message-attachment-meta",
        text: this.getMessageAttachmentMeta(attachment)
      });
    }
  }

  private getMessageAttachmentIcon(attachment: ChatAttachment): string {
    if (attachment.kind === "image") {
      return "image";
    }

    if (attachment.mode === "target") {
      return attachment.targetType === "folder" || attachment.sourceType === "folder"
        ? "folder-key"
        : "file-lock";
    }

    return attachment.sourceType === "folder" ? "folder" : "file-text";
  }

  private getMessageAttachmentLabel(attachment: ChatAttachment): string {
    if (attachment.kind === "image") {
      return attachment.originalPath ?? attachment.persistedPath ?? attachment.label;
    }

    return attachment.path;
  }

  private getMessageAttachmentMeta(attachment: ChatAttachment): string {
    if (attachment.kind === "image") {
      return "Image";
    }

    const mode = attachment.mode === "target" ? "Target" : "Context";
    const type =
      attachment.targetType === "folder" || attachment.sourceType === "folder"
        ? "folder"
        : "file";
    return `${mode} · ${type}`;
  }

  private getMarkdownRenderSourcePath(message: ChatMessage): string {
    return message.contextSnapshot?.files[0]?.path ?? this.app.workspace.getActiveFile()?.path ?? "";
  }

  private renderAssistantMessageActions(container: HTMLElement, message: ChatMessage): void {
    if (!message.content.trim()) {
      return;
    }

    const actions = container.createDiv({ cls: "vault-ai-assistant-message-actions" });
    if (this.plugin.settings.enableSpokenResponses && message.status === "completed") {
      const isPlaying = this.spokenMessageId === message.id;
      const isLoading = this.spokenLoadingMessageId === message.id;
      const label = isLoading
        ? "Preparing audio"
        : isPlaying
          ? "Stop playback"
          : "Play response aloud";
      const play = actions.createEl("button", {
        cls: `vault-ai-assistant-icon-action vault-ai-assistant-message-speech${
          isPlaying ? " is-playing" : ""
        }`
      });
      play.type = "button";
      play.disabled = isLoading;
      setIcon(play, isPlaying ? "square" : "volume-2");
      setIconActionLabel(play, label);
      play.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.toggleSpokenPlayback(message);
      });
    }

    const copy = actions.createEl("button", {
      cls: "vault-ai-assistant-icon-action vault-ai-assistant-message-copy"
    });
    copy.type = "button";
    setIcon(copy, "copy");
    setIconActionLabel(copy, "Copy response");
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.copyAssistantMessageText(message.content, copy);
    });
  }

  private async copyAssistantMessageText(text: string, button: HTMLButtonElement): Promise<void> {
    try {
      await writeTextToClipboard(text);
      setIconActionLabel(button, "Copied");
      button.addClass("is-copied");
      window.setTimeout(() => {
        setIconActionLabel(button, "Copy response");
        button.removeClass("is-copied");
      }, 1200);
    } catch {
      setIconActionLabel(button, "Copy failed");
      window.setTimeout(() => {
        setIconActionLabel(button, "Copy response");
      }, 1200);
    }
  }

  private async toggleSpokenPlayback(message: ChatMessage): Promise<void> {
    if (this.spokenMessageId === message.id) {
      this.stopSpokenPlayback();
      this.render();
      return;
    }

    if (this.spokenLoadingMessageId === message.id) {
      return;
    }

    const apiKey = this.app.secretStorage.getSecret(this.plugin.settings.openaiSecretName);
    if (!apiKey) {
      this.composerHelperMessage = "OpenAI API key is required for spoken responses.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    this.stopSpokenPlayback();
    const requestId = this.spokenPlaybackRequestId + 1;
    this.spokenPlaybackRequestId = requestId;
    this.spokenLoadingMessageId = message.id;
    this.composerHelperMessage = "";
    this.composerHelperIsError = false;
    this.render();

    try {
      const speech = await createOpenAISpeechAudio({
        apiKey,
        input: message.content,
        voice: this.plugin.settings.openaiSpeechVoice
      });
      if (requestId !== this.spokenPlaybackRequestId) {
        return;
      }

      const audioUrl = URL.createObjectURL(
        new Blob([speech.audioData], { type: speech.mediaType })
      );
      const audio = new Audio(audioUrl);
      audio.addEventListener(
        "ended",
        () => {
          if (this.spokenAudio === audio) {
            this.stopSpokenPlayback(false);
            this.render();
          }
        },
        { once: true }
      );
      audio.addEventListener(
        "error",
        () => {
          if (this.spokenAudio === audio) {
            this.stopSpokenPlayback(false);
            this.composerHelperMessage = "Spoken response playback failed.";
            this.composerHelperIsError = true;
            this.render();
          }
        },
        { once: true }
      );

      this.spokenAudio = audio;
      this.spokenAudioUrl = audioUrl;
      this.spokenMessageId = message.id;
      this.spokenLoadingMessageId = null;
      await audio.play();
      this.render();
    } catch {
      if (requestId === this.spokenPlaybackRequestId) {
        this.stopSpokenPlayback(false);
        this.composerHelperMessage = "Spoken response playback failed.";
        this.composerHelperIsError = true;
        this.render();
      }
    }
  }

  private stopSpokenPlayback(cancelPending = true): void {
    if (cancelPending) {
      this.spokenPlaybackRequestId += 1;
    }

    if (this.spokenAudio) {
      this.spokenAudio.pause();
      this.spokenAudio.removeAttribute("src");
      this.spokenAudio.load();
    }

    if (this.spokenAudioUrl) {
      URL.revokeObjectURL(this.spokenAudioUrl);
    }

    this.spokenAudio = null;
    this.spokenAudioUrl = null;
    this.spokenMessageId = null;
    this.spokenLoadingMessageId = null;
  }

  private renderContextUsed(
    container: HTMLElement,
    snapshot: ContextSnapshot,
    hasOperationTargetSnapshot = false
  ): void {
    const label = hasOperationTargetSnapshot ? "Context sent" : "Context used";
    const fileCountLabel = this.formatContextFileCount(snapshot.fileCount);
    const disclosure = container.createEl("details", {
      cls: "vault-ai-assistant-context-used"
    });
    disclosure.createEl("summary", {
      text: `${label} · ${fileCountLabel}`
    });

    const details = disclosure.createDiv({ cls: "vault-ai-assistant-context-used-details" });
    details.createDiv({
      cls: "vault-ai-assistant-context-meta",
      text: fileCountLabel
    });

    if (snapshot.files.length > 0) {
      const files = details.createEl("ul", { cls: "vault-ai-assistant-folder-files" });
      for (const file of snapshot.files) {
        files.createEl("li", {
          text: `${file.path} · ${file.sourceIds.join(", ")}`
        });
      }
    }

    details.createDiv({
      cls: "vault-ai-assistant-context-footer",
      text: "Only shown markdown files were included."
    });
  }

  private renderTargetsUsed(container: HTMLElement, snapshot: OperationTargetSnapshot): void {
    const disclosure = container.createEl("details", {
      cls: "vault-ai-assistant-context-used vault-ai-assistant-scopes-used"
    });
    disclosure.createEl("summary", {
      text: `Edit targets · ${snapshot.targetCount} ${snapshot.targetCount === 1 ? "target" : "targets"}`
    });

    const details = disclosure.createDiv({ cls: "vault-ai-assistant-context-used-details" });
    const files = details.createEl("ul", { cls: "vault-ai-assistant-folder-files" });
    for (const target of snapshot.targets) {
      files.createEl("li", {
        text: `${target.type === "folder" ? "Folder" : "File"} · ${target.path}`
      });
    }
    details.createDiv({
      cls: "vault-ai-assistant-context-footer",
      text: "Edit targets are path hints only; contents were not included as context."
    });
  }

  private renderProposalCard(
    container: HTMLElement,
    message: ChatMessage,
    proposal: VaultOperationProposal
  ): void {
    const card = container.createDiv({ cls: "vault-ai-assistant-proposal" });
    const header = card.createDiv({ cls: "vault-ai-assistant-proposal-header" });
    const summary = header.createDiv({ cls: "vault-ai-assistant-proposal-summary" });
    const title = summary.createDiv({ cls: "vault-ai-assistant-proposal-title" });
    const titleIcon = title.createSpan({ cls: "vault-ai-assistant-proposal-title-icon" });
    setIcon(titleIcon, "git-pull-request");
    title.createSpan({ text: "Proposed changes" });
    summary.createDiv({
      cls: "vault-ai-assistant-message-meta",
      text: `${proposal.operations.length} proposed change${proposal.operations.length === 1 ? "" : "s"} · ${this.getProposalStatusLabel(proposal)}`
    });

    const hasPendingOperations = proposal.operations.some(
      (operation) => operation.status === "pending"
    );
    const hasPendingDelete = proposal.operations.some(
      (operation) => operation.status === "pending" && this.isDestructiveOperation(operation)
    );
    if (hasPendingOperations) {
      const actions = header.createDiv({ cls: "vault-ai-assistant-proposal-actions" });
      const applyAll = this.createReviewActionButton(
        actions,
        hasPendingDelete ? "Accept all including delete" : "Accept all",
        "check",
        hasPendingDelete ? "danger" : "primary"
      );
      applyAll.addEventListener("click", () => {
        void this.applyProposal(message.id, proposal.id);
      });

      const rejectAll = this.createReviewActionButton(actions, "Reject all", "x", "secondary");
      rejectAll.addEventListener("click", () => {
        void this.plugin.chatStore.rejectProposal(message.id, proposal.id);
      });
    }

    const list = card.createDiv({ cls: "vault-ai-assistant-operation-list" });
    for (const operation of proposal.operations) {
      this.renderOperationRow(list, message, proposal, operation);
    }
  }

  private renderOperationRow(
    container: HTMLElement,
    message: ChatMessage,
    proposal: VaultOperationProposal,
    operation: VaultOperation
  ): void {
    const rowClasses = [
      "vault-ai-assistant-operation-row",
      `vault-ai-assistant-operation-${operation.status}`
    ];
    if (this.isDestructiveOperation(operation)) {
      rowClasses.push("vault-ai-assistant-operation-destructive");
    }

    const row = container.createDiv({
      cls: rowClasses.join(" ")
    });
    const header = row.createDiv({ cls: "vault-ai-assistant-operation-header" });
    const kind = header.createSpan({ cls: "vault-ai-assistant-operation-kind" });
    const kindIcon = kind.createSpan({ cls: "vault-ai-assistant-operation-kind-icon" });
    setIcon(kindIcon, this.getOperationIcon(operation));
    kind.createSpan({ text: this.getOperationTypeLabel(operation) });
    const path = header.createSpan({ cls: "vault-ai-assistant-operation-path" });
    path.createSpan({ text: operation.path });
    header.createSpan({
      cls: `vault-ai-assistant-operation-state vault-ai-assistant-operation-state-${operation.status}`,
      text: this.getOperationStatusLabel(operation.status)
    });

    row.createDiv({
      cls: "vault-ai-assistant-operation-description",
      text: operation.description
    });

    if (operation.error) {
      row.createDiv({ cls: "vault-ai-assistant-operation-error", text: operation.error });
    }

    if (operation.appliedAt) {
      row.createDiv({
        cls: "vault-ai-assistant-operation-audit",
        text: `Applied ${this.formatHistoryDate(operation.appliedAt)}`
      });
    }

    const review = row.createEl("details", { cls: "vault-ai-assistant-operation-preview" });
    review.createEl("summary", {
      text: this.isDestructiveOperation(operation) ? "Review delete" : "Review changes"
    });
    this.renderOperationPreview(review, operation);

    if (operation.status === "pending") {
      const actions = row.createDiv({ cls: "vault-ai-assistant-operation-actions" });
      const apply = this.createReviewActionButton(
        actions,
        this.isDestructiveOperation(operation) ? "Move to trash" : "Accept",
        this.isDestructiveOperation(operation) ? "trash-2" : "check",
        this.isDestructiveOperation(operation) ? "danger" : "primary"
      );
      apply.addEventListener("click", () => {
        void this.applyOperation(message.id, proposal.id, operation.id);
      });

      const reject = this.createReviewActionButton(actions, "Reject", "x", "secondary");
      reject.addEventListener("click", () => {
        void this.plugin.chatStore.rejectOperation(message.id, proposal.id, operation.id);
      });
    }
  }

  private createReviewActionButton(
    container: HTMLElement,
    label: string,
    icon: string,
    variant: "primary" | "secondary" | "danger"
  ): HTMLButtonElement {
    const button = container.createEl("button", {
      cls: `vault-ai-assistant-review-action vault-ai-assistant-review-action-${variant}`
    });
    button.type = "button";
    const iconContainer = button.createSpan({ cls: "vault-ai-assistant-review-action-icon" });
    setIcon(iconContainer, icon);
    button.createSpan({ text: label });
    return button;
  }

  private renderOperationPreview(container: HTMLElement, operation: VaultOperation): void {
    const preview = createOperationPreview(operation);
    if (operation.type === "modify_note") {
      const diff = container.createEl("pre", { cls: "vault-ai-assistant-diff" });
      for (const line of preview.split("\n")) {
        diff.createDiv({
          cls: `vault-ai-assistant-diff-line ${this.getDiffLineClass(line)}`,
          text: line
        });
      }
      return;
    }

    container.createEl("pre", {
      cls: "vault-ai-assistant-markdown-preview",
      text: preview
    });
  }

  private getDiffLineClass(line: string): string {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return "vault-ai-assistant-diff-added";
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return "vault-ai-assistant-diff-removed";
    }
    return "vault-ai-assistant-diff-context";
  }

  private getOperationTypeLabel(operation: VaultOperation): string {
    if (operation.type === "create_note") {
      return "Create";
    }
    if (operation.type === "create_folder") {
      return "Create folder";
    }
    if (operation.type === "modify_note") {
      return "Modify";
    }
    if (operation.type === "delete_note") {
      return "Delete";
    }
    if (operation.type === "move_note") {
      return "Move note";
    }
    if (operation.type === "move_folder") {
      return "Move folder";
    }
    if (operation.type === "copy_note") {
      return "Copy note";
    }
    if (operation.type === "delete_folder") {
      return "Delete folder";
    }
    return "Append";
  }

  private getOperationStatusLabel(status: VaultOperation["status"]): string {
    if (status === "pending") {
      return "Pending";
    }
    if (status === "applying") {
      return "Applying";
    }
    if (status === "applied") {
      return "Applied";
    }
    if (status === "rejected") {
      return "Rejected";
    }
    if (status === "failed") {
      return "Failed";
    }
    return "Not actionable";
  }

  private getOperationIcon(operation: VaultOperation): string {
    if (operation.type === "create_folder") {
      return "folder-plus";
    }
    if (operation.type === "create_note") {
      return "file-plus";
    }
    if (operation.type === "modify_note") {
      return "file-pen";
    }
    if (operation.type === "delete_note") {
      return "trash-2";
    }
    if (operation.type === "move_note" || operation.type === "move_folder") {
      return "move-right";
    }
    if (operation.type === "copy_note") {
      return "copy";
    }
    if (operation.type === "delete_folder") {
      return "folder-x";
    }
    return "list-plus";
  }

  private isDestructiveOperation(operation: VaultOperation): boolean {
    return operation.type === "delete_note" || operation.type === "delete_folder";
  }

  private getProposalStatusLabel(proposal: VaultOperationProposal): string {
    const operations = proposal.operations;
    if (
      operations.some(
        (operation) => operation.status === "pending" || operation.status === "applying"
      )
    ) {
      return "Pending";
    }
    if (operations.length > 0 && operations.every((operation) => operation.status === "applied")) {
      return "Applied";
    }
    if (operations.length > 0 && operations.every((operation) => operation.status === "rejected")) {
      return "Rejected";
    }
    if (operations.some((operation) => operation.status === "failed" || operation.status === "invalid")) {
      return "Needs review";
    }
    return "Partially applied";
  }

  private async applyOperation(
    messageId: string,
    proposalId: string,
    operationId: string
  ): Promise<boolean> {
    const operation = this.findOperation(messageId, proposalId, operationId);
    if (!operation || operation.status !== "pending") {
      return false;
    }

    await this.plugin.chatStore.updateOperationStatus(
      messageId,
      proposalId,
      operationId,
      "applying"
    );
    const result = await this.plugin.operationExecutor.applyOperation(operation);
    if (result.ok) {
      await this.plugin.chatStore.updateOperationStatus(
        messageId,
        proposalId,
        operationId,
        "applied"
      );
    } else {
      await this.plugin.chatStore.updateOperationStatus(
        messageId,
        proposalId,
        operationId,
        "failed",
        result.error ?? "Note was not found."
      );
    }
    this.render();
    return result.ok;
  }

  private async applyProposal(messageId: string, proposalId: string): Promise<void> {
    const proposal = this.plugin.chatStore
      .getState()
      .activeConversation.messages.find((message) => message.id === messageId)
      ?.proposals?.find((candidate) => candidate.id === proposalId);
    if (!proposal) {
      return;
    }

    for (const operation of proposal.operations) {
      if (operation.status === "pending") {
        const applied = await this.applyOperation(messageId, proposalId, operation.id);
        if (!applied) {
          break;
        }
      }
    }
  }

  private findOperation(
    messageId: string,
    proposalId: string,
    operationId: string
  ): VaultOperation | undefined {
    return this.plugin.chatStore
      .getState()
      .activeConversation.messages.find((message) => message.id === messageId)
      ?.proposals?.find((proposal) => proposal.id === proposalId)
      ?.operations.find((operation) => operation.id === operationId);
  }

  private renderComposer(container: HTMLElement): void {
    const composer = container.createDiv({ cls: "vault-ai-assistant-composer" });
    const isStreaming = this.activeAbortController !== null;
    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    const selectedModelSupportsImages = modelSupportsImages(
      providerConfig.provider,
      providerConfig.model
    );
    const activeFileContextOptions = this.getActiveFileContextOptions();
    const root = createRoot(composer);
    this.reactRoots.push(root);
    root.render(
      createElement(Composer, {
        value: this.composerValue,
        disabled: isStreaming,
        isStreaming,
        canSubmitMessage: (value) => this.canSendMessage(value),
        helperMessage: this.composerHelperMessage,
        helperIsError: this.composerHelperIsError,
        scopeMode: this.composerScopeMode,
        contextSources: this.plugin.contextManager.getSources(activeFileContextOptions),
        targetSources: this.plugin.contextManager.getTargetSources(activeFileContextOptions),
        imageAttachments: this.imageAttachments,
        modelSelector: this.getComposerModelSelectorState(),
        selectedModelSupportsImages,
        voiceInput: this.getVoiceInputState(),
        chatHistoryOpen: this.chatHistoryOpen,
        chatSettingsOpen: this.chatSettingsOpen,
        chatHistoryLoading: this.chatHistoryLoading,
        chatHistoryRows: this.getComposerChatHistoryRows(),
        systemPromptOptions: this.systemPromptOptions,
        selectedSystemPromptId: normalizeSystemPromptPresetId(
          this.plugin.settings.systemPromptPresetId
        ),
        getContextDisplayName: (source) => this.getSourceDisplayName(source),
        getContextBadgeLabel: (source) => this.getSourceBadgeLabel(source),
        onValueChange: (value) => {
          this.composerValue = value;
          this.composerHelperMessage = "";
          this.composerHelperIsError = false;
        },
        onSubmit: (value) => {
          void this.sendMessage(value);
        },
        onStop: () => {
          void this.stopResponse();
        },
        onAttachImageFiles: (files) => {
          void this.attachExternalImageFiles(files);
        },
        onToggleVoiceInput: () => {
          void this.toggleVoiceInput();
        },
        onScopeModeChange: (mode) => {
          this.composerScopeMode = mode;
        },
        onAddContext: () => this.openComposerContextPicker(),
        onAddScope: () => this.openComposerScopePicker(),
        onRemoveContext: (source) => {
          this.plugin.contextManager.removeSource(source.id);
        },
        onRemoveAllContext: () => {
          this.plugin.contextManager.clearSources();
        },
        onRemoveScope: (target) => {
          this.plugin.contextManager.removeTargetSource(target.id);
        },
        onRemoveImage: (attachment) => {
          this.imageAttachments = this.imageAttachments.filter(
            (candidate) => candidate.id !== attachment.id
          );
          this.render();
        },
        onToggleModelPicker: () => this.toggleModelPicker(),
        onSelectModel: (provider, model) => {
          void this.selectComposerModel(provider, model);
        },
        onNewChat: () => {
          void this.startNewChat();
        },
        onToggleChatHistory: () => this.toggleChatHistory(),
        onToggleSettings: () => this.toggleChatSettings(),
        onOpenSavedChat: (filePath) => {
          void this.openSavedConversation(filePath);
        },
        onSelectSystemPrompt: (presetId) => {
          void this.selectSystemPrompt(presetId);
        }
      })
    );

    if (this.modelPickerOpen || this.chatHistoryOpen || this.chatSettingsOpen) {
      this.registerOutsidePointerDismiss([composer], () => {
        this.modelPickerOpen = false;
        this.chatHistoryOpen = false;
        this.chatSettingsOpen = false;
        this.render();
      });
    }
  }

  private getComposerModelSelectorState() {
    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    const providers: ComposerModelProviderGroup[] = (["openai", "anthropic"] as ProviderId[]).map(
      (provider) => ({
        id: provider,
        label: this.getProviderLabel(provider),
        available: hasAvailableProviderKey(this.app, this.plugin.settings, provider),
        selectedModel: getSelectedModelForProvider(this.plugin.settings, provider),
        models: MODEL_OPTIONS[provider]
      })
    );

    return {
      currentProviderLabel: providerConfig.label,
      currentModelLabel: providerConfig.modelLabel,
      isOpen: this.modelPickerOpen,
      providers,
      activeProvider: this.plugin.settings.activeProvider
    };
  }

  private getComposerChatHistoryRows(): ComposerChatHistoryRow[] {
    return this.chatHistoryRows.map((conversation) => ({
      filePath: conversation.filePath,
      title: conversation.title,
      formattedDate: this.formatHistoryDate(conversation.updatedAt)
    }));
  }

  private toggleModelPicker(): void {
    const nextOpen = !this.modelPickerOpen;
    this.modelPickerOpen = nextOpen;
    if (nextOpen) {
      this.chatHistoryOpen = false;
      this.chatSettingsOpen = false;
    }
    this.render();
  }

  private toggleChatHistory(): void {
    const nextOpen = !this.chatHistoryOpen;
    this.chatHistoryOpen = nextOpen;
    if (nextOpen) {
      this.chatSettingsOpen = false;
      this.modelPickerOpen = false;
      this.loadComposerChatHistory();
    }
    this.render();
  }

  private toggleChatSettings(): void {
    const nextOpen = !this.chatSettingsOpen;
    this.chatSettingsOpen = nextOpen;
    if (nextOpen) {
      this.chatHistoryOpen = false;
      this.modelPickerOpen = false;
      void this.refreshSystemPromptOptions();
    }
    this.render();
  }

  private async refreshSystemPromptOptions(): Promise<void> {
    const created = await this.plugin.ensureEditableSystemPrompts();
    if (!created) {
      this.composerHelperMessage =
        "System prompt files could not be created under vault-ai-assistant/system-prompts.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    try {
      const presets = await listSystemPromptPresets(this.app.vault);
      this.systemPromptOptions = presets.map((preset) => ({
        id: preset.id,
        label: preset.label
      }));
    } catch (error) {
      console.error("Vault AI Assistant could not discover system prompt files.", error);
      this.composerHelperMessage =
        "System prompt files could not be loaded from vault-ai-assistant/system-prompts.";
      this.composerHelperIsError = true;
    }

    if (this.chatSettingsOpen) {
      this.render();
    }
  }

  private loadComposerChatHistory(): void {
    this.chatHistoryLoading = true;
    this.chatHistoryRows = [];
    void this.plugin.chatStore.listSavedConversations().then((conversations) => {
      this.chatHistoryRows = conversations;
      this.chatHistoryLoading = false;
      if (this.chatHistoryOpen) {
        this.render();
      }
    });
  }

  private async selectSystemPrompt(presetId: SystemPromptPresetId): Promise<void> {
    this.plugin.settings.systemPromptPresetId = normalizeSystemPromptPresetId(presetId);
    await this.plugin.saveSettings();
    this.render();
  }

  private renderComposerModelSelector(container: HTMLElement): void {
    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    const providers: ComposerModelProviderGroup[] = (["openai", "anthropic"] as ProviderId[]).map(
      (provider) => ({
        id: provider,
        label: this.getProviderLabel(provider),
        available: hasAvailableProviderKey(this.app, this.plugin.settings, provider),
        selectedModel: getSelectedModelForProvider(this.plugin.settings, provider),
        models: MODEL_OPTIONS[provider]
      })
    );
    const root = createRoot(container);
    this.reactRoots.push(root);
    root.render(
      createElement(ComposerModelSelector, {
        currentProviderLabel: providerConfig.label,
        currentModelLabel: providerConfig.modelLabel,
        isOpen: this.modelPickerOpen,
        providers,
        activeProvider: this.plugin.settings.activeProvider,
        onToggle: () => {
          const nextOpen = !this.modelPickerOpen;
          this.modelPickerOpen = nextOpen;
          if (nextOpen) {
            this.chatHistoryOpen = false;
            this.chatSettingsOpen = false;
          }
          this.render();
        },
        onSelect: (provider, model) => {
          void this.selectComposerModel(provider, model);
        }
      })
    );
    if (this.modelPickerOpen) {
      this.registerOutsidePointerDismiss([container], () => {
        this.modelPickerOpen = false;
        this.render();
      });
    }
  }

  private async selectComposerModel(provider: ProviderId, model: string): Promise<void> {
    setSelectedModelForProvider(this.plugin.settings, provider, model);
    await this.plugin.saveSettings();
    this.modelPickerOpen = false;
    this.composerHelperMessage = "";
    this.composerHelperIsError = false;
    this.render();
  }

  private unmountReactRoots(): void {
    for (const root of this.reactRoots) {
      root.unmount();
    }
    this.reactRoots = [];
  }

  private renderComposerInputHighlight(container: HTMLElement, value: string): void {
    container.empty();
    container.setText(value);
    if (value.endsWith("\n")) {
      container.appendChild(document.createTextNode(" "));
    }
  }

  private renderComposerSettings(container: HTMLElement): void {
    const settingsShell = container.createDiv({ cls: "vault-ai-assistant-composer-settings" });
    const nav = settingsShell.createDiv({ cls: "vault-ai-assistant-toolbar-nav" });
    this.renderNewChatAction(nav);

    const history = nav.createEl("button", {
      cls: `vault-ai-assistant-icon-action vault-ai-assistant-chat-history-toggle${this.chatHistoryOpen ? " is-active" : ""}`
    });
    history.type = "button";
    history.setAttr("aria-pressed", String(this.chatHistoryOpen));
    setIcon(history, "history");
    setIconActionLabel(history, "Chat history");
    history.addEventListener("click", () => {
      const nextOpen = !this.chatHistoryOpen;
      this.chatHistoryOpen = nextOpen;
      if (nextOpen) {
        this.chatSettingsOpen = false;
        this.modelPickerOpen = false;
      }
      this.render();
    });

    const settings = nav.createEl("button", {
      cls: `vault-ai-assistant-icon-action vault-ai-assistant-chat-settings-toggle${this.chatSettingsOpen ? " is-active" : ""}`
    });
    settings.type = "button";
    settings.setAttr("aria-pressed", String(this.chatSettingsOpen));
    setIcon(settings, "settings");
    setIconActionLabel(settings, "Settings");
    settings.addEventListener("click", () => {
      const nextOpen = !this.chatSettingsOpen;
      this.chatSettingsOpen = nextOpen;
      if (nextOpen) {
        this.chatHistoryOpen = false;
        this.modelPickerOpen = false;
      }
      this.render();
    });

    if (this.chatHistoryOpen || this.chatSettingsOpen) {
      const popover = settingsShell.createDiv({
        cls: `vault-ai-assistant-toolbar-popover ${
          this.chatHistoryOpen
            ? "vault-ai-assistant-toolbar-popover-history"
            : "vault-ai-assistant-toolbar-popover-settings"
        }`
      });
      popover.setAttr("role", "dialog");
      popover.setAttr("aria-label", this.chatHistoryOpen ? "Chat history" : "System Prompt");
      if (this.chatHistoryOpen) {
        this.renderChatHistory(popover);
      } else {
        this.renderChatSettings(popover);
      }
      this.registerOutsidePointerDismiss([settingsShell], () => {
        this.chatHistoryOpen = false;
        this.chatSettingsOpen = false;
        this.render();
      });
    }
  }

  private renderChatSettings(container: HTMLElement): void {
    void this.plugin.ensureEditableSystemPrompts().then((created) => {
      if (!created) {
        this.composerHelperMessage =
          "System prompt files could not be created under vault-ai-assistant/system-prompts.";
        this.composerHelperIsError = true;
        this.render();
      }
    });

    const panel = container.createDiv({ cls: "vault-ai-assistant-chat-settings" });
    panel.createDiv({ cls: "vault-ai-assistant-chat-settings-title", text: "System prompt" });

    const row = panel.createDiv({ cls: "vault-ai-assistant-chat-settings-row" });
    const label = row.createEl("label", { text: "System prompt" });
    const select = row.createEl("select");
    const currentPresetId = normalizeSystemPromptPresetId(
      this.plugin.settings.systemPromptPresetId
    );
    select.setAttr("aria-label", "System prompt");

    for (const preset of SYSTEM_PROMPT_PRESETS) {
      const option = select.createEl("option", { text: preset.label });
      option.value = preset.id;
    }

    select.value = currentPresetId;
    label.appendChild(select);
    select.addEventListener("change", () => {
      this.plugin.settings.systemPromptPresetId = normalizeSystemPromptPresetId(select.value);
      void this.plugin.saveSettings().then(() => this.render());
    });
  }

  private renderChatHistory(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "vault-ai-assistant-chat-history" });
    panel.createDiv({ cls: "vault-ai-assistant-chat-history-title", text: "Chat history" });
    const list = panel.createDiv({ cls: "vault-ai-assistant-chat-history-list" });
    list.createDiv({ cls: "vault-ai-assistant-message-meta", text: "Loading saved chats..." });

    void this.plugin.chatStore.listSavedConversations().then((conversations) => {
      list.empty();
      if (conversations.length === 0) {
        list.createDiv({ cls: "vault-ai-assistant-chat-history-title", text: "No saved chats" });
        list.createDiv({
          cls: "vault-ai-assistant-message-meta",
          text: "Saved conversations will appear here after a response is autosaved."
        });
        return;
      }

      for (const conversation of conversations) {
        const formattedDate = this.formatHistoryDate(conversation.updatedAt);
        const row = list.createEl("button", {
          cls: "vault-ai-assistant-chat-history-row"
        });
        row.type = "button";
        row.title = `${conversation.title} · ${formattedDate}`;
        row.createDiv({
          cls: "vault-ai-assistant-chat-history-title",
          text: conversation.title
        });
        row.createDiv({
          cls: "vault-ai-assistant-chat-history-date",
          text: formattedDate
        });
        row.addEventListener("click", () => {
          void this.openSavedConversation(conversation.filePath);
        });
      }
    });
  }

  private async openSavedConversation(filePath: string): Promise<void> {
    this.stopSpokenPlayback();
    const conversation = await this.plugin.chatStore.openConversation(filePath);
    if (!conversation) {
      return;
    }

    this.clearConversationDraftState();
    this.chatHistoryOpen = false;
    this.render();
  }

  private formatHistoryDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  private autosizeComposerInput(input: HTMLTextAreaElement): void {
    input.setCssProps({ height: "auto" });
    input.setCssProps({ height: `${Math.min(Math.max(input.scrollHeight, 76), 180)}px` });
  }

  private canSendMessage(value = this.composerValue): boolean {
    return value.trim().length > 0 && this.activeAbortController === null;
  }

  private getActiveFileContextOptions() {
    const enabled = this.plugin.settings.autoAttachActiveFileContext;
    return {
      includeActiveFile: enabled,
      includeActiveFileDirectory: enabled
    };
  }

  private getVoiceInputState() {
    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    const supportsVoice = modelSupportsVoice(providerConfig.provider, providerConfig.model);
    const hasProviderKey = hasAvailableProviderKey(
      this.app,
      this.plugin.settings,
      providerConfig.provider
    );
    const mediaAvailable =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";

    if (!supportsVoice) {
      return {
        available: false,
        active: this.voiceIsRecording,
        busy: this.voiceIsTranscribing,
        disabledReason: "Selected model does not support voice input"
      };
    }

    if (!hasProviderKey) {
      return {
        available: false,
        active: this.voiceIsRecording,
        busy: this.voiceIsTranscribing,
        disabledReason: `${providerConfig.label} API key required for voice input`
      };
    }

    if (!mediaAvailable) {
      return {
        available: false,
        active: this.voiceIsRecording,
        busy: this.voiceIsTranscribing,
        disabledReason: "Voice input unavailable in this Obsidian environment"
      };
    }

    return {
      available: true,
      active: this.voiceIsRecording,
      busy: this.voiceIsTranscribing,
      disabledReason: ""
    };
  }

  private async toggleVoiceInput(): Promise<void> {
    if (this.voiceIsRecording) {
      this.stopVoiceRecording();
      return;
    }

    await this.startVoiceRecording();
  }

  private async getVoiceMediaStream(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: VOICE_RECORDER_AUDIO_CONSTRAINTS
      });
    } catch (error) {
      if (!this.isMicrophoneConstraintError(error)) {
        throw error;
      }

      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }

  private getVoiceRecorderOptions(): MediaRecorderOptions | undefined {
    if (
      typeof MediaRecorder === "undefined" ||
      typeof MediaRecorder.isTypeSupported !== "function"
    ) {
      return undefined;
    }

    for (const mimeType of VOICE_RECORDER_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return { mimeType };
      }
    }

    return undefined;
  }

  private async startVoiceRecording(): Promise<void> {
    if (this.activeAbortController || this.voiceIsTranscribing) {
      return;
    }

    const voiceInput = this.getVoiceInputState();
    if (!voiceInput.available) {
      this.composerHelperMessage = voiceInput.disabledReason;
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    try {
      const stream = await this.getVoiceMediaStream();
      this.voiceRecordingStream = stream;
      const recorderOptions = this.getVoiceRecorderOptions();
      const recorder = new MediaRecorder(stream, recorderOptions);
      this.voiceRecorder = recorder;
      this.voiceChunks = [];
      this.voiceShouldTranscribeOnStop = true;
      recorder.addEventListener("dataavailable", (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.voiceChunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        const chunks = this.voiceChunks;
        const mediaType =
          chunks[0]?.type || recorder.mimeType || recorderOptions?.mimeType || "audio/webm";
        const audioBlob = new Blob(chunks, { type: mediaType });
        const shouldTranscribe = this.voiceShouldTranscribeOnStop;
        this.voiceRecorder = null;
        this.voiceChunks = [];
        this.voiceIsRecording = false;
        this.voiceShouldTranscribeOnStop = true;
        this.stopVoiceStream();
        if (shouldTranscribe) {
          void this.transcribeVoiceRecording(audioBlob);
        }
      });
      recorder.start(VOICE_RECORDER_TIMESLICE_MS);
      this.voiceIsRecording = true;
      this.composerHelperMessage = "Recording voice...";
      this.composerHelperIsError = false;
      this.render();
    } catch (error) {
      this.voiceRecorder = null;
      this.voiceChunks = [];
      this.voiceIsRecording = false;
      this.stopVoiceStream();
      this.composerHelperMessage = this.isMicrophonePermissionError(error)
        ? "Microphone permission was denied."
        : "Voice recording failed. Try again or type your message.";
      this.composerHelperIsError = true;
      this.render();
    }
  }

  private stopVoiceRecording(transcribe = true): void {
    const recorder = this.voiceRecorder;
    if (!recorder) {
      return;
    }

    if (!transcribe) {
      this.voiceShouldTranscribeOnStop = false;
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      return;
    }

    if (recorder.state === "inactive") {
      return;
    }

    this.flushVoiceRecorder(recorder);
    recorder.stop();
  }

  private flushVoiceRecorder(recorder: MediaRecorder): void {
    try {
      recorder.requestData();
    } catch {
      // Some browser implementations throw if the recorder is already stopping.
    }
  }

  private async transcribeVoiceRecording(audioBlob: Blob): Promise<void> {
    if (audioBlob.size === 0) {
      this.composerHelperMessage = "Voice recording did not capture audio. Try again.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    if (!modelSupportsVoice(providerConfig.provider, providerConfig.model)) {
      this.composerHelperMessage = "Selected model does not support voice input";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    const apiKey = this.app.secretStorage.getSecret(providerConfig.secretName);
    if (!apiKey) {
      this.composerHelperMessage = `${providerConfig.label} API key required for voice input`;
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    this.voiceIsTranscribing = true;
    this.composerHelperMessage = "Transcribing voice...";
    this.composerHelperIsError = false;
    this.render();

    try {
      const mediaType = audioBlob.type || "audio/webm";
      const result = await transcribeEnglishAudio({
        apiKey,
        audioData: await audioBlob.arrayBuffer(),
        mediaType,
        fileName: getVoiceAudioFileName(mediaType)
      });
      this.composerValue = mergeVoiceTranscriptDraft(this.composerValue, result.text);
      this.composerHelperMessage = "Voice transcript added to composer. Review before sending.";
      this.composerHelperIsError = false;
    } catch (error) {
      this.composerHelperMessage =
        isVoiceModeError(error) && error.code === "missing_openai_key"
          ? `${providerConfig.label} API key required for voice input`
          : "Voice transcription failed. Try again or type your message.";
      this.composerHelperIsError = true;
    } finally {
      this.voiceIsTranscribing = false;
      this.render();
    }
  }

  private stopVoiceStream(): void {
    for (const track of this.voiceRecordingStream?.getTracks() ?? []) {
      track.stop();
    }
    this.voiceRecordingStream = null;
  }

  private isMicrophonePermissionError(error: unknown): boolean {
    return (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
    );
  }

  private isMicrophoneConstraintError(error: unknown): boolean {
    return (
      error instanceof DOMException &&
      (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError")
    );
  }

  private async sendMessage(content: string): Promise<void> {
    const userMessage = content.trim();
    if (!userMessage || this.activeAbortController) {
      return;
    }

    const providerConfig = getActiveProviderConfig(this.plugin.settings);
    if (
      this.getAvailableImageAttachments().length > 0 &&
      !modelSupportsImages(providerConfig.provider, providerConfig.model)
    ) {
      this.composerHelperMessage = "Choose an image-capable model to send images.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    const apiKey = this.app.secretStorage.getSecret(providerConfig.secretName);
    if (!apiKey) {
      this.composerHelperMessage = `${providerConfig.label} API key is missing or unavailable. Reconnect it in plugin settings.`;
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    let persistedImages: ChatImageAttachment[];
    let imageAttachments: ChatRequestImageAttachment[];
    let context;
    let contextSnapshot: ContextSnapshot;
    let operationTargets: OperationTargetScope;
    let operationTargetSnapshot;
    let systemPrompt: string;
    const activeFileContextOptions = this.getActiveFileContextOptions();
    try {
      persistedImages = await this.persistDraftImageAttachments();
      imageAttachments = await this.createRequestImageAttachments(persistedImages);
      context = await this.plugin.contextManager.buildContextPackage(activeFileContextOptions);
      contextSnapshot = createContextSnapshot(context);
      operationTargets = this.plugin.contextManager.getOperationTargetScope(
        activeFileContextOptions
      );
      operationTargetSnapshot = createOperationTargetSnapshot(operationTargets);
    } catch (error) {
      this.composerHelperMessage = this.formatUnexpectedRequestError(error);
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    try {
      systemPrompt = await readSelectedSystemPrompt(
        this.app.vault,
        this.plugin.settings.systemPromptPresetId
      );
    } catch {
      this.composerHelperMessage =
        "System prompt could not be loaded - check vault-ai-assistant/system-prompts and try again.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    const activeConversation = this.plugin.chatStore.getState().activeConversation;
    const previousMessages = this.plugin.chatStore.getState().activeConversation.messages;
    const isFirstConversationMessage = previousMessages.length === 0;
    const conversationId = activeConversation.id;
    const messageAttachments: ChatAttachment[] = [
      ...this.plugin.contextManager.getRestorableAttachments(activeFileContextOptions),
      ...persistedImages
    ];
    const chatUserMessage = this.stripMessageAttachmentTokens(userMessage, messageAttachments);
    const requestUserMessage =
      chatUserMessage ||
      (imageAttachments.length > 0 ? "Please analyze the attached image." : userMessage);
    this.plugin.chatStore.appendUserMessage(chatUserMessage, messageAttachments);
    if (isFirstConversationMessage) {
      void this.generateTitleForFirstMessage(
        conversationId,
        requestUserMessage,
        providerConfig.provider,
        providerConfig.model,
        apiKey
      );
    }
    this.composerValue = "";
    this.composerHelperMessage = "";
    this.composerHelperIsError = false;
    this.imageAttachments = [];

    const assistant = this.plugin.chatStore.startAssistantMessage(
      providerConfig.provider,
      providerConfig.model,
      contextSnapshot,
      operationTargetSnapshot
    );
    const abortController = new AbortController();
    this.activeAssistantMessageId = assistant.id;
    this.activeAbortController = abortController;
    let textFallbackFinalized = false;
    const textStreamFilter = new TextOrchestratorOperationStreamFilter();
    this.render();

    const adapter =
      providerConfig.provider === "openai"
        ? new OpenAIChatAdapter(obsidianRequestFetch)
        : new AnthropicChatAdapter(obsidianRequestFetch);

    try {
      for await (const event of adapter.stream(
        {
          provider: providerConfig.provider,
          model: providerConfig.model,
          apiKey,
          messages: previousMessages,
          userMessage: requestUserMessage,
          context,
          contextSnapshot,
          operationTargets,
          operationTargetSnapshot,
          systemPrompt,
          enableVaultOperations: shouldEnableVaultOperationsForRequest({
            message: requestUserMessage,
            previousMessages,
            contextFileCount: context.files.length,
            targetCount: operationTargets.sources.length
          }),
          maxOutputTokens: this.plugin.settings.maxOutputTokens,
          imageAttachments
        },
        abortController.signal
      )) {
        const chatEvent: ChatEvent = event;
        if (chatEvent.type === "delta") {
          const visibleText = textStreamFilter.append(chatEvent.text);
          if (visibleText) {
            this.plugin.chatStore.appendAssistantDelta(assistant.id, visibleText);
          }
        } else if (chatEvent.type === "proposal") {
          const proposal = await this.plugin.operationExecutor.prepareProposalForReview(chatEvent.proposal);
          this.plugin.chatStore.appendAssistantProposal(assistant.id, proposal);
        } else if (chatEvent.type === "done") {
          const visibleText = textStreamFilter.flushVisibleText();
          if (visibleText) {
            this.plugin.chatStore.appendAssistantDelta(assistant.id, visibleText);
          }
          if (!textFallbackFinalized) {
            textFallbackFinalized = true;
            await this.finalizeTextOrchestratorOperationFallback(
              assistant.id,
              context.files,
              operationTargets,
              textStreamFilter.getQuarantinedText()
            );
          }
          await this.plugin.chatStore.completeAssistantMessage(assistant.id, chatEvent.usage);
        } else if (chatEvent.type === "error") {
          const visibleText = textStreamFilter.flushVisibleText();
          if (visibleText) {
            this.plugin.chatStore.appendAssistantDelta(assistant.id, visibleText);
          }
          await this.plugin.chatStore.failAssistantMessage(assistant.id, chatEvent.message);
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const visibleText = textStreamFilter.flushVisibleText();
        if (visibleText) {
          this.plugin.chatStore.appendAssistantDelta(assistant.id, visibleText);
        }
        await this.plugin.chatStore.failAssistantMessage(
          assistant.id,
          this.formatUnexpectedRequestError(error)
        );
      }
    } finally {
      this.activeAbortController = null;
      this.activeAssistantMessageId = null;
      this.render();
    }
  }

  private async finalizeTextOrchestratorOperationFallback(
    messageId: string,
    contextFiles: ContextPackageFile[],
    operationTargets: OperationTargetScope,
    quarantinedText = ""
  ): Promise<void> {
    const message = this.plugin.chatStore
      .getState()
      .activeConversation.messages.find((candidate) => candidate.id === messageId);
    if (!message) {
      return;
    }

    const extractionInput = [message.content, quarantinedText].filter(Boolean).join("\n");
    if (!extractionInput) {
      return;
    }

    const existingProposalCount = message.proposals?.length ?? 0;
    const extraction = extractTextOrchestratorOperationPayloads(extractionInput);
    if (
      extraction.payloads.length === 0 &&
      extraction.text === message.content &&
      !extraction.matchedOperationText
    ) {
      return;
    }

    if (extraction.text !== message.content) {
      this.plugin.chatStore.replaceAssistantContent(messageId, extraction.text);
    }

    let appendedProposalCount = 0;
    let invalidPayloadFailed = false;
    for (const payload of extraction.payloads) {
      const hydrated = hydrateTextOrchestratorOperationPayload(payload, contextFiles);
      const result = handleOrchestratorOperationPayload(hydrated, {
        readableContextPaths: contextFiles.map((file) => file.path),
        contextFiles,
        operationTargets
      });
      if (!result.ok) {
        invalidPayloadFailed = true;
        await this.plugin.chatStore.failAssistantMessage(
          messageId,
          formatInvalidOrchestratorOperationMessage(result.errors)
        );
        continue;
      }

      const proposal = await this.plugin.operationExecutor.prepareProposalForReview(result.proposal);
      this.plugin.chatStore.appendAssistantProposal(messageId, proposal);
      appendedProposalCount += 1;
    }

    const latestMessage = this.plugin.chatStore
      .getState()
      .activeConversation.messages.find((candidate) => candidate.id === messageId);
    if (
      extraction.strippedOperationText &&
      appendedProposalCount === 0 &&
      existingProposalCount === 0 &&
      !invalidPayloadFailed &&
      latestMessage?.status !== "error"
    ) {
      await this.plugin.chatStore.failAssistantMessage(
        messageId,
        INCOMPLETE_ORCHESTRATOR_OPERATION_RECOVERY_MESSAGE
      );
    }
  }

  private async generateTitleForFirstMessage(
    conversationId: string,
    firstMessage: string,
    provider: ProviderId,
    model: string,
    apiKey: string
  ): Promise<void> {
    let title: string;
    try {
      title = await generateChatTitleFromFirstMessage({
        provider,
        model,
        apiKey,
        firstMessage,
        fetchImpl: obsidianRequestFetch
      });
    } catch {
      title = createFallbackChatTitle(firstMessage);
    }

    await this.plugin.chatStore.updateConversationTitle(conversationId, title);
  }

  private async attachExternalImageFiles(files: File[]): Promise<void> {
    const conversationId = this.plugin.chatStore.getState().activeConversation.id;
    const attachments: ChatImageAttachment[] = [];

    try {
      for (const file of files) {
        const mediaType = getImageMediaType(file.name) ?? getImageMediaTypeFromMime(file.type);
        if (!mediaType) {
          continue;
        }

        const label = this.createExternalImageLabel(file, mediaType);
        const attachment = createDraftImageAttachment({
          label,
          mediaType,
          size: file.size
        });
        attachments.push(
          await persistImageAttachment(
            this.app.vault,
            conversationId,
            attachment,
            await file.arrayBuffer()
          )
        );
      }
    } catch (error) {
      this.composerHelperMessage = this.formatUnexpectedRequestError(error);
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    if (attachments.length === 0) {
      this.composerHelperMessage = "Only PNG, JPEG, WEBP, or GIF images can be attached.";
      this.composerHelperIsError = true;
      this.render();
      return;
    }

    this.imageAttachments = this.imageAttachments.concat(attachments);
    this.composerHelperMessage = "";
    this.composerHelperIsError = false;
    this.render();
  }

  private createExternalImageLabel(file: File, mediaType: string): string {
    if (file.name.trim() && isSupportedImagePath(file.name)) {
      return file.name.trim();
    }

    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `Pasted image ${timestamp}.${getDefaultImageExtension(mediaType)}`;
  }

  private getAvailableImageAttachments(): ChatImageAttachment[] {
    return this.imageAttachments.filter((attachment) => attachment.status !== "missing");
  }

  private async persistDraftImageAttachments(): Promise<ChatImageAttachment[]> {
    const conversationId = this.plugin.chatStore.getState().activeConversation.id;
    const persisted: ChatImageAttachment[] = [];

    for (const attachment of this.imageAttachments) {
      if (attachment.status === "missing") {
        persisted.push(attachment);
        continue;
      }

      if (attachment.status === "persisted") {
        persisted.push(attachment);
        continue;
      }

      const sourcePath = attachment.originalPath;
      const sourceFile = sourcePath ? this.app.vault.getFileByPath(sourcePath) : null;
      if (!sourceFile) {
        persisted.push({ ...attachment, status: "missing" });
        continue;
      }

      const data = await this.app.vault.readBinary(sourceFile);
      persisted.push(
        await persistImageAttachment(this.app.vault, conversationId, attachment, data)
      );
    }

    return persisted;
  }

  private async createRequestImageAttachments(
    attachments: ChatImageAttachment[]
  ): Promise<ChatRequestImageAttachment[]> {
    const requestAttachments: ChatRequestImageAttachment[] = [];

    for (const attachment of attachments) {
      if (attachment.status !== "persisted" || !attachment.persistedPath) {
        continue;
      }

      const data = await readPersistedImageAttachmentData(this.app.vault, attachment);
      if (!data) {
        continue;
      }

      requestAttachments.push({
        ...attachment,
        status: "persisted",
        dataBase64: this.arrayBufferToBase64(data)
      });
    }

    return requestAttachments;
  }

  private arrayBufferToBase64(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }

    return btoa(binary);
  }

  private formatUnexpectedRequestError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      if (error.name === "AbortError") {
        return "Request stopped.";
      }

      const message = error.message.trim();
      if (
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("Load failed") ||
        message.includes("requestUrl")
      ) {
        return "Request failed - check your network connection and provider status.";
      }

      return `Request failed: ${this.sanitizeErrorMessage(message)}`;
    }

    return "Request failed - check your provider settings and try again.";
  }

  private sanitizeErrorMessage(message: string): string {
    return message
      .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]")
      .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, "[redacted]")
      .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
      .replace(/\bx-api-key\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/gi, "x-api-key [redacted]");
  }

  private async stopResponse(): Promise<void> {
    if (!this.activeAbortController || !this.activeAssistantMessageId) {
      return;
    }

    const messageId = this.activeAssistantMessageId;
    this.activeAbortController.abort();
    await this.plugin.chatStore.stopAssistantMessage(messageId);
    this.activeAbortController = null;
    this.activeAssistantMessageId = null;
    this.render();
  }

  private renderComposerContext(container: HTMLElement, onTriggerContextMenu: () => void): void {
    const context = container.createDiv({
      cls: "vault-ai-assistant-composer-context vault-ai-assistant-attachment-bar"
    });
    const scopeModes = context.createDiv({ cls: "vault-ai-assistant-scope-mode" });
    const contextTrigger = scopeModes.createEl("button", {
      cls: "vault-ai-assistant-context-trigger vault-ai-assistant-scope-mode-button vault-ai-assistant-scope-mode-context"
    });
    contextTrigger.type = "button";
    contextTrigger.setAttr("aria-label", "Add readable context");
    contextTrigger.setAttr("aria-pressed", this.composerScopeMode === "context" ? "true" : "false");
    const contextIcon = contextTrigger.createSpan({ cls: "vault-ai-assistant-scope-mode-icon" });
    setIcon(contextIcon, "book-open");
    contextTrigger.createSpan({ text: "Context" });
    contextTrigger.addEventListener("click", () => {
      this.composerScopeMode = "context";
      onTriggerContextMenu();
    });

    const targetTrigger = scopeModes.createEl("button", {
      cls: "vault-ai-assistant-context-trigger vault-ai-assistant-scope-mode-button vault-ai-assistant-scope-mode-scope"
    });
    targetTrigger.type = "button";
    targetTrigger.setAttr("aria-label", "Set edit target");
    targetTrigger.setAttr("aria-pressed", this.composerScopeMode === "target" ? "true" : "false");
    const targetIcon = targetTrigger.createSpan({ cls: "vault-ai-assistant-scope-mode-icon" });
    setIcon(targetIcon, "shield-check");
    targetTrigger.createSpan({ text: "Target" });
    targetTrigger.addEventListener("click", () => {
      this.composerScopeMode = "target";
      onTriggerContextMenu();
    });
    this.renderContextChips(context);
    this.renderImageAttachmentChips(context);
  }

  private renderContextChips(container: HTMLElement): void {
    const sources = this.plugin.contextManager.getSources();
    const targetSources = this.plugin.contextManager.getTargetSources();
    const chips = container.createDiv({ cls: "vault-ai-assistant-context-chips" });

    for (const source of sources) {
      this.renderContextChip(chips, source);
    }
    if (targetSources.length === 0) {
      this.renderDefaultTargetChip(chips);
    } else {
      for (const target of targetSources) {
        this.renderTargetChip(chips, target);
      }
    }
  }

  private renderContextChip(container: HTMLElement, source: ContextSource): void {
    const chip = container.createDiv({
      cls: "vault-ai-assistant-context-chip vault-ai-assistant-context-read-chip"
    });
    const body = chip.createDiv({ cls: "vault-ai-assistant-context-chip-summary" });
    chip.title = `${source.path} · ${this.formatContextFileCount(source.files.length)}`;

    const iconShell = body.createSpan({ cls: "vault-ai-assistant-context-chip-icon-shell" });
    const icon = iconShell.createSpan({ cls: "vault-ai-assistant-context-chip-icon" });
    setIcon(icon, source.type === "folder" ? "folder" : "file-text");
    if (!source.automatic) {
      const remove = iconShell.createEl("button", {
        cls: "vault-ai-assistant-context-chip-remove"
      });
      remove.type = "button";
      setIcon(remove, "x");
      remove.setAttr("aria-label", `Remove ${source.path} from context`);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.plugin.contextManager.removeSource(source.id);
      });
    }
    body.createSpan({
      cls: "vault-ai-assistant-context-path",
      text: this.getSourceDisplayName(source)
    });
    body.createSpan({
      cls: "vault-ai-assistant-context-meta",
      text: `Context · sends content · ${this.getSourceBadgeLabel(source)}`
    });
  }

  private renderDefaultTargetChip(container: HTMLElement): void {
    const chip = container.createDiv({
      cls: "vault-ai-assistant-context-chip vault-ai-assistant-scope-chip vault-ai-assistant-default-scope-chip"
    });
    const body = chip.createDiv({ cls: "vault-ai-assistant-context-chip-summary" });
    const iconShell = body.createSpan({ cls: "vault-ai-assistant-context-chip-icon-shell" });
    const icon = iconShell.createSpan({ cls: "vault-ai-assistant-context-chip-icon" });
    setIcon(icon, "shield-check");
    body.createSpan({
      cls: "vault-ai-assistant-context-path",
      text: "Target /"
    });
    body.createSpan({
      cls: "vault-ai-assistant-context-meta",
      text: "Edit target hint"
    });
  }

  private renderTargetChip(
    container: HTMLElement,
    target: OperationTargetSource
  ): void {
    const chip = container.createDiv({
      cls: "vault-ai-assistant-context-chip vault-ai-assistant-scope-chip"
    });
    chip.title = `${target.path} · Edit target hint`;
    const body = chip.createDiv({ cls: "vault-ai-assistant-context-chip-summary" });
    const iconShell = body.createSpan({ cls: "vault-ai-assistant-context-chip-icon-shell" });
    const icon = iconShell.createSpan({ cls: "vault-ai-assistant-context-chip-icon" });
    setIcon(icon, target.type === "folder" ? "folder-key" : "file-lock");
    if (!target.automatic) {
      const remove = iconShell.createEl("button", {
        cls: "vault-ai-assistant-context-chip-remove"
      });
      remove.type = "button";
      setIcon(remove, "x");
      remove.setAttr("aria-label", `Remove ${target.path} from edit targets`);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.plugin.contextManager.removeTargetSource(target.id);
      });
    }
    body.createSpan({
      cls: "vault-ai-assistant-context-path",
      text: target.path === "/" ? "Target /" : target.path
    });
    body.createSpan({
      cls: "vault-ai-assistant-context-meta",
      text: "Target · path hint only"
    });
  }

  private renderImageAttachmentChips(container: HTMLElement): void {
    const chips = container.querySelector<HTMLElement>(".vault-ai-assistant-context-chips");
    if (!chips) {
      return;
    }

    for (const attachment of this.imageAttachments) {
      const isMissing = attachment.status === "missing";
      const chip = chips.createDiv({
        cls: `vault-ai-assistant-context-chip vault-ai-assistant-image-chip ${isMissing ? "vault-ai-assistant-missing-image-chip" : ""}`
      });
      if (isMissing) {
        chip.setAttr("aria-disabled", "true");
      }

      const body = chip.createDiv({ cls: "vault-ai-assistant-context-chip-summary" });
      const iconShell = body.createSpan({ cls: "vault-ai-assistant-context-chip-icon-shell" });
      const icon = iconShell.createSpan({ cls: "vault-ai-assistant-context-chip-icon" });
      setIcon(icon, isMissing ? "image-off" : "image");
      if (!isMissing) {
        const remove = iconShell.createEl("button", {
          cls: "vault-ai-assistant-context-chip-remove"
        });
        remove.type = "button";
        setIcon(remove, "x");
        remove.setAttr("aria-label", `Remove ${attachment.label} from attachments`);
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.imageAttachments = this.imageAttachments.filter(
            (candidate) => candidate.id !== attachment.id
          );
          this.render();
        });
      }
      body.createSpan({
        cls: "vault-ai-assistant-context-path",
        text: isMissing ? `${attachment.label} · Missing image` : attachment.label
      });
    }
  }

  private renderContextActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "vault-ai-assistant-context-actions" });

    const currentNoteButton = actions.createEl("button", { text: "Add current note" });
    currentNoteButton.type = "button";
    currentNoteButton.addEventListener("click", () => {
      this.plugin.contextManager.addCurrentNote();
    });

    const notesButton = actions.createEl("button", { text: "Add notes" });
    notesButton.type = "button";
    notesButton.addEventListener("click", () => {
      openMarkdownNotesPicker(this.app, (files) => {
        this.plugin.contextManager.addFiles(files, "note");
      }, {
        currentSources: this.plugin.contextManager.getSources(),
        onChooseFolder: (folder) => {
          this.plugin.contextManager.addFolder(folder);
        },
        onRemoveContext: (sourceId) => {
          this.plugin.contextManager.removeSource(sourceId);
        }
      });
    });

    const folderButton = actions.createEl("button", { text: "Add folder" });
    folderButton.type = "button";
    folderButton.addEventListener("click", () => {
      openFolderPicker(this.app, (folder) => {
        this.plugin.contextManager.addFolder(folder);
      });
    });

    const targetNoteButton = actions.createEl("button", { text: "Set edit target note" });
    targetNoteButton.type = "button";
    targetNoteButton.addEventListener("click", () => {
      openMarkdownNotesPicker(this.app, (files) => {
        for (const file of files) {
          this.plugin.contextManager.addTargetFile(file);
        }
      }, { mode: "target" });
    });

    const targetFolderButton = actions.createEl("button", { text: "Set edit target folder" });
    targetFolderButton.type = "button";
    targetFolderButton.addEventListener("click", () => {
      openFolderPicker(this.app, (folder) => {
        this.plugin.contextManager.addTargetFolder(folder);
      }, { mode: "target" });
    });
  }

  private registerOutsidePointerDismiss(
    targets: HTMLElement[],
    onDismiss: () => void
  ): void {
    const handler = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (targets.some((element) => element.contains(target))) {
        return;
      }

      onDismiss();
    };

    document.addEventListener("pointerdown", handler, true);
    this.outsidePointerDisposers.push(() => {
      document.removeEventListener("pointerdown", handler, true);
    });
  }

  private clearOutsidePointerDisposers(): void {
    for (const dispose of this.outsidePointerDisposers) {
      dispose();
    }
    this.outsidePointerDisposers = [];
  }

  private removeBraceToken(value: string, label: string): string {
    return value
      .split(`{${label}}`)
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/^[ \t]+/, "");
  }

  private stripMessageAttachmentTokens(content: string, attachments: ChatAttachment[]): string {
    let nextValue = content;
    for (const attachment of attachments) {
      if (attachment.kind !== "markdown") {
        continue;
      }

      const labels = new Set([
        attachment.label,
        attachment.path,
        attachment.path.replace(/\.md$/i, ""),
        attachment.path.split("/").pop()?.replace(/\.md$/i, "")
      ]);
      for (const label of labels) {
        if (!label) {
          continue;
        }

        nextValue = this.removeBraceToken(nextValue, label);
      }
    }

    return nextValue
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private openComposerContextPicker(): void {
    openMarkdownNotesPicker(this.app, (files) => {
      this.plugin.contextManager.addFiles(files, "note");
      this.render();
    }, {
      currentSources: this.plugin.contextManager.getSources(),
      onChooseFolder: (folder) => {
        this.plugin.contextManager.addFolder(folder);
        this.render();
      },
      onRemoveContext: (sourceId) => {
        this.plugin.contextManager.removeSource(sourceId);
        this.render();
      }
    });
  }

  private openComposerScopePicker(): void {
    openFolderPicker(this.app, (folder) => {
      this.plugin.contextManager.addTargetFolder(folder);
      this.render();
    }, { mode: "target" });
  }

  private renderContextTray(container: HTMLElement): void {
    const tray = container.createDiv({ cls: "vault-ai-assistant-context-tray" });
    const activeFileContextOptions = this.getActiveFileContextOptions();
    const sources = this.plugin.contextManager.getSources(activeFileContextOptions);
    const targets = this.plugin.contextManager.getTargetSources(activeFileContextOptions);

    tray.createEl("h3", { text: "Context sent" });
    if (sources.length === 0) {
      const emptyState = tray.createDiv({ cls: "vault-ai-assistant-context-empty" });
      emptyState.createEl("h3", { text: "No context added" });
      emptyState.createEl("p", {
        text: "Attach notes or folders to control what the assistant can use."
      });
    } else {
      for (const source of sources) {
        this.renderContextSource(tray, source);
      }
    }

    const summary = this.plugin.contextManager.getSummary(activeFileContextOptions);
    tray.createDiv({
      cls: "vault-ai-assistant-context-meta",
      text: this.formatContextFileCount(summary.fileCount)
    });
    this.renderContextWarnings(tray);
    tray.createDiv({
      cls: "vault-ai-assistant-context-footer",
      text: "Only shown markdown files will be included."
    });

    tray.createEl("h3", { text: "Edit targets" });
    if (targets.length === 0) {
      tray.createDiv({
        cls: "vault-ai-assistant-context-meta",
        text: "Target /"
      });
    } else {
      for (const target of targets) {
        tray.createDiv({
          cls: "vault-ai-assistant-context-meta",
          text: `${target.type === "folder" ? "Folder" : "File"} · ${target.path}`
        });
      }
    }
    tray.createDiv({
      cls: "vault-ai-assistant-context-footer",
      text: "Edit target contents are not included as context."
    });
  }

  private renderContextWarnings(container: HTMLElement): void {
    const warnings = evaluateContextWarnings(
      this.plugin.contextManager.getIncludedFiles(this.getActiveFileContextOptions())
    );
    if (warnings.length === 0) {
      return;
    }

    const warningList = container.createDiv({
      cls: "vault-ai-assistant-context-warnings"
    });
    for (const warning of warnings) {
      const warningEl = warningList.createDiv({
        cls: "vault-ai-assistant-context-warning"
      });
      warningEl.createDiv({ text: warning.message });
      if (warning.path) {
        warningEl.createDiv({
          cls: "vault-ai-assistant-context-meta",
          text: warning.path
        });
      }
    }
  }

  private renderContextSource(container: HTMLElement, source: ContextSource): void {
    const row = container.createDiv({ cls: "vault-ai-assistant-context-row" });
    const rowMain = row.createDiv({ cls: "vault-ai-assistant-context-row-main" });
    const heading = rowMain.createDiv({ cls: "vault-ai-assistant-context-heading" });

    if (source.type === "folder") {
      const expand = heading.createEl("button", {
        cls: "vault-ai-assistant-context-expand",
        text: source.expanded ? "Collapse" : "Expand"
      });
      expand.type = "button";
      expand.addEventListener("click", () => {
        this.plugin.contextManager.toggleSourceExpanded(source.id);
      });
    }

    heading.createSpan({
      cls: "vault-ai-assistant-context-badge",
      text: this.getSourceLabel(source)
    });
    heading.createSpan({ cls: "vault-ai-assistant-context-path", text: source.path });

    rowMain.createDiv({
      cls: "vault-ai-assistant-context-meta",
      text: `${source.files.length} ${source.files.length === 1 ? "markdown file" : "markdown files"}`
    });

    if (!source.automatic) {
      const remove = row.createEl("button", {
        cls: "vault-ai-assistant-context-remove",
        text: "Remove"
      });
      remove.type = "button";
      remove.addEventListener("click", () => {
        this.plugin.contextManager.removeSource(source.id);
      });
    }

    if (source.type === "folder" && source.expanded) {
      const files = rowMain.createEl("ul", { cls: "vault-ai-assistant-folder-files" });
      for (const file of source.files) {
        files.createEl("li", { text: file.path });
      }
    }
  }

  private getProviderLabel(provider: ProviderId): string {
    return provider === "openai" ? "OpenAI" : "Anthropic";
  }

  private getModelLabel(provider: ProviderId, model: string): string {
    return MODEL_OPTIONS[provider].find((option) => option.value === model)?.label ?? model;
  }

  private formatContextFileCount(fileCount: number): string {
    return `${fileCount} ${fileCount === 1 ? "file" : "files"}`;
  }

  private getSourceLabel(source: ContextSource): string {
    if (source.type === "current-note") {
      return "Current note";
    }

    if (source.type === "folder") {
      return "Folder";
    }

    return "Note";
  }

  private getSourceBadgeLabel(source: ContextSource): string {
    if (source.type === "current-note") {
      return "Current";
    }

    if (source.type === "folder") {
      return `${source.files.length} files`;
    }

    return "Note";
  }

  private getSourceDisplayName(source: ContextSource): string {
    if (source.type === "folder") {
      return source.path || "/";
    }

    const file = source.files[0];
    return file?.basename ?? source.path.replace(/\.md$/i, "");
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }

  await navigator.clipboard.writeText(text);
}

function setIconActionLabel(button: HTMLButtonElement, label: string): void {
  button.dataset.tooltipLabel = label;
  button.querySelector(".vault-ai-assistant-sr-only")?.remove();
  button.createSpan({ cls: "vault-ai-assistant-sr-only", text: label });
}
