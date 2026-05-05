import {
  createOperationTargetSnapshot as createOperationTargetSnapshotFromScope,
  type ContextPackage,
  type OperationTargetScope,
  type OperationTargetSnapshot
} from "./context-utils";
import type { ContextSnapshot } from "./chat-types";
import { MODEL_OPTIONS, ProviderId, VaultAIAssistantSettings } from "./settings";
import {
  DEFAULT_ASSISTANT_SYSTEM_PROMPT,
  VAULT_EDITOR_SYSTEM_PROMPT
} from "./system-prompts";

export interface ActiveProviderConfig {
  provider: ProviderId;
  model: string;
  secretName: string;
  label: string;
  modelLabel: string;
}

export function getActiveProviderConfig(
  settings: VaultAIAssistantSettings
): ActiveProviderConfig {
  if (settings.activeProvider === "openai") {
    return {
      provider: "openai",
      model: settings.openaiModel,
      secretName: settings.openaiSecretName,
      label: "OpenAI",
      modelLabel: getModelLabel("openai", settings.openaiModel)
    };
  }

  return {
    provider: "anthropic",
    model: settings.anthropicModel,
    secretName: settings.anthropicSecretName,
    label: "Anthropic",
    modelLabel: getModelLabel("anthropic", settings.anthropicModel)
  };
}

export function createContextSnapshot(context: ContextPackage): ContextSnapshot {
  return {
    files: context.files.map((file) => ({
      path: file.path,
      sourceIds: file.sourceIds.slice(),
      charCount: file.charCount,
      estimatedTokens: file.estimatedTokens
    })),
    fileCount: context.files.length,
    totalCharacters: context.totalCharacters,
    totalEstimatedTokens: context.totalEstimatedTokens,
    sourceIds: context.sourceIds.slice()
  };
}

export function createOperationTargetSnapshot(
  scope: OperationTargetScope
): OperationTargetSnapshot {
  return createOperationTargetSnapshotFromScope(scope);
}

export function createGroundedSystemPrompt(): string {
  return DEFAULT_ASSISTANT_SYSTEM_PROMPT;
}

export function createVaultOperationSystemPrompt(): string {
  return VAULT_EDITOR_SYSTEM_PROMPT;
}

function getModelLabel(provider: ProviderId, model: string): string {
  return MODEL_OPTIONS[provider].find((option) => option.value === model)?.label ?? model;
}
