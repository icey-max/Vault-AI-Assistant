# Manual Validation Checklist

Use this checklist before publishing a release or running a broader alpha/beta test. Run it only after automated checks pass:

```bash
npm test
npm run build
npm run lint
```

## Dedicated Test Vault Only

Do not run manual validation against your main vault.

Use a dedicated Obsidian test vault with disposable markdown notes and folders. The test vault should contain only files you are comfortable changing while validating provider responses, proposal review, and approval-gated vault writes.

## Setup

Set the plugin copy target to the test vault plugin directory:

```bash
export TEST_VAULT_PLUGIN_DIR=/path/to/TestVault/.obsidian/plugins/vault-ai-assistant
npm run build
npm run copy:plugin
```

Open the test vault in Obsidian, enable community plugins, and enable Vault AI Assistant.

## Core Chat Flow

- [ ] Configure an OpenAI or Anthropic API key through plugin settings.
- [ ] Set `Assistant view` to `Sidebar view`, open the assistant, then set it to `Editor` and confirm the command opens an editor tab.
- [ ] Select a model in the chat composer.
- [ ] Attach a markdown note as readable context.
- [ ] Ask a question about that note and verify the answer uses only attached context for vault-specific claims.
- [ ] Start a new chat and verify prior chats remain available in chat history.
- [ ] Attach an image with an image-capable model and verify the request succeeds.
- [ ] Try sending an image with a non-image model and verify send is blocked with visible guidance.

## Context and Edit Targets

- [ ] Open a new chat and confirm the default edit target chip shows `Target /`.
- [ ] Enable `Auto attach active note`, open a disposable markdown note, and confirm the composer shows that note as context with its folder as the default edit target.
- [ ] Attach a disposable folder as an edit target and confirm target chips are visually distinct from context chips.
- [ ] Confirm response metadata shows `Edit targets` for target-only paths.
- [ ] Confirm context metadata does not count target-only folder files.
- [ ] Attach the same folder as readable `Context` and confirm `Context sent` shows file count without token estimates.
- [ ] Ask for an edit to a target-only path and verify the proposal remains approval-gated with clear path review.

## Approval-gated Vault Operations

For each operation, review the proposal before approval and verify no vault write happens until approval:

| Operation / Outcome | Manual Check |
|---------------------|--------------|
| `create_note` | Propose, review, approve, and verify the markdown file is created only after approval. |
| `create_folder` | Propose, review, approve, and verify the folder is created only after approval. |
| `modify_note` | Attach a note as context, propose an edit, review the diff, approve, and verify stale conflicts block overwrites. |
| `append_note` | Propose appending to an existing note, approve, and verify content is appended without replacing existing content. |
| `delete_note` | Propose deleting a disposable note and verify destructive review plus trash behavior. |
| `move_note` | Propose moving or renaming a disposable note, approve, and verify Obsidian links update according to app settings. |
| `move_folder` | Propose moving a disposable folder, approve, and verify child markdown files move with the folder. |
| `copy_note` | Propose copying a disposable note, approve, and verify the original remains unchanged and the destination is created. |
| `delete_folder` | Propose deleting a disposable folder, verify destructive review copy, approve, and verify the folder is moved to trash. |
| unsupported | Ask for shell command execution, binary attachment writes, plugin-folder writes, or folder copy and verify no proposal is rendered. |
| ambiguous | Ask `rename it` with multiple possible targets and verify the assistant asks for clarification or fails safely. |
| malformed | Trigger raw JSON, fake tool tags, malformed JSON, or truncated tool output where practical and verify no raw payload appears in chat. |
| collision | Create a destination path before approval and verify apply fails visibly. |
| stale | Edit a source note between proposal and approval and verify apply fails visibly. |
| partial failure | Apply a batch where one operation succeeds and a later one fails; verify applied, failed, and pending rows remain distinct. |

## Proposal Recovery

- [ ] Attach a folder as an edit target only, ask the assistant to create multiple notes there, then confirm with a short follow-up such as `yes create them`.
- [ ] Verify a proposal card appears or a visible recovery error appears.
- [ ] Verify the assistant never leaves a blank completed card with only provider metadata.
- [ ] Verify raw JSON or fake tool tags are not visible in chat.
- [ ] Verify `Context sent` reports zero files when no readable context was attached.
- [ ] Verify approving or rejecting the proposal remains required before any file is created.

## Provider Failure Handling

- [ ] Missing or stale API key: remove or invalidate the selected provider key and verify the composer or assistant message shows actionable recovery copy without exposing the key.
- [ ] Provider rate limit or HTTP error: trigger or simulate a provider HTTP failure where practical and verify the error identifies the recovery path.
- [ ] Network failure: disconnect or block provider access where practical and verify the request fails visibly without creating a successful response.
- [ ] Oversized request: attach enough disposable context to exceed practical provider limits and verify the request fails with a recoverable provider error.
- [ ] Truncated operation response: ask for a large batch of vault operations and verify incomplete provider output becomes a visible recovery error, not a blank response.

## Release Readiness

- [ ] `README.md` explains setup, safety model, network/data disclosure, and limitations.
- [ ] `manifest.json` version matches `package.json` and `versions.json`.
- [ ] GitHub release tag matches `manifest.json` version exactly.
- [ ] GitHub release assets include `main.js`, `manifest.json`, and `styles.css`.
- [ ] The public repository does not track local planning, agent, vault, secret, generated, or dependency artifacts.
