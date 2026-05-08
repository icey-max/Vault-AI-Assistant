import * as React from "react";
import { Image } from "lucide-react";
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

interface ComposerActionsProps {
  modelSelector: ComposerModelSelectorState;
  isStreaming: boolean;
  canSend: boolean;
  selectedModelSupportsImages: boolean;
  onToggleModelPicker: () => void;
  onSelectModel: (provider: ProviderId, model: string) => void;
  onAttachImageFiles: (files: File[]) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function ComposerActions({
  modelSelector,
  isStreaming,
  canSend,
  selectedModelSupportsImages,
  onToggleModelPicker,
  onSelectModel,
  onAttachImageFiles,
  onSubmit,
  onStop
}: ComposerActionsProps): React.ReactElement {
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);

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
