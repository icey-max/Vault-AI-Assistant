# Alpha Validation Checklist

Use this checklist for controlled alpha validation after automated build, lint, and test checks pass.

## Dedicated Test Vault Only

Do not run alpha validation against your main vault.

Use a dedicated Obsidian test vault with disposable markdown notes. The test vault should contain only files you are comfortable changing while validating provider responses, proposal review, and approval-gated vault writes.

## Setup

Set the plugin copy target to the test vault plugin directory:

```bash
export TEST_VAULT_PLUGIN_DIR=/path/to/TestVault/.obsidian/plugins/vault-ai-assistant
npm run build
npm run copy:plugin
```

Open the test vault in Obsidian, enable community plugins, and enable Vault AI Assistant.

## Happy Path

- [ ] Enable Vault AI Assistant in the test vault
- [ ] Configure OpenAI or Anthropic provider settings
- [ ] Attach a markdown note as explicit context
- [ ] Ask a grounded question and verify the answer references only attached context
- [ ] Ask the assistant to propose a markdown note edit
- [ ] Review the proposed operation before applying
- [ ] Apply the operation
- [ ] Verify the markdown file changed in the vault

## Hardening Checks

- [ ] Missing or stale API key: remove or invalidate the selected provider key and verify the composer or assistant message shows actionable recovery copy without exposing the key.
- [ ] Provider rate limit or HTTP error: trigger or simulate a provider HTTP failure where practical and verify the error identifies the recovery path.
- [ ] Network failure: disconnect or block provider access where practical and verify the request fails visibly without creating a successful response.
- [ ] Oversized request: attach enough disposable context to exceed practical provider limits and verify the request fails with a recoverable provider error.
- [ ] Unsupported image/model send: attach an image while using a model that does not support image input and verify send is blocked with visible guidance.
- [ ] Changed note conflict: generate a modify or append proposal, edit the scoped note manually before approval, then verify apply fails with a conflict and does not overwrite the manual change.
- [ ] Existing create path: propose creating a note whose path already exists and verify apply fails with a visible operation error.
- [ ] Missing modify or append note: remove the scoped note before approval and verify apply fails with a visible operation error.
- [ ] Move/rename collision: propose moving a note or folder to a path that already exists and verify apply fails with a visible operation error.
- [ ] Unsupported folder copy: ask to copy a folder and verify the assistant explains folder copy is not supported in this alpha rather than rendering an undefined operation.

## Phase 7 Orchestrator Operations

- [ ] Attach `Untitled/Thoughts.md` as context and ask the assistant to organize/clean it; verify the response creates a modify proposal for that attached note instead of a chat-only answer.
- [ ] Review and apply a modify proposal; verify the scoped note changes only after approval.
- [ ] Reject a create proposal and verify no file is created.
- [ ] Approve a create proposal and verify the markdown file exists.
- [ ] Request delete for an attached note and verify destructive review appears with delete-specific styling and action copy.
- [ ] Reject delete and verify the file remains.
- [ ] Approve delete in a disposable test vault and verify trash behavior.
- [ ] Request modify/delete for an unattached note and verify clean rejection with no review card.
- [ ] Trigger malformed operation JSON or a provider alias payload where practical and verify one repair attempt or clean error.
- [ ] Verify create, modify, append, and delete proposals still require user approval before any vault file changes.

## Phase 12 Expanded Operations

| Operation / Outcome | Alpha Check |
|---------------------|-------------|
| `create_note` | Propose, review, approve, and verify the markdown file is created only after approval. |
| `create_folder` | Propose, review, approve, and verify the folder is created only after approval. |
| `modify_note` | Attach a note as context, propose an edit, review the diff, approve, and verify stale conflicts block overwrites. |
| `append_note` | Propose appending to an existing note, approve, and verify content is appended without replacing existing content. |
| `delete_note` | Propose deleting a disposable note and verify destructive review plus trash behavior. |
| `move_note` | Propose moving or renaming a disposable note, approve, and verify Obsidian links update according to app settings. |
| `move_folder` | Propose moving a disposable folder, approve, and verify child markdown files move with the folder. |
| `copy_note` | Propose copying a disposable note, approve, and verify the original remains unchanged and the destination is created. |
| `delete_folder` | Propose deleting a disposable folder, verify destructive review copy, approve, and verify the folder is moved to trash. |
| unsupported | Ask for shell command, binary attachment write, whole-vault rewrite, plugin-folder write, or folder copy and verify no proposal is rendered. |
| ambiguous | Ask "rename it" with multiple possible targets and verify a clarification or safe validation error appears. |
| malformed | Trigger raw JSON, fake tool tags, malformed JSON, or truncated tool output where practical and verify no raw payload appears in chat. |
| outside-target | Ask to move/copy/delete outside attached edit targets and verify the proposal remains approval-gated with safe path review. |
| collision | Create a destination path before approval and verify apply fails visibly. |
| stale | Edit a source note between proposal and approval and verify apply fails visibly. |
| partial-failure | Apply a batch where one operation succeeds and a later one fails; verify applied, failed, and pending rows remain distinct. |

## Context and Edit Target Segmentation

- [ ] Open a new chat and confirm the default edit target chip shows `Target /`.
- [ ] Attach a disposable folder as an edit target and confirm the target chip is visually distinct from context chips.
- [ ] Ask the assistant to create `mmm.md` in the target folder.
- [ ] Confirm response metadata shows `Edit targets`.
- [ ] Confirm context metadata does not count target-only folder files or estimated tokens.
- [ ] Approve the create proposal and verify `mmm.md` appears in the target folder.
- [ ] Attach the same folder as `Context` and confirm `Context sent` shows file count and estimated tokens.
- [ ] Ask for a full rewrite of an unseen target-only child file and confirm review clearly shows the target path and current-file baseline behavior.

## Phase 11 Orchestrator Recovery

- [ ] Attach `Books` as an edit target only, ask for Art of Seduction archetype files, then confirm with `Yes create them`.
- [ ] Verify a proposal card appears or a visible recovery error appears.
- [ ] Verify the assistant never leaves a blank completed card with only provider metadata.
- [ ] Verify raw JSON or fake tool tags are not visible in the chat.
- [ ] Verify `Context sent` reports zero files when no readable context was attached.
- [ ] Verify `Edit targets` shows the target folder.
- [ ] Verify approving or rejecting the proposal remains required before any file is created.

## Release Readiness Notes

- [ ] `CHAT-05`: Pass when provider authentication, HTTP, stream, network, oversized request, and unsupported image/model failures show actionable recovery states without leaking secrets.
- [ ] `VAULT-09`: Pass when changed target files, existing create paths, and missing modify or append notes fail visibly without silently overwriting vault content.
- [ ] `SAFE-04`: Pass when delete has destructive approval/trash review for explicitly attached notes/folders, move/rename uses approval review, unsupported destructive payloads stay unsupported, and no hidden destructive provider payload becomes an ordinary operation.
