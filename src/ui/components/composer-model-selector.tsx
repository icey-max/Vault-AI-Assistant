import * as React from "react";
import { Check, ChevronsUpDown, Eye, Mic, MicOff } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";
import type { ModelOption, ProviderId } from "../../settings";

export interface ComposerModelProviderGroup {
  id: ProviderId;
  label: string;
  available: boolean;
  selectedModel: string;
  models: ModelOption[];
}

interface ComposerModelSelectorProps {
  currentProviderLabel: string;
  currentModelLabel: string;
  isOpen: boolean;
  providers: ComposerModelProviderGroup[];
  activeProvider: ProviderId;
  onToggle: () => void;
  onSelect: (provider: ProviderId, model: string) => void;
}

export function ComposerModelSelector({
  currentProviderLabel,
  currentModelLabel,
  isOpen,
  providers,
  activeProvider,
  onToggle,
  onSelect
}: ComposerModelSelectorProps): React.ReactElement {
  const activeProviderGroup = providers.find((provider) => provider.id === activeProvider);
  const currentModelSupportsImages =
    activeProviderGroup?.models.find(
      (model) => model.value === activeProviderGroup.selectedModel
    )?.supportsImages === true;
  const currentModelSupportsVoice =
    activeProviderGroup?.models.find(
      (model) => model.value === activeProviderGroup.selectedModel
    )?.supportsVoice === true;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn("vault-ai-assistant-model-selector", isOpen && "is-active")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Choose model. Current model: ${currentProviderLabel} ${currentModelLabel}.`}
        onClick={onToggle}
      >
        <span className="vault-ai-assistant-model-selector-label">
          <span className="vault-ai-assistant-model-selector-model">{currentModelLabel}</span>
          <span className="vault-ai-assistant-model-selector-provider">{currentProviderLabel}</span>
        </span>
        {currentModelSupportsImages ? (
          <span
            className="vault-ai-assistant-model-vision-cue vault-ai-assistant-model-selector-capability"
            aria-label="Supports images"
            title="Supports images"
          >
            <Eye size={14} strokeWidth={1.8} aria-hidden="true" />
          </span>
        ) : null}
        <span
          className={cn(
            "vault-ai-assistant-model-voice-cue",
            !currentModelSupportsVoice && "vault-ai-assistant-model-voice-cue-muted",
            "vault-ai-assistant-model-selector-capability"
          )}
          aria-label={
            currentModelSupportsVoice ? "Supports voice input" : "Voice input unavailable"
          }
          title={currentModelSupportsVoice ? "Supports voice input" : "Voice input unavailable"}
        >
          {currentModelSupportsVoice ? (
            <Mic size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <MicOff size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
        </span>
        <span className="vault-ai-assistant-model-selector-icon" aria-hidden="true">
          <ChevronsUpDown size={16} strokeWidth={1.8} />
        </span>
      </Button>

      {isOpen ? (
        <div className="vault-ai-assistant-model-picker" role="menu" aria-label="Model">
          <div className="vault-ai-assistant-model-picker-title">Model</div>
          {providers.map((provider) => (
            <div className="vault-ai-assistant-model-provider-group" key={provider.id}>
              <div className="vault-ai-assistant-model-provider-heading">{provider.label}</div>
              {!provider.available ? (
                <div className="vault-ai-assistant-model-provider-notice">
                  API key required. Add a key in plugin settings to use these models.
                </div>
              ) : null}
              {provider.models.map((model) => {
                const isSelected =
                  activeProvider === provider.id && provider.selectedModel === model.value;
                return (
                  <button
                    key={model.value}
                    type="button"
                    className={cn(
                      "vault-ai-assistant-model-option",
                      isSelected && "vault-ai-assistant-model-option-selected",
                      !provider.available && "vault-ai-assistant-model-option-disabled"
                    )}
                    role="menuitemradio"
                    aria-checked={isSelected}
                    aria-current={isSelected ? "true" : undefined}
                    aria-disabled={!provider.available ? "true" : undefined}
                    disabled={!provider.available}
                    onClick={() => onSelect(provider.id, model.value)}
                  >
                    <span className="vault-ai-assistant-model-option-marker" aria-hidden="true">
                      {isSelected ? <Check size={16} strokeWidth={1.8} /> : null}
                    </span>
                    <span className="vault-ai-assistant-model-option-content">
                      <span className="vault-ai-assistant-model-option-label">
                        <span>{model.label}</span>
                        {model.supportsImages ? (
                          <span
                            className="vault-ai-assistant-model-vision-cue"
                            aria-label="Supports images"
                            title="Supports images"
                          >
                            <Eye size={13} strokeWidth={1.8} aria-hidden="true" />
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "vault-ai-assistant-model-voice-cue",
                            !model.supportsVoice && "vault-ai-assistant-model-voice-cue-muted"
                          )}
                          aria-label={
                            model.supportsVoice
                              ? "Supports voice input"
                              : "Voice input unavailable"
                          }
                          title={
                            model.supportsVoice ? "Supports voice input" : "Voice input unavailable"
                          }
                        >
                          {model.supportsVoice ? (
                            <Mic size={13} strokeWidth={1.8} aria-hidden="true" />
                          ) : (
                            <MicOff size={13} strokeWidth={1.8} aria-hidden="true" />
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
