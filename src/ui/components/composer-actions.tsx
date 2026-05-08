import * as React from "react";
import { Image, Mic, Square } from "lucide-react";
import { Button } from "./button";
import {
  ComposerModelSelector,
  type ComposerModelProviderGroup
} from "./composer-model-selector";
import type { ProviderId } from "../../settings";

export interface ComposerModelSelectorState {
  currentProviderLabel: string;
  currentModelLabel: string;
  isOpen: boolean;
  providers: ComposerModelProviderGroup[];
  activeProvider: ProviderId;
}

export interface ComposerVoiceInputState {
  available: boolean;
  active: boolean;
  busy: boolean;
  disabledReason: string;
}

interface ComposerActionsProps {
  modelSelector: ComposerModelSelectorState;
  isStreaming: boolean;
  canSend: boolean;
  selectedModelSupportsImages: boolean;
  voiceInput: ComposerVoiceInputState;
  onToggleModelPicker: () => void;
  onSelectModel: (provider: ProviderId, model: string) => void;
  onAttachImageFiles: (files: File[]) => void;
  onToggleVoiceInput: () => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function ComposerActions({
  modelSelector,
  isStreaming,
  canSend,
  selectedModelSupportsImages,
  voiceInput,
  onToggleModelPicker,
  onSelectModel,
  onAttachImageFiles,
  onToggleVoiceInput,
  onSubmit,
  onStop
}: ComposerActionsProps): React.ReactElement {
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const voiceLabel = voiceInput.active
    ? "Stop recording"
    : voiceInput.busy
      ? "Transcribing voice"
      : "Record voice";
  const voiceDisabled = !voiceInput.available || voiceInput.busy || isStreaming;
  const voiceTooltip = voiceInput.available ? voiceLabel : voiceInput.disabledReason;

  return (
    <div className="vault-ai-assistant-composer-actions">
      <div className="vault-ai-assistant-composer-model-slot">
        <ComposerModelSelector
          {...modelSelector}
          onToggle={onToggleModelPicker}
          onSelect={onSelectModel}
        />
      </div>
      <div className="vault-ai-assistant-composer-send-slot">
        <input
          ref={imageInputRef}
          className="vault-ai-assistant-image-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length > 0) {
              onAttachImageFiles(files);
            }
          }}
        />
        <button
          type="button"
          className={`vault-ai-assistant-icon-action vault-ai-assistant-voice-action${
            voiceInput.active ? " is-recording" : ""
          }`}
          disabled={voiceDisabled}
          data-tooltip-label={voiceTooltip}
          aria-label={voiceLabel}
          onClick={() => {
            if (!voiceDisabled) {
              onToggleVoiceInput();
            }
          }}
        >
          {voiceInput.active ? (
            <Square size={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Mic size={16} strokeWidth={1.8} aria-hidden="true" />
          )}
          <span className="vault-ai-assistant-sr-only">{voiceLabel}</span>
        </button>
        <button
          type="button"
          className="vault-ai-assistant-icon-action vault-ai-assistant-image-attach-action"
          disabled={!selectedModelSupportsImages || isStreaming}
          data-tooltip-label={
            selectedModelSupportsImages ? "Attach image" : "Images unavailable for selected model"
          }
          aria-label={
            selectedModelSupportsImages ? "Attach image" : "Images unavailable for selected model"
          }
          onClick={() => {
            if (selectedModelSupportsImages) {
              imageInputRef.current?.click();
            }
          }}
        >
          <Image size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="vault-ai-assistant-sr-only">
            {selectedModelSupportsImages ? "Attach image" : "Images unavailable for selected model"}
          </span>
        </button>
        <Button
          type="button"
          className="vault-ai-assistant-primary"
          disabled={!isStreaming && !canSend}
          aria-label={isStreaming ? "Stop response" : "Send message"}
          onClick={isStreaming ? onStop : onSubmit}
        >
          {isStreaming ? "Stop response" : "Send"}
        </Button>
      </div>
    </div>
  );
}
