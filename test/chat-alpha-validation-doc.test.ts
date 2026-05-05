import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Alpha Validation Checklist covers Phase 5 alpha paths", () => {
  const checklist = readFileSync("docs/alpha-validation.md", "utf8");

  for (const text of [
    "Alpha Validation Checklist",
    "CHAT-05",
    "VAULT-09",
    "SAFE-04",
    "Missing or stale API key",
    "Provider rate limit or HTTP error",
    "Oversized request",
    "Changed note conflict",
    "Move/rename collision",
    "Phase 12 Expanded Operations",
    "`move_note`",
    "`delete_folder`",
    "partial-failure",
    "Phase 7 Orchestrator Operations",
    "Untitled/Thoughts.md",
    "organize/clean",
    "Review and apply a modify proposal",
    "Reject a create proposal and verify no file is created",
    "Approve a create proposal",
    "Request delete for an attached note and verify destructive review appears",
    "Reject delete and verify the file remains",
    "Approve delete in a disposable test vault and verify trash behavior",
    "Request modify/delete for an unattached note and verify clean rejection",
    "Trigger malformed operation JSON or a provider alias payload",
    "one repair attempt or clean error",
    "Attach a markdown note as explicit context",
    "Verify the markdown file changed in the vault"
  ]) {
    assert.match(checklist, new RegExp(escapeRegExp(text)));
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
