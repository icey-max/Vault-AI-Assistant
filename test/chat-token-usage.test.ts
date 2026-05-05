import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateUsageCostUsd,
  formatTokenUsageForDisplay,
  formatTokenUsageForMarkdown
} from "../src/token-usage";

test("token usage formatter renders total token count and estimated cost", () => {
  const usage = {
    inputTokens: 2075,
    outputTokens: 1000,
    totalTokens: 3075
  };

  assert.equal(
    formatTokenUsageForDisplay(usage, "anthropic", "claude-haiku-4-5"),
    "3.1k tokens · est $0.0071"
  );
  assert.equal(
    formatTokenUsageForMarkdown(usage, "anthropic", "claude-haiku-4-5"),
    "3.1k tokens, est $0.0071"
  );
  assert.equal(estimateUsageCostUsd(usage, "anthropic", "claude-haiku-4-5"), 0.007075);
});

test("token usage formatter omits cost when pricing or token split is unavailable", () => {
  assert.equal(
    formatTokenUsageForDisplay({ totalTokens: 1200 }, "openai", "gpt-5.4-mini"),
    "1.2k tokens"
  );
  assert.equal(
    formatTokenUsageForDisplay({ inputTokens: 1000, outputTokens: 500 }, "openai", "unknown-model"),
    "1.5k tokens"
  );
  assert.equal(estimateUsageCostUsd({ totalTokens: 1200 }, "openai", "gpt-5.4-mini"), null);
});
