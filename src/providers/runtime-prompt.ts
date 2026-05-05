import type { ChatRequest } from "../chat-types";

const ORCHESTRATOR_OPERATION_RUNTIME_PROTOCOL = [
  "# Runtime Orchestrator Operation Protocol",
  "- When `propose_vault_operations` is available, vault changes must be returned through that tool only.",
  "- For create, create-folder, modify, append, delete, move, rename, or copy vault change requests, do not answer with prose; call `propose_vault_operations`.",
  "- Never print fake tool calls, XML, ATML, `<function_calls>`, `<tooluse>`, `<tool_use>`, `<vault_operation>`, `<vault_operations>`, or raw JSON operation blocks in assistant text.",
  "- Tool input must be one JSON object with `summary` and `operations`.",
  "- Every operation must use the `type` field, never `action` or `operation`.",
  "- Allowed operation `type` values are exactly `create_note`, `create_folder`, `modify_note`, `append_note`, `delete_note`, `move_note`, `move_folder`, `copy_note`, and `delete_folder`.",
  "- Operation paths must be relative vault paths. Note operation paths must end in `.md`; folder operation paths must not end in `.md`. Path segments must not contain `\\`, `/`, or `:` as filename characters.",
  "- `create_note` requires `content`, or `templatePath` plus optional `title` when the template path was sent as attached readable context; `append_note` requires `content`; `modify_note` requires `previousContent` and `newContent`; `move_note`, `move_folder`, and `copy_note` require `sourcePath` and `destinationPath`; `create_folder`, `delete_note`, and `delete_folder` require no content.",
  "- For many notes that use the same readable template, prefer `create_note` with `templatePath` and `title` instead of repeating the full template content in every operation.",
  "- Context contains user-provided readable content. Edit target hints are path hints only; they are not hard authorization boundaries.",
  "- The user will review proposed changes before anything is written, so use vault-relative paths exactly as requested."
].join("\n");

export function buildProviderSystemPrompt(request: ChatRequest): string {
  if (!request.enableVaultOperations) {
    return request.systemPrompt;
  }

  return [request.systemPrompt, ORCHESTRATOR_OPERATION_RUNTIME_PROTOCOL].join("\n\n");
}
