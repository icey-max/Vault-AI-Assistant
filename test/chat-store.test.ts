import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ChatStore,
  parseConversationFromMarkdown,
  serializeConversationToMarkdown
} from "../src/chat-store";
import { ContextSnapshot } from "../src/chat-types";
import { VaultOperationProposal } from "../src/vault-operations";

const snapshot: ContextSnapshot = {
  files: [
    {
      path: "Notes/Alpha.md",
      sourceIds: ["note:Notes/Alpha.md"],
      charCount: 42,
      estimatedTokens: 11
    }
  ],
  fileCount: 1,
  totalCharacters: 42,
  totalEstimatedTokens: 11,
  sourceIds: ["note:Notes/Alpha.md"]
};

const targetSnapshot = {
  defaultPath: "/" as const,
  targets: [
    {
      id: "target:folder:My Folder",
      type: "folder" as const,
      path: "My Folder",
      label: "My Folder",
      explicit: true
    }
  ],
  targetCount: 1
};

test("serializeConversationToMarkdown includes response metadata and context snapshot only", () => {
  const markdown = serializeConversationToMarkdown({
    id: "conversation-test",
    title: "Vault AI Assistant Conversation",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:01:00.000Z",
    saveStatus: "saved",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "What does Alpha say?",
        createdAt: "2026-05-01T00:00:00.000Z",
        status: "completed",
        attachments: [
          {
            kind: "markdown",
            id: "note:Notes/Alpha.md",
            sourceType: "note",
            path: "Notes/Alpha.md",
            label: "Notes/Alpha.md"
          },
          {
            kind: "image",
            id: "image-1",
            label: "Sketch.png",
            mediaType: "image/png",
            persistedPath: ".vault-ai-assistant/attachments/conversation-test/Sketch.png",
            status: "persisted"
          }
        ]
      },
      {
        id: "a1",
        role: "assistant",
        content: "Alpha says the project is ready.",
        createdAt: "2026-05-01T00:00:30.000Z",
        status: "stopped",
        provider: "openai",
        model: "gpt-5.4-mini",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        contextSnapshot: snapshot
      }
    ]
  });

  assert.match(markdown, /vault-ai-assistant:conversation/);
  assert.match(markdown, /## User/);
  assert.match(markdown, /## Assistant/);
  assert.match(markdown, /Provider: openai/);
  assert.match(markdown, /Model: gpt-5\.4-mini/);
  assert.match(markdown, /Status: stopped/);
  assert.match(markdown, /Context: 1 file, 11 est\. tokens/);
  assert.match(markdown, /Notes\/Alpha\.md/);
  assert.doesNotMatch(markdown, /sk-test-fake-api-key/);
  assert.doesNotMatch(markdown, /ContextPackageFile\.content/);
  assert.doesNotMatch(markdown, /Authorization/);
  assert.doesNotMatch(markdown, /x-api-key/);
  assert.doesNotMatch(markdown, /dataBase64/);

  const parsed = parseConversationFromMarkdown(markdown);
  const parsedAttachments = parsed?.messages[0]?.attachments;
  assert.equal(parsedAttachments?.[0]?.kind, "markdown");
  assert.equal(parsedAttachments?.[0]?.path, "Notes/Alpha.md");
  assert.equal(parsedAttachments?.[1]?.kind, "image");
  assert.equal(parsedAttachments?.[1]?.label, "Sketch.png");
});

test("serializeConversationToMarkdown includes edit target metadata without target-only contents", () => {
  const markdown = serializeConversationToMarkdown({
    id: "conversation-targets",
    title: "Target chat",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:01:00.000Z",
    saveStatus: "saved",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Create mmm here",
        createdAt: "2026-05-01T00:00:00.000Z",
        status: "completed",
        attachments: [
          {
            kind: "markdown",
            id: "target:folder:My Folder",
            sourceType: "folder",
            path: "My Folder",
            label: "My Folder",
            mode: "target",
            targetType: "folder"
          }
        ]
      },
      {
        id: "a1",
        role: "assistant",
        content: "Created.",
        createdAt: "2026-05-01T00:00:30.000Z",
        status: "completed",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        contextSnapshot: {
          files: [],
          fileCount: 0,
          totalCharacters: 0,
          totalEstimatedTokens: 0,
          sourceIds: []
        },
        operationTargetSnapshot: targetSnapshot
      }
    ]
  });

  assert.match(markdown, /Edit targets: My Folder/);
  assert.match(markdown, /"mode": "target"/);
  assert.doesNotMatch(markdown, /Secret child content/);

  const parsed = parseConversationFromMarkdown(markdown);
  const attachment = parsed?.messages[0]?.attachments?.[0];
  assert.equal(attachment?.kind, "markdown");
  if (attachment?.kind === "markdown") {
    assert.equal(attachment.mode, "target");
    assert.equal(attachment.targetType, "folder");
  }
  assert.equal(parsed?.messages[1]?.operationTargetSnapshot?.targets[0]?.path, "My Folder");
});

test("ChatStore autosaves completed and stopped assistant responses", async () => {
  const vault = createMockVault();
  let changeCount = 0;
  const store = new ChatStore(vault as never, () => {
    changeCount += 1;
  });

  store.appendUserMessage("Summarize Alpha.");
  const assistant = store.startAssistantMessage("anthropic", "claude-sonnet-4-6", snapshot);
  store.appendAssistantDelta(assistant.id, "Alpha is ready.");
  await store.completeAssistantMessage(assistant.id, { inputTokens: 10, outputTokens: 3, totalTokens: 13 });

  assert.equal(vault.createdFolders.has("vault-ai-assistant"), true);
  assert.equal(vault.createdFolders.has("vault-ai-assistant/conversations"), true);
  assert.equal(vault.files.size, 1);
  assert.match(Array.from(vault.files.values())[0] ?? "", /Alpha is ready/);

  const stopped = store.startAssistantMessage("openai", "gpt-5.4-mini", snapshot);
  store.appendAssistantDelta(stopped.id, "Partial");
  await store.stopAssistantMessage(stopped.id);

  assert.match(Array.from(vault.files.values())[0] ?? "", /Status: stopped/);
  assert.ok(changeCount > 0);
});

test("ChatStore updates active conversation title and preserves stale conversations", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  const conversationId = store.getState().activeConversation.id;

  assert.equal(await store.updateConversationTitle(conversationId, "Alpha Launch Plan"), true);
  assert.equal(store.getState().activeConversation.title, "Alpha Launch Plan");
  assert.equal(await store.updateConversationTitle("stale-conversation", "Wrong title"), false);
  assert.equal(store.getState().activeConversation.title, "Alpha Launch Plan");

  store.appendUserMessage("Summarize Alpha.");
  const assistant = store.startAssistantMessage("openai", "gpt-5.4-mini", snapshot);
  await store.completeAssistantMessage(assistant.id);
  await store.updateConversationTitle(conversationId, "Saved Alpha Plan");

  const markdown = Array.from(vault.files.values())[0] ?? "";
  assert.match(markdown, /"title": "Saved Alpha Plan"/);
});

test("ChatStore preserves provider errors when final usage arrives", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  const assistant = store.startAssistantMessage("anthropic", "claude-sonnet-4-6", snapshot);

  await store.failAssistantMessage(
    assistant.id,
    "Provider returned an invalid vault operation proposal."
  );
  await store.completeAssistantMessage(assistant.id, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120
  });

  const message = store
    .getState()
    .activeConversation.messages.find((candidate) => candidate.id === assistant.id);

  assert.equal(message?.status, "error");
  assert.equal(message?.error, "Provider returned an invalid vault operation proposal.");
  assert.equal(message?.usage?.totalTokens, 120);
});

test("ChatStore preserves fallback operation errors when final usage arrives", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  const assistant = store.startAssistantMessage("anthropic", "claude-sonnet-4-6", snapshot);
  const error =
    "The provider returned an incomplete Orchestrator Operation proposal. No vault files were changed. Retry the request or ask for fewer file changes.";

  await store.failAssistantMessage(assistant.id, error);
  await store.completeAssistantMessage(assistant.id, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120
  });

  const message = store
    .getState()
    .activeConversation.messages.find((candidate) => candidate.id === assistant.id);

  assert.equal(message?.status, "error");
  assert.equal(message?.error, error);
  assert.equal(message?.usage?.totalTokens, 120);
});

test("ChatStore appends proposals, rejects pending operations, and serializes proposal states", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  store.appendUserMessage("Create a note.");
  const assistant = store.startAssistantMessage("openai", "gpt-5.4-mini", snapshot);

  store.appendAssistantProposal(assistant.id, createProposal());
  await store.rejectOperation(assistant.id, "proposal-1", "operation-1");
  await store.updateOperationStatus(assistant.id, "proposal-1", "operation-2", "applied");
  await store.updateOperationStatus(assistant.id, "proposal-1", "operation-3", "failed", "Note was not found.");

  const message = store.getState().activeConversation.messages.find((candidate) => candidate.id === assistant.id);
  assert.equal(message?.proposals?.[0].operations[0].status, "rejected");
  assert.equal(message?.proposals?.[0].operations[1].status, "applied");
  assert.match(message?.proposals?.[0].operations[1].appliedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(message?.proposals?.[0].operations[0].appliedAt, undefined);
  assert.equal(message?.proposals?.[0].operations[2].status, "failed");
  assert.equal(message?.proposals?.[0].operations[2].appliedAt, undefined);

  const markdown = Array.from(vault.files.values())[0] ?? "";
  assert.match(markdown, /Proposals:/);
  assert.match(markdown, /create_note/);
  assert.match(markdown, /Rejected/);
  assert.match(markdown, /Applied; applied: \d{4}-\d{2}-\d{2}T/);
  assert.match(markdown, /Failed/);
  assert.doesNotMatch(markdown, /Authorization/);
  assert.doesNotMatch(markdown, /x-api-key/);
});

test("ChatStore rejectProposal only rejects pending operations", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  const assistant = store.startAssistantMessage("anthropic", "claude-sonnet-4-6", snapshot);

  store.appendAssistantProposal(assistant.id, createProposal());
  await store.updateOperationStatus(assistant.id, "proposal-1", "operation-2", "applied");
  await store.rejectProposal(assistant.id, "proposal-1");

  const operations = store
    .getState()
    .activeConversation.messages.find((candidate) => candidate.id === assistant.id)
    ?.proposals?.[0].operations;
  assert.equal(operations?.[0].status, "rejected");
  assert.equal(operations?.[1].status, "applied");
  assert.equal(operations?.[2].status, "rejected");
});

test("ChatStore preserves applied, failed, and pending sibling operation states", async () => {
  const vault = createMockVault();
  const store = new ChatStore(vault as never, () => undefined);
  const assistant = store.startAssistantMessage("openai", "gpt-5.4-mini", snapshot);

  store.appendAssistantProposal(assistant.id, createProposal());
  await store.updateOperationStatus(assistant.id, "proposal-1", "operation-1", "applied");
  await store.updateOperationStatus(assistant.id, "proposal-1", "operation-2", "failed", "Destination already exists.");

  const operations = store
    .getState()
    .activeConversation.messages.find((candidate) => candidate.id === assistant.id)
    ?.proposals?.[0].operations;
  assert.equal(operations?.[0].status, "applied");
  assert.equal(operations?.[1].status, "failed");
  assert.equal(operations?.[1].error, "Destination already exists.");
  assert.equal(operations?.[2].status, "pending");
});

test("ChatStore lists saved conversations newest first", async () => {
  const vault = createMockVault();
  vault.files.set(
    "vault-ai-assistant/conversations/older.md",
    serializeConversationToMarkdown({
      id: "older",
      title: "Older chat",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
      saveStatus: "saved",
      messages: []
    })
  );
  vault.files.set(
    "vault-ai-assistant/conversations/newer.md",
    serializeConversationToMarkdown({
      id: "newer",
      title: "Newer chat",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:01:00.000Z",
      saveStatus: "saved",
      messages: []
    })
  );
  vault.files.set("Other/ignored.md", "# Not a chat");

  const store = new ChatStore(vault as never, () => undefined);
  const summaries = await store.listSavedConversations();

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0]?.title, "Newer chat");
  assert.equal(summaries[1]?.title, "Older chat");
});

test("ChatStore prunes saved conversations older than retention window", async () => {
  const vault = createMockVault();
  vault.files.set(
    "vault-ai-assistant/conversations/older.md",
    serializeConversationToMarkdown({
      id: "older",
      title: "Older chat",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
      saveStatus: "saved",
      messages: []
    })
  );
  vault.files.set(
    "vault-ai-assistant/conversations/newer.md",
    serializeConversationToMarkdown({
      id: "newer",
      title: "Newer chat",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:01:00.000Z",
      saveStatus: "saved",
      messages: []
    })
  );
  vault.files.set("vault-ai-assistant/conversations/invalid.md", "# Missing metadata");
  vault.files.set("Other/ignored.md", "# Not a chat");

  const store = new ChatStore(vault as never, () => undefined);
  const deletedCount = await store.pruneSavedConversations(
    7,
    new Date("2026-05-10T00:00:00.000Z")
  );

  assert.equal(deletedCount, 1);
  assert.equal(vault.files.has("vault-ai-assistant/conversations/older.md"), false);
  assert.equal(vault.files.has("vault-ai-assistant/conversations/newer.md"), true);
  assert.equal(vault.files.has("vault-ai-assistant/conversations/invalid.md"), true);
  assert.equal(vault.files.has("Other/ignored.md"), true);
  assert.deepEqual(vault.trashCalls, [
    { path: "vault-ai-assistant/conversations/older.md", system: true }
  ]);
});

test("ChatStore openConversation updates active conversation and rejects invalid markdown", async () => {
  const vault = createMockVault();
  vault.files.set(
    "vault-ai-assistant/conversations/chat.md",
    serializeConversationToMarkdown({
      id: "chat",
      title: "Opened chat",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:01:00.000Z",
      saveStatus: "saved",
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Reopen me",
          createdAt: "2026-05-02T00:00:00.000Z",
          status: "completed"
        }
      ]
    })
  );
  vault.files.set("vault-ai-assistant/conversations/invalid.md", "# Missing metadata");

  const store = new ChatStore(vault as never, () => undefined);
  const opened = await store.openConversation("vault-ai-assistant/conversations/chat.md");

  assert.equal(opened?.title, "Opened chat");
  assert.equal(store.getState().activeConversation.messages[0]?.content, "Reopen me");

  const invalid = await store.openConversation("vault-ai-assistant/conversations/invalid.md");
  assert.equal(invalid, null);
  assert.equal(store.getState().activeConversation.title, "Opened chat");
});

test("VaultContextManager exposes restore helper contracts", () => {
  const source = readFileSync("src/context.ts", "utf8");

  assert.match(source, /restoreSources/);
  assert.match(source, /getRestorableSources/);
  assert.match(source, /getFileByPath/);
  assert.match(source, /getFolderByPath/);
  assert.match(source, /continue;/);
  assert.match(source, /collectMarkdownFiles/);
  assert.match(source, /mode === "target"/);
  assert.match(source, /source\.mode === "target"/);
  assert.match(source, /getRestorableAttachments/);
  assert.match(source, /addTargetFolder/);
  assert.match(source, /addTargetFile/);
  assert.match(source, /isAssistantOwnedPath/);
  assert.match(source, /Vault AI Assistant files cannot be added as context\./);
  assert.match(source, /clearSources/);
});

function createProposal(): VaultOperationProposal {
  return {
    id: "proposal-1",
    summary: "Prepare notes",
    createdAt: "2026-05-02T00:00:00.000Z",
    operations: [
      {
        id: "operation-1",
        type: "create_note",
        path: "Notes/New.md",
        description: "Create a note",
        status: "pending",
        content: "# New"
      },
      {
        id: "operation-2",
        type: "modify_note",
        path: "Notes/Existing.md",
        description: "Modify a note",
        status: "pending",
        previousContent: "old",
        newContent: "new"
      },
      {
        id: "operation-3",
        type: "append_note",
        path: "Notes/Log.md",
        description: "Append a note",
        status: "pending",
        content: "- next",
        appendMode: "end"
      }
    ]
  };
}

function createMockVault() {
  const files = new Map<string, string>();
  const createdFolders = new Set<string>();
  const trashCalls: Array<{ path: string; system: boolean }> = [];

  return {
    files,
    createdFolders,
    trashCalls,
    getFolderByPath(path: string) {
      return createdFolders.has(path) ? { path } : null;
    },
    async createFolder(path: string) {
      createdFolders.add(path);
      return { path };
    },
    getFileByPath(path: string) {
      return files.has(path) ? { path } : null;
    },
    getMarkdownFiles() {
      return Array.from(files.keys())
        .filter((path) => path.endsWith(".md"))
        .map((path) => ({ path }));
    },
    async cachedRead(file: { path: string }) {
      return files.get(file.path) ?? "";
    },
    async create(path: string, data: string) {
      files.set(path, data);
      return { path };
    },
    async modify(file: { path: string }, data: string) {
      files.set(file.path, data);
    },
    async trash(file: { path: string }, system: boolean) {
      trashCalls.push({ path: file.path, system });
      files.delete(file.path);
    }
  };
}
