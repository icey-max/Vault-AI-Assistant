import * as React from "react";
import {
  ComposerActions,
  type ComposerModelSelectorState,
  type ComposerVoiceInputState
} from "./composer-actions";
import { ComposerAttachmentBar } from "./composer-attachment-bar";
import { ComposerInput } from "./composer-input";
import {
  ComposerToolbar,
  type ComposerChatHistoryRow,
  type ComposerSystemPromptOption
} from "./composer-toolbar";
import type { ChatImageAttachment } from "../../chat-types";
import type { ContextAttachmentMode, ContextSource, OperationTargetSource } from "../../context-utils";
import type { ProviderId } from "../../settings";
import type { SystemPromptPresetId } from "../../system-prompts";

export interface ComposerProps {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  canSubmitMessage: (value: string) => boolean;
  helperMessage: string;
  helperIsError: boolean;
  scopeMode: ContextAttachmentMode;
  contextSources: ContextSource[];
  targetSources: OperationTargetSource[];
  imageAttachments: ChatImageAttachment[];
  modelSelector: ComposerModelSelectorState;
  selectedModelSupportsImages: boolean;
  voiceInput: ComposerVoiceInputState;
  chatHistoryOpen: boolean;
  chatSettingsOpen: boolean;
  chatHistoryLoading: boolean;
  chatHistoryRows: ComposerChatHistoryRow[];
  systemPromptOptions: ComposerSystemPromptOption[];
  selectedSystemPromptId: SystemPromptPresetId;
  getContextDisplayName: (source: ContextSource) => string;
  getContextBadgeLabel: (source: ContextSource) => string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  onAttachImageFiles: (files: File[]) => void;
  onToggleVoiceInput: () => void;
  onScopeModeChange: (mode: ContextAttachmentMode) => void;
  onAddContext: () => void;
  onAddScope: () => void;
  onRemoveContext: (source: ContextSource) => void;
  onRemoveAllContext: () => void;
  onRemoveScope: (target: OperationTargetSource) => void;
  onRemoveImage: (attachment: ChatImageAttachment) => void;
  onToggleModelPicker: () => void;
  onSelectModel: (provider: ProviderId, model: string) => void;
  onNewChat: () => void;
  onToggleChatHistory: () => void;
  onToggleSettings: () => void;
  onOpenSavedChat: (filePath: string) => void;
  onSelectSystemPrompt: (presetId: SystemPromptPresetId) => void;
}

export function Composer({
  value,
  disabled,
  isStreaming,
  canSubmitMessage,
  helperMessage,
  helperIsError,
  scopeMode,
  contextSources,
  targetSources,
  imageAttachments,
  modelSelector,
  selectedModelSupportsImages,
  voiceInput,
  chatHistoryOpen,
  chatSettingsOpen,
  chatHistoryLoading,
  chatHistoryRows,
  systemPromptOptions,
  selectedSystemPromptId,
  getContextDisplayName,
  getContextBadgeLabel,
  onValueChange,
  onSubmit,
  onStop,
  onAttachImageFiles,
  onToggleVoiceInput,
  onScopeModeChange,
  onAddContext,
  onAddScope,
  onRemoveContext,
  onRemoveAllContext,
  onRemoveScope,
  onRemoveImage,
  onToggleModelPicker,
  onSelectModel,
  onNewChat,
  onToggleChatHistory,
  onToggleSettings,
  onOpenSavedChat,
  onSelectSystemPrompt
}: ComposerProps): React.ReactElement {
  const [draft, setDraft] = React.useState(value);
  const [activeScopeMode, setActiveScopeMode] = React.useState(scopeMode);
  const localCanSend = canSubmitMessage(draft) && !isStreaming;

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  React.useEffect(() => {
    setActiveScopeMode(scopeMode);
  }, [scopeMode]);

  const updateDraft = React.useCallback(
    (nextValue: string) => {
      setDraft(nextValue);
      onValueChange(nextValue);
    },
    [onValueChange]
  );

  const submitCurrentValue = React.useCallback(() => {
    onSubmit(draft);
  }, [draft, onSubmit]);

  const changeScopeMode = React.useCallback(
    (mode: ContextAttachmentMode) => {
      setActiveScopeMode(mode);
      onScopeModeChange(mode);
    },
    [onScopeModeChange]
  );

  return (
    <>
      <div className="vault-ai-assistant-composer-input-shell vault-ai-assistant-composer-surface">
        <div className="vault-ai-assistant-composer-topbar">
          <ComposerAttachmentBar
            scopeMode={activeScopeMode}
            contextSources={contextSources}
            targetSources={targetSources}
            imageAttachments={imageAttachments}
            getContextDisplayName={getContextDisplayName}
            getContextBadgeLabel={getContextBadgeLabel}
            onScopeModeChange={changeScopeMode}
            onAddContext={onAddContext}
            onAddScope={onAddScope}
            onRemoveContext={onRemoveContext}
            onRemoveAllContext={onRemoveAllContext}
            onRemoveScope={onRemoveScope}
            onRemoveImage={onRemoveImage}
          />
          <ComposerToolbar
            chatHistoryOpen={chatHistoryOpen}
            chatSettingsOpen={chatSettingsOpen}
            chatHistoryLoading={chatHistoryLoading}
            chatHistoryRows={chatHistoryRows}
            systemPromptOptions={systemPromptOptions}
            selectedSystemPromptId={selectedSystemPromptId}
            onNewChat={onNewChat}
            onToggleChatHistory={onToggleChatHistory}
            onToggleSettings={onToggleSettings}
            onOpenSavedChat={onOpenSavedChat}
            onSelectSystemPrompt={onSelectSystemPrompt}
          />
        </div>
        <div className="vault-ai-assistant-composer-divider" />
        <ComposerInput
          value={draft}
          disabled={disabled}
          canSend={localCanSend}
          onValueChange={updateDraft}
          onSubmit={onSubmit}
        />
        <div className="vault-ai-assistant-composer-action-rail">
          <ComposerActions
            modelSelector={modelSelector}
            isStreaming={isStreaming}
            canSend={localCanSend}
            selectedModelSupportsImages={selectedModelSupportsImages}
            voiceInput={voiceInput}
            onToggleModelPicker={onToggleModelPicker}
            onSelectModel={onSelectModel}
            onAttachImageFiles={onAttachImageFiles}
            onToggleVoiceInput={onToggleVoiceInput}
            onSubmit={submitCurrentValue}
            onStop={onStop}
          />
        </div>
      </div>
      {helperMessage ? (
        <div
          className={
            helperIsError
              ? "vault-ai-assistant-composer-helper vault-ai-assistant-composer-helper-error"
              : "vault-ai-assistant-composer-helper"
          }
        >
          {helperMessage}
        </div>
      ) : null}
    </>
  );
}
