import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("assistant chat view keeps required Phase 3 copy", () => {
  const source = readComposerMigrationSources();

  for (const text of [
    "Send message",
    "Send",
    "Stop response",
    "New chat",
    "getActiveConversationDisplayTitle",
    "vault-ai-assistant-chat-title",
    "Context used",
    "MarkdownRenderer.render",
    "renderMessageContent",
    "renderAssistantMessageActions",
    "finalizeTextOrchestratorOperationFallback",
    "extractTextOrchestratorOperationPayloads",
    "hydrateTextOrchestratorOperationPayload",
    "writeTextToClipboard",
    "Copy response",
    "vault-ai-assistant-message-markdown",
    "vault-ai-assistant-message-copy",
    "markdown-rendered",
    "Only shown markdown files were included.",
    "Autosaved"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }
});

test("assistant chat view keeps required Phase 3.5 composer context contract", () => {
  const source = readComposerMigrationSources();
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "openComposerContextPicker",
    "openComposerScopePicker",
    "onAddContext",
    "onAddScope",
    "openMarkdownNotesPicker",
    "openFolderPicker",
    "No context attached",
    "renderComposerContext",
    "renderContextChips",
    "removeBraceToken",
    "registerOutsidePointerDismiss",
    "clearOutsidePointerDisposers",
    "outsidePointerDisposers",
    "document.addEventListener(\"pointerdown\"",
    "document.removeEventListener(\"pointerdown\""
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }
  assert.doesNotMatch(source, /getContextMentionSuggestions|renderComposerMentionSuggestions|insertContextMention/);
  assert.doesNotMatch(source, /@files|@folders|`@\$\{match\.category\}|`\{\$\{match\.label\}\}`/);

  for (const text of [
    ".vault-ai-assistant-composer-input-shell",
    ".vault-ai-assistant-composer-context",
    ".vault-ai-assistant-composer-divider",
    ".vault-ai-assistant-context-trigger",
    ".vault-ai-assistant-context-chip",
    ".vault-ai-assistant-context-chip-icon-shell",
    ".vault-ai-assistant-context-chip-remove",
    ".vault-ai-assistant-mention-suggestions",
    ".vault-ai-assistant-context-menu-row",
    "grid-template-columns: 24px minmax(0, 1fr) auto",
    "min-height: 44px",
    ".vault-ai-assistant-context-menu-label > div",
    "text-overflow: ellipsis",
    "white-space: nowrap"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /type: "image-attach"/);
  assert.doesNotMatch(source, /Image Attach/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /Manage context/);
  assert.doesNotMatch(source, /Web Tabs/);
});

test("assistant chat view keeps required Phase 3.5 chat action contract", () => {
  const source = readComposerMigrationSources();
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "canSendMessage",
    "renderComposerInputHighlight",
    "renderMessageAttachments",
    "stripMessageAttachmentTokens",
    "vault-ai-assistant-message-attachments",
    "vault-ai-assistant-message-attachment-scope",
    "userMessage: requestUserMessage",
    "document.createTextNode",
    "setIcon(action, \"message-square-plus\")",
    "setIcon(history, \"history\")",
    "setIcon(settings, \"settings\")",
    "vault-ai-assistant-toolbar-nav",
    "vault-ai-assistant-toolbar-popover",
    "vault-ai-assistant-toolbar-popover-history",
    "vault-ai-assistant-toolbar-popover-settings",
    "generateTitleForFirstMessage",
    "generateChatTitleFromFirstMessage",
    "createFallbackChatTitle",
    "updateConversationTitle",
    "this.chatHistoryOpen = false",
    "this.chatSettingsOpen = false",
    "vault-ai-assistant-chat-settings-toggle",
    "vault-ai-assistant-image-attach-action",
    "vault-ai-assistant-image-attach-action",
    "aria-pressed",
    "Send message",
    "Stop response\" : \"Send",
    "Stop response",
    "Context used",
    "formatTokenUsageForDisplay",
    "captureMessageScroll",
    "restoreMessageScroll",
    "shouldStickToBottom",
    "requestAnimationFrame",
    "Only shown markdown files were included.",
    " · ",
    "Stopped"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    ".vault-ai-assistant-message-meta",
    ".vault-ai-assistant-message-error",
    ".vault-ai-assistant-header-text",
    ".vault-ai-assistant-chat-title",
    "text-overflow: ellipsis",
    ".vault-ai-assistant-message-actions",
    ".vault-ai-assistant-message-copy",
    "justify-content: flex-end",
    "user-select: text",
    ".vault-ai-assistant-icon-action",
    ".vault-ai-assistant-icon-action::after",
    "content: attr(data-tooltip-label)",
    ".vault-ai-assistant-sr-only",
    ".vault-ai-assistant-composer-input-stack",
    "height: 1px",
    ".vault-ai-assistant-composer-input-highlight",
    ".vault-ai-assistant-message-attachments",
    ".vault-ai-assistant-message-attachment",
    ".vault-ai-assistant-message-attachment-label",
    ".vault-ai-assistant-message-attachment-meta",
    ".vault-ai-assistant-token-usage",
    "color: var(--text-faint)",
    "background: transparent",
    "font-variant-numeric: tabular-nums",
    ".vault-ai-assistant-composer-input:focus",
    "color: transparent",
    "background-color: transparent !important",
    "outline: none",
    "color: var(--text-normal)",
    "background: var(--background-modifier-hover)",
    "font-family: inherit",
    ".vault-ai-assistant-toolbar-nav",
    ".vault-ai-assistant-toolbar-popover",
    "position: absolute",
    "bottom: calc(100% + 8px)",
    ".vault-ai-assistant-toolbar-popover-settings::before",
    "right: 8px",
    ".vault-ai-assistant-toolbar-popover-history::before",
    "right: 48px",
    "border-bottom: 1px solid var(--background-modifier-border)",
    "box-shadow: var(--shadow-s)",
    "width: min(440px, calc(100vw - 32px))",
    "min-width: min(360px, calc(100vw - 32px))",
    "max-height: min(400px, calc(100vh - 190px))",
    ".vault-ai-assistant-image-attach-action",
    "justify-content: flex-end",
    "min-width: 76px",
    "padding-inline: 14px"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /pendingNewChatConfirmation/);
  assert.doesNotMatch(source, /Start new chat/);
  assert.doesNotMatch(source, /Cancel/);
  assert.doesNotMatch(source, /renderChatSettings\(composer\)/);
  assert.doesNotMatch(source, /renderChatHistory\(composer\)/);
  assert.doesNotMatch(source, /renderNewChatAction\(header\)/);
  assert.doesNotMatch(source, /Type a message to send\./);
  assert.doesNotMatch(styles, /vault-ai-assistant-new-chat-confirm/);
  assert.doesNotMatch(styles, /content: attr\(aria-label\)/);
  assert.match(source, /setIconActionLabel\(history, "Chat history"\)/);
  assert.match(source, /setIconActionLabel\(settings, "Settings"\)/);
  assert.match(source, /setIconActionLabel\(copy, "Copy response"\)/);
});

test("assistant chat view keeps required Phase 8.5 model selector contract", () => {
  const source =
    readFileSync("src/assistant-view.ts", "utf8") +
    readFileSync("src/ui/components/composer-model-selector.tsx", "utf8") +
    readFileSync("src/ui/components/composer-actions.tsx", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "modelPickerOpen",
    "renderComposerModelSelector",
    "ComposerModelSelector",
    "createRoot",
    "reactRoots",
    "selectComposerModel",
    "vault-ai-assistant-composer-model-slot",
    "vault-ai-assistant-composer-send-slot",
    "vault-ai-assistant-model-selector",
    "Choose model. Current model:",
    "aria-haspopup",
    "aria-expanded",
    "ChevronsUpDown",
    "OpenAI",
    "Anthropic",
    "MODEL_OPTIONS[provider]",
    "hasAvailableProviderKey",
    "hasAnyAvailableProvider",
    "API key required. Add a key in plugin settings to use these models.",
    "vault-ai-assistant-model-provider-notice",
    "API key required",
    "vault-ai-assistant-model-option-selected",
    "aria-current",
    "this.chatHistoryOpen = false",
    "this.chatSettingsOpen = false",
    "this.registerOutsidePointerDismiss",
    "setSelectedModelForProvider",
    "await this.plugin.saveSettings()",
    "model.supportsImages",
    "vault-ai-assistant-model-vision-cue",
    "Eye",
    "Supports images",
    "selectedModelSupportsImages",
    "disabled={!selectedModelSupportsImages || isStreaming}",
    "Images unavailable for selected model",
    "Choose an image-capable model to send images.",
    "getActiveProviderConfig(this.plugin.settings)",
    "this.plugin.chatStore.getState().activeConversation.messages",
    "context,",
    "operationTargets,",
    "contextSnapshot,",
    "operationTargetSnapshot,",
    "message.provider",
    "message.model"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    ".vault-ai-shadcn-button",
    ".vault-ai-assistant-composer-model-slot",
    ".vault-ai-assistant-composer-send-slot",
    "justify-content: space-between",
    ".vault-ai-assistant-model-selector",
    "width: 100%",
    "flex: 1 1 0",
    ".vault-ai-assistant-model-picker",
    ".vault-ai-assistant-model-picker::before",
    "width: min(420px, calc(100vw - 48px))",
    "bottom: calc(100% + 8px)",
    "min-height: 50px",
    "align-items: start",
    "padding: 8px",
    "white-space: normal",
    ".vault-ai-assistant-model-option",
    ".vault-ai-assistant-model-provider-notice",
    ".vault-ai-assistant-model-option-selected",
    ".vault-ai-assistant-model-option-disabled",
    ".vault-ai-assistant-model-vision-cue",
    "color: var(--text-success)",
    ".vault-ai-assistant-image-attach-action:disabled",
    "opacity: 0.55",
    "cursor: not-allowed",
    "overflow-wrap: anywhere"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }
  assert.doesNotMatch(source, /vault-ai-assistant-model-option-detail/);
});

test("assistant chat view keeps required Phase 9 React composer contract", () => {
  const assistantSource = readFileSync("src/assistant-view.ts", "utf8");
  const composerSource = readFileSync("src/ui/components/composer.tsx", "utf8");
  const toolbarSource = readFileSync("src/ui/components/composer-toolbar.tsx", "utf8");
  const attachmentSource = readFileSync("src/ui/components/composer-attachment-bar.tsx", "utf8");
  const inputSource = readFileSync("src/ui/components/composer-input.tsx", "utf8");
  const actionsSource = readFileSync("src/ui/components/composer-actions.tsx", "utf8");
  const reactComposerSources = [
    composerSource,
    toolbarSource,
    attachmentSource,
    inputSource,
    actionsSource
  ].join("\n");

  for (const text of [
    "export function Composer",
    "ComposerToolbar",
    "ComposerAttachmentBar",
    "ComposerInput",
    "ComposerActions",
    "canSubmitMessage: (value) => this.canSendMessage(value)",
    "const localCanSend = canSubmitMessage(draft) && !isStreaming",
    "onValueChange",
    "onSubmit",
    "onStop",
    "onScopeModeChange",
    "onSelectModel",
    "onRemoveAllContext",
    "ContextSummaryChip",
    "CONTEXT_SUMMARY_THRESHOLD",
    "Remove all",
    "createElement(Composer,",
    "this.reactRoots.push(root)",
    "registerOutsidePointerDismiss",
    "buildContextPackage",
    "getOperationTargetScope",
    "contextSnapshot",
    "operationTargetSnapshot",
    "appendAssistantProposal",
    "prepareProposalForReview",
    "operationExecutor.applyOperation"
  ]) {
    assert.match(`${assistantSource}\n${reactComposerSources}`, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "buildContextPackage",
    "getOperationTargetScope",
    "operationExecutor",
    "new OpenAIChatAdapter",
    "new AnthropicChatAdapter",
    "MessageList",
    "ProposalCard"
  ]) {
    assert.doesNotMatch(reactComposerSources, new RegExp(escapeRegExp(text)));
  }
});

test("assistant chat view keeps Phase 10 visual-only IDE panel contract", () => {
  const assistantSource = readFileSync("src/assistant-view.ts", "utf8");
  const toolbarSource = readFileSync("src/ui/components/composer-toolbar.tsx", "utf8");
  const modelSelectorSource = readFileSync("src/ui/components/composer-model-selector.tsx", "utf8");
  const reactComposerSources = [
    "src/ui/components/composer.tsx",
    "src/ui/components/composer-toolbar.tsx",
    "src/ui/components/composer-attachment-bar.tsx",
    "src/ui/components/composer-input.tsx",
    "src/ui/components/composer-actions.tsx",
    "src/ui/components/composer-model-selector.tsx"
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const pickerSource = readFileSync("src/context-picker.ts", "utf8");
  const settingsSource = readFileSync("src/settings.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "MODEL_OPTIONS[provider]",
    "SYSTEM_PROMPT_PRESETS.map",
    "buildContextPackage",
    "getOperationTargetScope",
    "operationExecutor.applyOperation",
    "void this.startNewChat()",
    "clearConversationDraftState",
    "clearSourcesAndTargets",
    "attachExternalImageFiles",
    "createDraftImageAttachment",
    "persistImageAttachment"
  ]) {
    assert.match(assistantSource, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "options.map",
    "vault-ai-assistant-system-prompt-option",
    "aria-checked",
    "API key required",
    "provider.models.map",
    "vault-ai-assistant-model-selector-capability"
  ]) {
    assert.match(`${toolbarSource}\n${modelSelectorSource}`, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "vault-ai-assistant-header-side",
    "vault-ai-assistant-status-pill",
    "vault-ai-assistant-chat-empty-status",
    "No context attached",
    "attached vault context",
    "vault-ai-assistant-composer-topbar",
    "vault-ai-assistant-picker-modal",
    "vault-ai-assistant-image-picker-modal",
    "isSupportedImagePath(file.path)",
    "this.onChoose(file)"
  ]) {
    assert.match(`${assistantSource}\n${pickerSource}\n${styles}`, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "new OpenAIChatAdapter",
    "new AnthropicChatAdapter",
    "operationExecutor",
    "buildContextPackage",
    "getOperationTargetScope",
    "this.plugin.contextManager",
    "MODEL_OPTIONS",
    "Default assistant",
    "Vault editor"
  ]) {
    assert.doesNotMatch(reactComposerSources, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(settingsSource, /assistantPanel|composerStyle|uiDensity|themePreference/);
});

test("assistant chat view keeps required Phase 6 prompt settings contract", () => {
  const source = readComposerMigrationSources();
  const mainSource = readFileSync("src/main.ts", "utf8");
  const settings = readFileSync("src/settings.ts", "utf8");
  const systemPrompts = readFileSync("src/system-prompts.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "renderChatSettings",
    "System Prompt",
    "SYSTEM_PROMPT_PRESETS",
    "this.plugin.ensureEditableSystemPrompts()",
    "System prompt files could not be created under vault-ai-assistant/system-prompts.",
    "readSelectedSystemPrompt",
    "systemPromptPresetId",
    "this.plugin.saveSettings()",
    "systemPrompt = await readSelectedSystemPrompt",
    "System prompt could not be loaded - check vault-ai-assistant/system-prompts and try again.",
    "systemPrompt,",
    "enableVaultOperations: shouldEnableVaultOperationsForRequest({",
    "previousMessages,",
    "maxOutputTokens: this.plugin.settings.maxOutputTokens",
    "operationTargets.sources.length",
    "function shouldEnableVaultOperations",
    "function shouldEnableVaultOperationsForRequest",
    "\\b(note|file|folder|directory|vault|markdown|md|document|chapter|chapters|template|homepage|index|strategy|strategies)\\b",
    "Orchestrator Operations",
    "context-file edit intent",
    "organize",
    "correct\\s+grammar",
    "proofread"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "await this.ensureEditableSystemPrompts()",
    "ensureSystemPromptFiles(this.app.vault)",
    "Vault AI Assistant could not create system prompt files."
  ]) {
    assert.match(mainSource, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "systemPromptPresetId",
    "assistantViewLocation",
    "Assistant view",
    "Sidebar view",
    "Editor",
    "autoAttachActiveFileContext",
    "Auto attach active note",
    "DEFAULT_SYSTEM_PROMPT_PRESET_ID",
    "normalizeSystemPromptPresetId",
    "chatHistoryRetentionDays",
    "maxOutputTokens",
    "DEFAULT_MAX_OUTPUT_TOKENS",
    "OUTPUT_TOKEN_LIMIT_MIN",
    "OUTPUT_TOKEN_LIMIT_MAX",
    "128000",
    "Token limit",
    "Controls the most the AI can write in one reply.",
    "A token is a small chunk of text.",
    "Raise this for longer answers or large vault-change proposals.",
    "Lower it to keep replies shorter, faster, and cheaper.",
    "renderTokenLimitControl",
    "updateControlValue",
    "setValueFromVisualPointer",
    "pointerdown",
    "pointermove",
    "pointerup",
    "vault-ai-assistant-token-limit-control",
    "vault-ai-assistant-token-limit-number",
    "vault-ai-assistant-token-limit-slider",
    "vault-ai-assistant-token-limit-slider-visual",
    "vault-ai-assistant-token-limit-slider-track",
    "vault-ai-assistant-token-limit-slider-thumb",
    "vault-ai-assistant-token-limit-ticks",
    "vault-ai-assistant-token-limit-label-low",
    "vault-ai-assistant-token-limit-label-high",
    "Shorter",
    "Balanced",
    "Longer",
    "CHAT_HISTORY_RETENTION_OPTIONS",
    "[\n  1,\n  3,\n  7,\n  30,\n  60,\n  90\n]",
    "API key",
    "Delete chat history",
    "Automatically move saved chat history older than this window to Obsidian trash",
    "hasAvailableProviderKey",
    "getProviderSecretName",
    "getSelectedModelForProvider",
    "setSelectedModelForProvider",
    "hasAvailableProviderKey(app, settings, settings.activeProvider)",
    "settings.activeProvider = provider"
  ]) {
    assert.match(settings, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(settings, /setName\("Active provider"\)/);
  assert.doesNotMatch(settings, /setName\("Model"\)/);
  assert.doesNotMatch(settings, /setName\("Chat model"\)/);
  assert.doesNotMatch(settings, /Choose the chat model from the composer/);

  for (const text of [
    "pruneSavedChatHistory",
    "chatHistoryRetentionDays === null",
    "this.chatStore.pruneSavedConversations"
  ]) {
    assert.match(mainSource, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "getAssistantLeafForLocation",
    "createAssistantLeafForLocation",
    "getLeaf(\"tab\")",
    "getRightLeaf(false)",
    "isLeafInSidebar",
    "isLeafInEditor"
  ]) {
    assert.match(mainSource, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "Default assistant",
    "Vault editor",
    "vault-ai-assistant/system-prompts",
    ".vault-ai-assistant/system-prompts",
    "default-assistant.md",
    "vault-editor.md",
    "explicitly served notes, folders, images",
    "prior chat messages",
    "approval-gated markdown vault changes",
    "Orchestrator Operations",
    "attached note",
    "Do not invent note paths",
    "available vault-operation proposal tool"
  ]) {
    assert.match(systemPrompts, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    ".vault-ai-assistant-chat-settings",
    ".vault-ai-assistant-chat-settings-row",
    ".vault-ai-assistant-token-limit-control",
    ".vault-ai-assistant-token-limit-number",
    ".vault-ai-assistant-token-limit-slider-wrap",
    "--vault-ai-assistant-token-limit-position",
    ".vault-ai-assistant-token-limit-slider-visual",
    ".vault-ai-assistant-token-limit-slider-track",
    ".vault-ai-assistant-token-limit-slider-thumb",
    ".vault-ai-assistant-token-limit-slider-wrap:focus-within",
    ".vault-ai-assistant-token-limit-ticks span:first-child",
    ".vault-ai-assistant-token-limit-ticks span:last-child",
    ".vault-ai-assistant-token-limit-label-low",
    ".vault-ai-assistant-token-limit-label-high",
    "cursor: pointer",
    "touch-action: pan-y",
    "pointer-events: none",
    "var(--text-success, #2f9e44)",
    "var(--text-warning, #b7791f)",
    "width: 100%"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /createVaultOperationSystemPrompt\(\)/);
});

test("assistant chat view routes provider requests through Obsidian requestUrl transport", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const transportSource = readFileSync("src/obsidian-request-fetch.ts", "utf8");

  assert.match(source, /obsidianRequestFetch/);
  assert.match(source, /new OpenAIChatAdapter\(obsidianRequestFetch\)/);
  assert.match(source, /new AnthropicChatAdapter\(obsidianRequestFetch\)/);
  assert.match(transportSource, /requestUrl/);
  assert.match(transportSource, /throw: false/);
  assert.match(transportSource, /new Response/);
});

test("assistant chat view keeps required Phase 4 proposal review contract", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "Proposed changes",
    "proposed change",
    "Review changes",
    "Review delete",
    "Accept all",
    "Accept all including delete",
    "Reject all",
    "if (hasPendingOperations)",
    "Accept",
    "Move to trash",
    "Reject",
    "createReviewActionButton",
    "getOperationIcon",
    "git-pull-request",
    "file-plus",
    "folder-plus",
    "trash-2",
    "if (operation.status === \"pending\")",
    "Pending",
    "Applied",
    "appliedAt",
    "vault-ai-assistant-operation-audit",
    "Rejected",
    "Failed",
    "renderProposalCard",
    "renderOperationRow",
    "appendAssistantProposal",
    "prepareProposalForReview",
    "this.plugin.chatStore.rejectOperation",
    "private async applyOperation",
    "private async applyProposal",
    "this.plugin.operationExecutor.applyOperation",
    "const applied = await this.applyOperation",
    "break;",
    "applying",
    "create_folder",
    "Create folder",
    "Move note",
    "Move folder",
    "Copy note",
    "Delete folder",
    "Note was not found.",
    "vault-ai-assistant-operation-destructive",
    "delete_note",
    "delete_folder",
    "move_note",
    "move_folder",
    "copy_note",
    "isDestructiveOperation"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    ".vault-ai-assistant-proposal",
    ".vault-ai-assistant-proposal-header",
    ".vault-ai-assistant-proposal-summary",
    ".vault-ai-assistant-proposal-title",
    ".vault-ai-assistant-proposal-title-icon",
    ".vault-ai-assistant-proposal-actions",
    ".vault-ai-assistant-operation-list",
    ".vault-ai-assistant-operation-row",
    ".vault-ai-assistant-operation-destructive",
    ".vault-ai-assistant-operation-header",
    ".vault-ai-assistant-operation-kind",
    ".vault-ai-assistant-operation-kind-icon",
    ".vault-ai-assistant-operation-path",
    ".vault-ai-assistant-operation-state",
    ".vault-ai-assistant-operation-state-applied",
    ".vault-ai-assistant-operation-audit",
    ".vault-ai-assistant-operation-error",
    ".vault-ai-assistant-operation-preview",
    ".vault-ai-assistant-operation-actions",
    ".vault-ai-assistant-review-action",
    ".vault-ai-assistant-review-action-primary",
    ".vault-ai-assistant-review-action-danger",
    ".vault-ai-assistant-diff",
    ".vault-ai-assistant-diff-line",
    ".vault-ai-assistant-diff-added",
    ".vault-ai-assistant-diff-removed",
    ".vault-ai-assistant-diff-context",
    ".vault-ai-assistant-markdown-preview"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /rename_note/);
  assert.doesNotMatch(source, /\bRename\b/);
});

test("assistant chat view keeps required Phase 04.1 composer contract", () => {
  const source = readComposerMigrationSources();
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "renderComposerSettings",
    "Chat History",
    "Attach image",
    "Target /",
    "Missing image",
    "Choose an image-capable model to send images.",
    "modelSupportsImages",
    "persistImageAttachment",
    "readPersistedImageAttachmentData",
    "attachExternalImageFiles",
    "vault-ai-assistant-image-file-input",
    "accept=\"image/png,image/jpeg,image/webp,image/gif\"",
    "type=\"file\"",
    "multiple",
    "imageAttachments",
    "onAttachImageFiles",
    "onKeyDown",
    "Enter",
    "shiftKey",
    "getAutosizeBounds",
    "ResizeObserver",
    "listSavedConversations",
    "openConversation",
    "clearConversationDraftState",
    "clearSourcesAndTargets",
    "isSupportedImagePath"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /restoreSources\(/);

  for (const text of [
    ".vault-ai-assistant-composer-settings",
    ".vault-ai-assistant-toolbar-nav",
    ".vault-ai-assistant-image-attach-action",
    ".vault-ai-assistant-image-file-input",
    ".vault-ai-assistant-attachment-bar",
    ".vault-ai-assistant-image-chip",
    ".vault-ai-assistant-missing-image-chip",
    ".vault-ai-assistant-context-summary-chip",
    ".vault-ai-assistant-context-summary-action-danger",
    ".vault-ai-assistant-picker-attached-context",
    "max-height: min(220px, 34vh)",
    ".vault-ai-assistant-chat-history-row",
    "-webkit-line-clamp: 2",
    "white-space: nowrap",
    "min-width: 68px",
    "height: 28px",
    "@media (max-width: 420px)",
    "max-height: min(420px, calc(100vh - 170px))",
    "min-height: 58px",
    "max-height: 132px",
    "flex: 0 0 34px",
    ".vault-ai-assistant-composer-helper-error",
    "resize: none",
    "max-height: 180px",
    "@media (max-width: 360px)"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.doesNotMatch(source, /window\.confirm/);
});

test("assistant chat view keeps required Phase 8 edit target context contract", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const picker = readFileSync("src/context-picker.ts", "utf8");
  const store = readFileSync("src/chat-store.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "Add readable context",
    "Set edit target",
    "Context",
    "Target",
    "aria-pressed",
    "getOperationTargetScope",
    "operationTargets",
    "operationTargetSnapshot",
    "getRestorableAttachments",
    "autoAttachActiveFileContext",
    "includeActiveFileDirectory",
    "renderTargetChip",
    "Target /",
    "Context sent",
    "Edit targets",
    "addTargetFolder",
    "addTargetFile",
    "onChooseFolder",
    "onRemoveContext"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  for (const text of [
    "NavigableContextPickerModal",
    "NavigableScopeFolderPickerModal",
    "Add this whole folder",
    "Set edit target to this folder",
    "Set edit target to vault root",
    "Edit target folders are path hints only. Contents are not included as context.",
    "Back to parent folder",
    "arrow-left",
    "vault-ai-assistant-picker-nav-icon",
    "Attached context",
    "No visible markdown files or folders here.",
    "vault-ai-assistant-context-browser-modal",
    "vault-ai-assistant-scope-browser-modal",
    "isAssistantOwnedPath"
  ]) {
    assert.match(picker, new RegExp(escapeRegExp(text)));
  }

  assert.match(picker, /Set edit target folder/);
  assert.match(picker, /Contents are not included as context\./);
  assert.match(picker, /folder\.path \|\| "\/"/);
  assert.match(store, /Edit targets:/);
  assert.match(styles, /\.vault-ai-assistant-scope-mode/);
  assert.match(styles, /\.vault-ai-assistant-scope-chip/);
  assert.match(styles, /\.vault-ai-assistant-picker-nav-row/);
  assert.match(styles, /\.vault-ai-assistant-picker-nav-icon/);

  const scopeBrowser = picker.slice(
    picker.indexOf("class NavigableScopeFolderPickerModal"),
    picker.indexOf("class ImageAttachmentPickerModal")
  );
  assert.doesNotMatch(scopeBrowser, /renderFileRow|isMarkdownFile|instanceof TFile/);

  const targetRenderer = source.slice(
    source.indexOf("private renderTargetChip"),
    source.indexOf("private renderImageAttachmentChips")
  );
  assert.doesNotMatch(targetRenderer, /formatEstimatedTokens|est\. tokens|markdown file|files/);
});

test("assistant chat view keeps required Phase 5 error recovery contract", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "vault-ai-assistant-message-error",
    "vault-ai-assistant-composer-helper-error",
    "Choose an image-capable model to send images.",
    "API key is missing or unavailable",
    "Reconnect it in plugin settings",
    "check your network connection and provider status"
  ]) {
    assert.match(`${source}\n${styles}`, new RegExp(escapeRegExp(text)));
  }
});

test("assistant chat view keeps Phase 11 proposal recovery visibility contract", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  assert.match(
    source,
    /The provider returned an incomplete Orchestrator Operation proposal\. No vault files were changed\. Retry the request or ask for fewer file changes\./
  );
  assert.match(source, /cls: "vault-ai-assistant-message-error"/);
  assert.match(source, /vault-ai-assistant-scopes-used/);

  const proposalIndex = source.indexOf("this.renderProposalCard(row, message, proposal);");
  const contextIndex = source.indexOf("this.renderContextUsed(row, message.contextSnapshot");
  const scopeIndex = source.indexOf("this.renderTargetsUsed(row, message.operationTargetSnapshot");
  assert.ok(proposalIndex !== -1);
  assert.ok(contextIndex !== -1);
  assert.ok(scopeIndex !== -1);
  assert.ok(proposalIndex < contextIndex);
  assert.ok(proposalIndex < scopeIndex);

  for (const text of [
    ".vault-ai-assistant-proposal",
    ".vault-ai-assistant-operation-row",
    ".vault-ai-assistant-message-error",
    ".vault-ai-assistant-context-used",
    ".vault-ai-assistant-scopes-used",
    "@media (max-width: 420px)",
    "@media (max-width: 360px)"
  ]) {
    assert.match(styles, new RegExp(escapeRegExp(text)));
  }

  assert.match(styles, /\.vault-ai-assistant-proposal\s*\{[\s\S]*?min-width: 0[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /\.vault-ai-assistant-proposal-actions\s*\{[\s\S]*?flex-wrap: wrap[\s\S]*?min-width: 0/);
  assert.match(styles, /\.vault-ai-assistant-operation-row\s*\{[\s\S]*?min-width: 0[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /\.vault-ai-assistant-message-error\s*\{[\s\S]*?min-width: 0[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /\.vault-ai-assistant-context-used\s*\{[\s\S]*?min-width: 0/);
  assert.match(styles, /\.vault-ai-assistant-scopes-used\s*\{[\s\S]*?min-width: 0/);
});

test("assistant chat view keeps Phase 12 expanded operation proposal contract", () => {
  const source = readFileSync("src/assistant-view.ts", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const text of [
    "Move note",
    "Move folder",
    "Copy note",
    "Delete folder",
    "move-right",
    "folder-x",
    "isDestructiveOperation",
    "operation.status === \"pending\"",
    "Move to trash"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }

  const proposalIndex = source.indexOf("this.renderProposalCard(row, message, proposal);");
  const contextIndex = source.indexOf("this.renderContextUsed(row, message.contextSnapshot");
  const scopeIndex = source.indexOf("this.renderTargetsUsed(row, message.operationTargetSnapshot");
  assert.ok(proposalIndex !== -1);
  assert.ok(contextIndex !== -1);
  assert.ok(scopeIndex !== -1);
  assert.ok(proposalIndex < contextIndex);
  assert.ok(proposalIndex < scopeIndex);

  assert.match(styles, /\.vault-ai-assistant-operation-row\s*\{[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /\.vault-ai-assistant-markdown-preview\s*\{[\s\S]*?overflow-wrap: anywhere/);
});

test("assistant chat styles include required Phase 3 classes", () => {
  const source = readFileSync("styles.css", "utf8");

  for (const text of [
    ".vault-ai-assistant-chat",
    ".vault-ai-assistant-composer",
    ".vault-ai-assistant-messages",
    ".vault-ai-assistant-message-markdown",
    ".vault-ai-assistant-context-used",
    ".vault-ai-assistant-context-chip",
    ".vault-ai-assistant-message-error",
    ".vault-ai-assistant-toolbar-nav",
    "@media (max-width: 360px)",
    "var(--interactive-accent)",
    "var(--background-secondary)",
    "var(--background-modifier-border)",
    "var(--text-muted)",
    "var(--text-warning)",
    "var(--text-error)",
    "overflow-wrap: anywhere"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(text)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readComposerMigrationSources(): string {
  return [
    "src/assistant-view.ts",
    "src/ui/components/composer.tsx",
    "src/ui/components/composer-actions.tsx",
    "src/ui/components/composer-attachment-bar.tsx",
    "src/ui/components/composer-input.tsx",
    "src/ui/components/composer-toolbar.tsx",
    "src/ui/components/composer-model-selector.tsx",
    "src/orchestrator-operations/lifecycle.ts"
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}
