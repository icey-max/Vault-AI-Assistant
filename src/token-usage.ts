import type { ChatUsage } from "./chat-types";
import type { ProviderId } from "./model-options";

export interface ModelTokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const TOKEN_PRICING_USD_PER_MILLION: Record<ProviderId, Record<string, ModelTokenPricing>> = {
  openai: {
    "gpt-5.5": { inputPerMillion: 5, outputPerMillion: 30 },
    "gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 15 },
    "gpt-5.4-mini": { inputPerMillion: 0.75, outputPerMillion: 4.5 },
    "gpt-5.4-nano": { inputPerMillion: 0.2, outputPerMillion: 1.25 }
  },
  anthropic: {
    "claude-opus-4-7": { inputPerMillion: 5, outputPerMillion: 25 },
    "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
    "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 }
  }
};

export function formatTokenUsageForDisplay(
  usage: ChatUsage,
  provider?: ProviderId,
  model?: string
): string {
  return buildTokenUsageParts(usage, provider, model).join(" · ") || "unknown";
}

export function formatTokenUsageForMarkdown(
  usage: ChatUsage,
  provider?: ProviderId,
  model?: string
): string {
  return buildTokenUsageParts(usage, provider, model).join(", ") || "unknown";
}

export function estimateUsageCostUsd(
  usage: ChatUsage,
  provider?: ProviderId,
  model?: string
): number | null {
  if (
    !provider ||
    !model ||
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number"
  ) {
    return null;
  }

  const pricing = TOKEN_PRICING_USD_PER_MILLION[provider]?.[model];
  if (!pricing) {
    return null;
  }

  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

function buildTokenUsageParts(
  usage: ChatUsage,
  provider?: ProviderId,
  model?: string
): string[] {
  const parts: string[] = [];
  const totalTokens = getTotalTokens(usage);
  if (typeof totalTokens === "number") {
    parts.push(`${formatTokenCount(totalTokens)} tokens`);
  }

  const cost = estimateUsageCostUsd(usage, provider, model);
  if (typeof cost === "number") {
    parts.push(`est ${formatUsd(cost)}`);
  }

  return parts;
}

function getTotalTokens(usage: ChatUsage): number | null {
  if (typeof usage.totalTokens === "number") {
    return usage.totalTokens;
  }

  if (typeof usage.inputTokens === "number" && typeof usage.outputTokens === "number") {
    return usage.inputTokens + usage.outputTokens;
  }

  return null;
}

function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens)) {
    return "unknown";
  }

  if (Math.abs(tokens) >= 1_000_000) {
    return `${trimTrailingZeros(tokens / 1_000_000)}M`;
  }

  if (Math.abs(tokens) >= 1_000) {
    return `${trimTrailingZeros(tokens / 1_000)}k`;
  }

  return Math.round(tokens).toLocaleString("en-US");
}

function formatUsd(cost: number): string {
  if (cost > 0 && cost < 0.0001) {
    return "<$0.0001";
  }

  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }

  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }

  return `$${cost.toFixed(2)}`;
}

function trimTrailingZeros(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
