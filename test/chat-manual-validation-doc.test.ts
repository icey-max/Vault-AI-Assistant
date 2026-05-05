import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Manual Validation Checklist covers release validation paths", () => {
  const checklist = readFileSync("docs/manual-validation.md", "utf8");

  for (const text of [
    "Manual Validation Checklist",
    "Missing or stale API key",
    "Provider rate limit or HTTP error",
    "Oversized request",
    "Core Chat Flow",
    "Context and Edit Targets",
    "Approval-gated Vault Operations",
    "`move_note`",
    "`delete_folder`",
    "partial failure",
    "Proposal Recovery",
    "Attach a markdown note as readable context",
    "Verify raw JSON or fake tool tags are not visible in chat",
    "GitHub release assets include `main.js`, `manifest.json`, and `styles.css`",
    "public repository does not track local planning, agent, vault, secret, generated, or dependency artifacts"
  ]) {
    assert.match(checklist, new RegExp(escapeRegExp(text)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
