export type ProviderId = "openai" | "anthropic";

export interface ModelOption {
  value: string;
  label: string;
  supportsImages: boolean;
  supportsVoice: boolean;
}

export const MODEL_OPTIONS: Record<ProviderId, ModelOption[]> = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5", supportsImages: true, supportsVoice: true },
    { value: "gpt-5.4", label: "GPT-5.4", supportsImages: true, supportsVoice: true },
    {
      value: "gpt-5.4-mini",
      label: "GPT-5.4 mini",
      supportsImages: true,
      supportsVoice: true
    },
    {
      value: "gpt-5.4-nano",
      label: "GPT-5.4 nano",
      supportsImages: true,
      supportsVoice: true
    }
  ],
  anthropic: [
    {
      value: "claude-opus-4-7",
      label: "Claude Opus 4.7",
      supportsImages: true,
      supportsVoice: false
    },
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      supportsImages: true,
      supportsVoice: false
    },
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      supportsImages: true,
      supportsVoice: false
    }
  ]
};

export function modelSupportsImages(provider: ProviderId, model: string): boolean {
  return MODEL_OPTIONS[provider].some(
    (option) => option.value === model && option.supportsImages === true
  );
}

export function modelSupportsVoice(provider: ProviderId, model: string): boolean {
  return MODEL_OPTIONS[provider].some(
    (option) => option.value === model && option.supportsVoice === true
  );
}
