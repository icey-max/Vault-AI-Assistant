import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ContextPackage } from "../src/context-utils";
import { ChatEvent, ChatRequest } from "../src/chat-types";
import { sanitizeDiagnosticValue } from "../src/diagnostics";
import { AnthropicChatAdapter } from "../src/providers/anthropic-adapter";
import { OpenAIChatAdapter } from "../src/providers/openai-adapter";
import { VAULT_EDITOR_SYSTEM_PROMPT } from "../src/system-prompts";

interface DiagnosticLogEntry {
  event: string;
  details?: Record<string, unknown>;
}

const contextPackage: ContextPackage = {
  files: [
    {
      path: "Notes/Alpha.md",
      content: "Alpha context",
      charCount: 13,
      estimatedTokens: 4,
      sourceIds: ["note:Notes/Alpha.md"]
    },
    {
      path: "Folder/Beta.md",
      content: "Beta folder context",
      charCount: 19,
      estimatedTokens: 5,
      sourceIds: ["folder:Folder"]
    }
  ],
  totalCharacters: 32,
  totalEstimatedTokens: 9,
  sourceIds: ["note:Notes/Alpha.md", "folder:Folder"]
};

test("OpenAIChatAdapter normalizes response.created, response.output_text.delta, and response.completed", async () => {
  let capturedBody = "";
  const adapter = new OpenAIChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
        'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n'
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(adapter.stream(createRequest(), new AbortController().signal));

  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "delta", "delta", "done"]
  );
  assert.equal(events.filter((event) => event.type === "delta").map((event) => event.text).join(""), "Hello world");
  assert.equal((events[3] as Extract<ChatEvent, { type: "done" }>).usage?.totalTokens, 12);

  const body = JSON.parse(capturedBody);
  const expectedBodyFields = { store: false, stream: true };
  assert.equal(body.store, expectedBodyFields.store);
  assert.equal(body.stream, true);
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.tools, undefined);
  assert.match(capturedBody, /Alpha context/);
  assert.doesNotMatch(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /Unrelated/);
  assert.doesNotMatch(capturedBody, /openai-secret/);
});

test("AnthropicChatAdapter normalizes message_start, content_block_delta, message_delta, and message_stop", async () => {
  let capturedBody = "";
  const adapter = new AnthropicChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" Claude"}}\n\n',
        'data: {"type":"message_delta","usage":{"input_tokens":8,"output_tokens":3}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream({ ...createRequest(), provider: "anthropic", model: "claude-sonnet-4-6" }, new AbortController().signal)
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "delta", "delta", "done"]
  );
  assert.equal(events.filter((event) => event.type === "delta").map((event) => event.text).join(""), "Hello Claude");
  assert.equal((events[3] as Extract<ChatEvent, { type: "done" }>).usage?.totalTokens, 11);

  const body = JSON.parse(capturedBody);
  assert.equal(body.stream, true);
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 1000);
  assert.equal(body.tools, undefined);
  assert.match(capturedBody, /Alpha context/);
  assert.doesNotMatch(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /Unrelated/);
});

test("provider adapters apply configured max output token budget", async () => {
  let openAIBody = "";
  const openAI = new OpenAIChatAdapter(async (_input, init) => {
    openAIBody = String(init.body);
    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });
  await collectEvents(
    openAI.stream({ ...createRequest(), maxOutputTokens: 6000 }, new AbortController().signal)
  );

  let anthropicBody = "";
  const anthropic = new AnthropicChatAdapter(async (_input, init) => {
    anthropicBody = String(init.body);
    return new Response(
      streamText([sse({ type: "message_start", message: { id: "msg_1" } }), sse({ type: "message_stop" })]),
      { status: 200 }
    );
  });
  await collectEvents(
    anthropic.stream(
      { ...createRequest(), provider: "anthropic", model: "claude-sonnet-4-6", maxOutputTokens: 6000 },
      new AbortController().signal
    )
  );

  assert.equal(JSON.parse(openAIBody).max_output_tokens, 6000);
  assert.equal(JSON.parse(anthropicBody).max_tokens, 6000);
});

test("AnthropicChatAdapter expands operation budget and surfaces truncated tool input", async () => {
  let capturedBody = "";
  const adapter = new AnthropicChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_vault_operations",
            input: {}
          }
        }),
        sse({
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json:
              "{\"summary\":\"Create homepages\",\"operations\":[{\"type\":\"create_note\",\"path\":\"Books/The 48 Laws of Power/Home.md\",\"description\":\"Create homepage\",\"content\":\"# The 48 Laws"
          }
        }),
        sse({
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { input_tokens: 2075, output_tokens: 8000 }
        }),
        sse({ type: "message_stop" })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(
      {
        ...createTargetOnlyRequest("Books", "Can you create a homepage in each one of them?"),
        provider: "anthropic",
        model: "claude-haiku-4-5"
      },
      new AbortController().signal
    )
  );

  const body = JSON.parse(capturedBody);
  const error = events.find((event): event is Extract<ChatEvent, { type: "error" }> => event.type === "error");
  assert.equal(body.max_tokens, 8000);
  assert.deepEqual(events.map((event) => event.type), ["start", "error"]);
  assert.match(error?.message ?? "", /stopped before finishing the Orchestrator Operation proposal/);
  assert.match(error?.message ?? "", /No vault files were changed/);
});

test("provider request history includes prior proposal operation paths", async () => {
  const priorProposalMessage: ChatRequest["messages"][number] = {
    id: "assistant-1",
    role: "assistant",
    content: "",
    createdAt: "2026-05-03T20:00:00.000Z",
    status: "completed",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    proposals: [
      {
        id: "proposal-1",
        summary: "Create Robert Greene book folders",
        createdAt: "2026-05-03T20:00:00.000Z",
        operations: [
          {
            id: "operation-1",
            type: "create_folder",
            path: "Books/The 48 Laws of Power",
            description: "Create folder",
            status: "applied"
          },
          {
            id: "operation-2",
            type: "create_folder",
            path: "Books/The Art of Seduction",
            description: "Create folder",
            status: "applied"
          },
          {
            id: "operation-3",
            type: "create_folder",
            path: "Books/Mastery",
            description: "Create folder",
            status: "applied"
          },
          {
            id: "operation-4",
            type: "move_note",
            path: "Books/Mastery/Old.md",
            sourcePath: "Books/Mastery/Old.md",
            destinationPath: "Books/Mastery/Homepage.md",
            description: "Move note",
            status: "pending"
          }
        ]
      }
    ]
  };
  const request = {
    ...createTargetOnlyRequest("Books", "Can you create a homepage in each one of them?"),
    messages: [priorProposalMessage]
  };

  let openAIBody = "";
  const openAI = new OpenAIChatAdapter(async (_input, init) => {
    openAIBody = String(init.body);
    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });
  await collectEvents(openAI.stream(request, new AbortController().signal));

  let anthropicBody = "";
  const anthropic = new AnthropicChatAdapter(async (_input, init) => {
    anthropicBody = String(init.body);
    return new Response(
      streamText([sse({ type: "message_start", message: { id: "msg_1" } }), sse({ type: "message_stop" })]),
      { status: 200 }
    );
  });
  await collectEvents(
    anthropic.stream(
      { ...request, provider: "anthropic", model: "claude-haiku-4-5" },
      new AbortController().signal
    )
  );

  for (const body of [openAIBody, anthropicBody]) {
    assert.match(body, /Previously proposed vault operations/);
    assert.match(body, /Only operations marked applied were written to the vault/);
    assert.match(body, /Use these operation paths to resolve obvious follow-up references/);
    assert.match(body, /ask a brief clarification if multiple referents are plausible/);
    assert.match(body, /Create Robert Greene book folders/);
    assert.match(body, /create_folder: Books\/The 48 Laws of Power \(applied\)/);
    assert.match(body, /create_folder: Books\/The Art of Seduction \(applied\)/);
    assert.match(body, /create_folder: Books\/Mastery \(applied\)/);
    assert.match(body, /move_note: Books\/Mastery\/Old\.md -> Books\/Mastery\/Homepage\.md \(pending\)/);
  }
});

test("provider requests serialize edit target hints without target-only child content", async () => {
  let openAIBody = "";
  const openAI = new OpenAIChatAdapter(async (_input, init) => {
    openAIBody = String(init.body);
    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });
  await collectEvents(openAI.stream(createTargetOnlyRequest(), new AbortController().signal));

  assert.match(openAIBody, /Available edit target hints:/);
  assert.match(openAIBody, /Edit target folder: My Folder/);
  assert.match(openAIBody, /Runtime Orchestrator Operation Protocol/);
  assert.match(openAIBody, /Every operation must use the `type` field, never `action`/);
  assert.match(openAIBody, /Never print fake tool calls/);
  assert.doesNotMatch(openAIBody, /Secret child content/);

  let anthropicBody = "";
  const anthropic = new AnthropicChatAdapter(async (_input, init) => {
    anthropicBody = String(init.body);
    return new Response(streamText([sse({ type: "message_start", message: { id: "msg_1" } }), sse({ type: "message_stop" })]), {
      status: 200
    });
  });
  await collectEvents(
    anthropic.stream(
      { ...createTargetOnlyRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );

  assert.match(anthropicBody, /Available edit target hints:/);
  assert.match(anthropicBody, /Edit target folder: My Folder/);
  assert.match(anthropicBody, /Runtime Orchestrator Operation Protocol/);
  assert.match(anthropicBody, /Every operation must use the `type` field, never `action`/);
  assert.match(anthropicBody, /Never print fake tool calls/);
  assert.doesNotMatch(anthropicBody, /Secret child content/);
});

test("provider requests serialize Books edit target hints without target-only child content", async () => {
  let openAIBody = "";
  const openAI = new OpenAIChatAdapter(async (_input, init) => {
    openAIBody = String(init.body);
    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });
  await collectEvents(
    openAI.stream(createTargetOnlyRequest("Books", "Yes create them"), new AbortController().signal)
  );

  assert.match(openAIBody, /Edit target folder: Books \(contents not included\)/);
  assert.match(openAIBody, /Runtime Orchestrator Operation Protocol/);
  assert.doesNotMatch(openAIBody, /Secret child content/);

  let anthropicBody = "";
  const anthropic = new AnthropicChatAdapter(async (_input, init) => {
    anthropicBody = String(init.body);
    return new Response(streamText([sse({ type: "message_start", message: { id: "msg_1" } }), sse({ type: "message_stop" })]), {
      status: 200
    });
  });
  await collectEvents(
    anthropic.stream(
      {
        ...createTargetOnlyRequest("Books", "Yes create them"),
        provider: "anthropic",
        model: "claude-sonnet-4-6"
      },
      new AbortController().signal
    )
  );

  assert.match(anthropicBody, /Edit target folder: Books \(contents not included\)/);
  assert.match(anthropicBody, /Runtime Orchestrator Operation Protocol/);
  assert.doesNotMatch(anthropicBody, /Secret child content/);
});

test("provider request history strips raw Orchestrator Operation text blocks", async () => {
  const rawAssistantText = [
    "I'll propose the edit.",
    "",
    "<vault_operation>",
    "{\"operations\":[{\"type\":\"create\",\"path\":\"My Folder/zzz.md\",\"content\":\"\"}]}",
    "</vault_operation>",
    "",
    "Review the proposal."
  ].join("\n");
  let openAIBody = "";
  const openAI = new OpenAIChatAdapter(async (_input, init) => {
    openAIBody = String(init.body);
    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });
  await collectEvents(
    openAI.stream(
      {
        ...createRequest(),
        messages: [
          { id: "m1", role: "assistant", content: rawAssistantText, createdAt: "2026-05-01T00:00:00.000Z" }
        ]
      },
      new AbortController().signal
    )
  );

  assert.doesNotMatch(openAIBody, /<function_?calls|<tooluse|<vault_operation|My Folder\/zzz\.md/);
  assert.match(openAIBody, /I'll propose the edit/);

  let anthropicBody = "";
  const anthropic = new AnthropicChatAdapter(async (_input, init) => {
    anthropicBody = String(init.body);
    return new Response(streamText([sse({ type: "message_start", message: { id: "msg_1" } }), sse({ type: "message_stop" })]), {
      status: 200
    });
  });
  await collectEvents(
    anthropic.stream(
      {
        ...createRequest(),
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        messages: [
          { id: "m1", role: "assistant", content: rawAssistantText, createdAt: "2026-05-01T00:00:00.000Z" }
        ]
      },
      new AbortController().signal
    )
  );

  assert.doesNotMatch(anthropicBody, /<function_?calls|<tooluse|<vault_operation|My Folder\/zzz\.md/);
  assert.match(anthropicBody, /I'll propose the edit/);
});

test("createVaultOperationSystemPrompt preserves grounding and approval rules", () => {
  const prompt = VAULT_EDITOR_SYSTEM_PROMPT;

  assert.match(prompt, /explicitly served by the user/);
  assert.match(prompt, /Only propose vault operations when the user explicitly asks/);
  assert.match(prompt, /Delete, move\/rename, and copy-note operations are supported/);
  assert.match(prompt, /create_folder/);
  assert.match(prompt, /move_note/);
  assert.match(prompt, /delete_folder/);
  assert.match(prompt, /folder copy is not supported in this alpha/);
  assert.match(prompt, /Never say a file has been created/);
  assert.match(prompt, /propose_vault_operations/);
  assert.match(prompt, /answer normally without a proposal/);
});

test("cross-provider consistency: OpenAIChatAdapter normalizes response.function_call_arguments.done into proposal events", async () => {
  let capturedBody = "";
  const proposalArguments = JSON.stringify({
    summary: "Prepare notes",
    operations: [
      {
        type: "create_note",
        path: "Notes/New.md",
        description: "Create a new note",
        content: "# New"
      },
        {
          type: "modify_note",
          path: "Notes/Alpha.md",
          description: "Modify a note",
          previousContent: "old",
          newContent: "new"
      },
      {
        type: "append_note",
        path: "Notes/Log.md",
        description: "Append a note",
        content: "- next"
      }
    ]
  });
  const adapter = new OpenAIChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: proposalArguments
        }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(createVaultOperationRequest(), new AbortController().signal)
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  assert.equal(proposal.proposal.operations.length, 3);
  assert.deepEqual(
    proposal.proposal.operations.map((operation) => operation.type),
    ["create_note", "modify_note", "append_note"]
  );

  const body = JSON.parse(capturedBody);
  assert.ok(Array.isArray(body.tools));
  assert.deepEqual(body.tool_choice, {
    type: "function",
    name: "propose_vault_operations"
  });
  assert.equal(body.parallel_tool_calls, false);
  const openAITool = body.tools[0];
  const openAIParameters = openAITool.parameters;
  const openAIOperations = openAIParameters.properties.operations;
  const openAIOperationItems = openAIOperations.items;
  assert.equal(openAITool.strict, true);
  assert.deepEqual(openAIParameters.required, ["summary", "operations"]);
  assert.equal(openAIOperations.minItems, undefined);
  assert.deepEqual(
    openAIOperationItems.required,
    Object.keys(openAIOperationItems.properties)
  );
  assert.ok(openAIOperationItems.required.includes("id"));
  assert.deepEqual(openAIOperationItems.properties.id.type, ["string", "null"]);
  assert.deepEqual(openAIOperationItems.properties.appendMode.enum, ["end", null]);
  assert.match(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
});

test("OpenAIChatAdapter expands create_note proposals from attached template context", async () => {
  const proposalArguments = JSON.stringify({
    summary: "Create strategy note from template",
    operations: [
      {
        type: "create_note",
        path: "Notes/Strategy 1.md",
        templatePath: "Notes/Template.md",
        title: "Strategy 1",
        description: "Create strategy note from template"
      }
    ]
  });
  const adapter = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: proposalArguments
        }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    )
  );

  const events = await collectEvents(
    adapter.stream(createTemplateOperationRequest(), new AbortController().signal)
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  const operation = proposal.proposal.operations[0];
  assert.equal(operation.type, "create_note");
  if (operation.type !== "create_note") {
    return;
  }
  assert.equal(operation.content, "# Strategy 1\n\n## Summary\n");
});

test("OpenAIChatAdapter surfaces blank operation completions as recovery errors", async () => {
  const logs: DiagnosticLogEntry[] = [];
  const adapter = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    )
  );

  const events = await collectEvents(
    adapter.stream(
      {
        ...createVaultOperationRequest(),
        diagnostics: createDiagnostics(logs),
        diagnosticRequestId: "diag-blank"
      },
      new AbortController().signal
    )
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "error"]
  );
  const error = events.find((event): event is Extract<ChatEvent, { type: "error" }> => event.type === "error");
  assert.match(error?.message ?? "", /without returning an Orchestrator Operation proposal/);
  assert.match(error?.message ?? "", /No vault files were changed/);
  assert.ok(logs.some((entry) => entry.event === "openai.operation_missing"));
  assert.ok(logs.some((entry) => entry.event === "openai.tool_schema"));
});

test("OpenAIChatAdapter accepts unnamed function argument completion for forced operation tools", async () => {
  const proposalArguments = JSON.stringify({
    summary: "Prepare notes",
    operations: [
      {
        type: "create_note",
        path: "Notes/New.md",
        description: "Create a new note",
        content: "# New"
      }
    ]
  });
  const adapter = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          arguments: proposalArguments
        }),
        sse({
          type: "response.output_item.done",
          item: {
            type: "function_call",
            name: "propose_vault_operations",
            arguments: proposalArguments
          }
        }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    )
  );

  const events = await collectEvents(
    adapter.stream(createVaultOperationRequest(), new AbortController().signal)
  );
  const proposalEvents = events.filter(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "proposal", "done"]
  );
  assert.equal(proposalEvents.length, 1);
  assert.equal(proposalEvents[0]?.proposal.operations[0]?.path, "Notes/New.md");
});

test("OpenAIChatAdapter emits redacted diagnostics for operation streams", async () => {
  const logs: DiagnosticLogEntry[] = [];
  const proposalArguments = JSON.stringify({
    summary: "Prepare notes",
    operations: [
      {
        type: "create_note",
        path: "Notes/New.md",
        description: "Create a new note",
        content: "# Very private note text"
      }
    ]
  });
  const adapter = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: proposalArguments
        }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    )
  );

  const events = await collectEvents(
    adapter.stream(
      {
        ...createVaultOperationRequest(),
        apiKey: "sk-proj-testsecret123456789",
        diagnostics: createDiagnostics(logs),
        diagnosticRequestId: "diag-valid"
      },
      new AbortController().signal
    )
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");
  const eventNames = new Set(logs.map((entry) => entry.event));
  const toolSchema = logs.find((entry) => entry.event === "openai.tool_schema");
  const proposalLog = logs.find((entry) => entry.event === "openai.proposal_validated");
  const serializedLogs = JSON.stringify(logs);

  assert.ok(proposal);
  assert.ok(eventNames.has("openai.request"));
  assert.ok(eventNames.has("openai.response"));
  assert.ok(eventNames.has("openai.stream_event"));
  assert.ok(eventNames.has("openai.function_arguments_done"));
  assert.equal(toolSchema?.details?.operationRequiredIncludesId, true);
  assert.deepEqual(proposalLog?.details?.operationTypes, ["create_note"]);
  assert.deepEqual(proposalLog?.details?.operationPaths, ["Notes/New.md"]);
  assert.doesNotMatch(serializedLogs, /sk-proj-testsecret123456789/);
  assert.doesNotMatch(serializedLogs, /Very private note text/);
});

test("diagnostic sanitizer keeps paths and counts while redacting secrets and content", () => {
  assert.deepEqual(
    sanitizeDiagnosticValue({
      contextFileCount: 1,
      contextPaths: ["Notes/Alpha.md"],
      operationTargetPaths: ["Books"],
      apiKey: "sk-proj-testsecret123456789",
      content: "# Hidden note body",
      text: "Hidden prompt text"
    }),
    {
      contextFileCount: 1,
      contextPaths: ["Notes/Alpha.md"],
      operationTargetPaths: ["Books"],
      apiKey: "[redacted]",
      content: "[redacted]",
      text: "[redacted]"
    }
  );
});

test("cross-provider consistency: native tools normalize expanded operation proposals", async () => {
  const expandedOperations = [
    {
      type: "move_note",
      path: "Notes/Alpha.md",
      sourcePath: "Notes/Alpha.md",
      destinationPath: "Notes/Archive/Alpha.md",
      description: "Move Alpha"
    },
    {
      type: "move_folder",
      path: "Notes/Project",
      sourcePath: "Notes/Project",
      destinationPath: "Notes/Project Archive",
      description: "Move project folder"
    },
    {
      type: "copy_note",
      path: "Folder/Beta.md",
      sourcePath: "Folder/Beta.md",
      destinationPath: "Notes/Beta Copy.md",
      description: "Copy Beta"
    },
    {
      type: "delete_folder",
      path: "Notes/Old Folder",
      description: "Delete old folder"
    }
  ];
  const openAI = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: JSON.stringify({
            summary: "Expanded operation set",
            operations: expandedOperations
          })
        })
      ]),
      { status: 200 }
    )
  );
  const openAIEvents = await collectEvents(
    openAI.stream(createVaultOperationRequest(), new AbortController().signal)
  );
  const openAIProposal = openAIEvents.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(openAIProposal);
  assert.deepEqual(
    openAIProposal.proposal.operations.map((operation) => operation.type),
    ["move_note", "move_folder", "copy_note", "delete_folder"]
  );

  const anthropic = new AnthropicChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_vault_operations",
            input: {
              summary: "Expanded operation set",
              operations: expandedOperations
            }
          }
        }),
        sse({ type: "content_block_stop", index: 0 })
      ]),
      { status: 200 }
    )
  );
  const anthropicEvents = await collectEvents(
    anthropic.stream(
      { ...createVaultOperationRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );
  const anthropicProposal = anthropicEvents.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(anthropicProposal);
  assert.deepEqual(
    anthropicProposal.proposal.operations.map((operation) => operation.type),
    ["move_note", "move_folder", "copy_note", "delete_folder"]
  );
});

test("repair behavior: OpenAIChatAdapter repairs one invalid Orchestrator Operation payload into a proposal", async () => {
  const bodies: string[] = [];
  const adapter = new OpenAIChatAdapter(async (_input, init) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) {
      return new Response(
        streamText([
          sse({ type: "response.created", response: { id: "resp_1" } }),
          sse({
            type: "response.function_call_arguments.done",
            name: "propose_vault_operations",
            arguments: JSON.stringify({
              summary: "Repair aliases",
              operations: [{ type: "modify", path: "Notes/Existing.md", description: "Missing fields" }]
            })
          }),
          sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
        ]),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          summary: "Repair aliases",
          operations: [
            {
              type: "modify",
              path: "Notes/Alpha.md",
              description: "Repair a note",
              previousContent: "old",
              newContent: "new"
            }
          ]
        })
      }),
      { status: 200 }
    );
  });

  const events = await collectEvents(adapter.stream(createVaultOperationRequest(), new AbortController().signal));
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  assert.equal(proposal.proposal.operations[0].type, "modify_note");
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /Return valid Orchestrator Operation JSON only/);
  assert.doesNotMatch(bodies[1], /test-api-key/);
});

test("AnthropicChatAdapter hydrates context-backed modify content without repair", async () => {
  let requestCount = 0;
  const adapter = new AnthropicChatAdapter(async () => {
    requestCount += 1;
    return new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_vault_operations",
            input: {
              summary: "Restructure note",
              operations: [
                {
                  type: "modify",
                  path: "Notes/Alpha.md",
                  description: "Replace the note with a tiered structure",
                  content: "# Alpha\n\n## Top 10\n- Revolver"
                }
              ]
            }
          }
        }),
        sse({ type: "content_block_stop", index: 0 }),
        sse({ type: "message_stop" })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(
      { ...createVaultOperationRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  assert.equal(requestCount, 1);
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "proposal", "done"]
  );
  const operation = proposal.proposal.operations[0];
  assert.equal(operation.type, "modify_note");
  if (operation.type === "modify_note") {
    assert.equal(operation.previousContent, "Alpha context");
    assert.equal(operation.newContent, "# Alpha\n\n## Top 10\n- Revolver");
  }
});

test("OpenAIChatAdapter allows out-of-context modify targets for approval review", async () => {
  const adapter = new OpenAIChatAdapter(async (_input, init) => {
    const body = String(init.body);
    if (!body.includes('"stream":true')) {
      return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: "Still bad", operations: [] }) }), {
        status: 200
      });
    }

    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: JSON.stringify({
            summary: "Hidden edit",
            operations: [
              {
                type: "modify_note",
                path: "Notes/Hidden.md",
                description: "Modify hidden note",
                previousContent: "old",
                newContent: "new"
              }
            ]
          })
        })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(adapter.stream(createVaultOperationRequest(), new AbortController().signal));

  const proposal = events.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(proposal);
  assert.equal(proposal.proposal.operations[0].path, "Notes/Hidden.md");
  assert.equal(events.some((event) => event.type === "error"), false);
});

test("provider adapters allow scope-only folder create proposals and hidden full modify proposals", async () => {
  const createArguments = JSON.stringify({
    summary: "Create scoped note",
    operations: [
      {
        type: "create_note",
        path: "Books/mmm.md",
        description: "Create note in scoped folder",
        content: "# Mmm"
      }
    ]
  });
  const openAI = new OpenAIChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: createArguments
        })
      ]),
      { status: 200 }
    )
  );
  const openAIEvents = await collectEvents(
    openAI.stream(createTargetOnlyRequest("Books", "Yes create them"), new AbortController().signal)
  );
  const openAIProposal = openAIEvents.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(openAIProposal);
  assert.equal(openAIProposal.proposal.operations[0].path, "Books/mmm.md");

  const anthropic = new AnthropicChatAdapter(async () =>
    new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_vault_operations",
            input: {
              summary: "Create scoped note",
              operations: [
                {
                  type: "create_note",
                  path: "Books/mmm.md",
                  description: "Create note in scoped folder",
                  content: "# Mmm"
                }
              ]
            }
          }
        }),
        sse({ type: "content_block_stop", index: 0 })
      ]),
      { status: 200 }
    )
  );
  const anthropicEvents = await collectEvents(
    anthropic.stream(
      {
        ...createTargetOnlyRequest("Books", "Yes create them"),
        provider: "anthropic",
        model: "claude-sonnet-4-6"
      },
      new AbortController().signal
    )
  );
  const anthropicProposal = anthropicEvents.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(anthropicProposal);
  assert.equal(anthropicProposal.proposal.operations[0].path, "Books/mmm.md");

  const hiddenModify = new OpenAIChatAdapter(async (_input, init) => {
    const body = String(init.body);
    if (!body.includes('"stream":true')) {
      return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: "Still bad", operations: [] }) }), {
        status: 200
      });
    }

    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({
          type: "response.function_call_arguments.done",
          name: "propose_vault_operations",
          arguments: JSON.stringify({
            summary: "Hidden rewrite",
            operations: [
              {
                type: "modify_note",
                path: "My Folder/Secret.md",
                description: "Rewrite scope-only note",
                previousContent: "old",
                newContent: "new"
              }
            ]
          })
        })
      ]),
      { status: 200 }
    );
  });
  const hiddenEvents = await collectEvents(
    hiddenModify.stream(createTargetOnlyRequest(), new AbortController().signal)
  );
  const hiddenProposal = hiddenEvents.find(
    (event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal"
  );
  assert.ok(hiddenProposal);
  assert.equal(hiddenProposal.proposal.operations[0].path, "My Folder/Secret.md");
  assert.equal(hiddenEvents.some((event) => event.type === "error"), false);
});

test("OpenAIChatAdapter sends persisted image attachments as Responses content blocks", async () => {
  let capturedBody = "";
  const adapter = new OpenAIChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        sse({ type: "response.created", response: { id: "resp_1" } }),
        sse({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
      ]),
      { status: 200 }
    );
  });

  await collectEvents(adapter.stream(createImageRequest(), new AbortController().signal));

  const body = JSON.parse(capturedBody);
  const finalMessage = body.input.at(-1);
  assert.equal(finalMessage.role, "user");
  assert.deepEqual(finalMessage.content[0], {
    type: "input_image",
    image_url: "data:image/png;base64,ZmFrZS1wbmc=",
    detail: "auto"
  });
  assert.equal(finalMessage.content[1].type, "input_text");
  assert.match(finalMessage.content[1].text, /Alpha context/);
  assert.match(finalMessage.content[1].text, /Use the note/);
  assert.equal(body.tools, undefined);
  assert.doesNotMatch(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /Unrelated/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
});

test("cross-provider consistency: AnthropicChatAdapter normalizes input_json_delta tool use into proposal events", async () => {
  let capturedBody = "";
  const firstChunk = '{"summary":"Append log","operations":[';
  const secondChunk =
    '{"type":"append_note","path":"Notes/Log.md","description":"Append a note","content":"- next"}]}';
  const adapter = new AnthropicChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "propose_vault_operations", input: {} }
        }),
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: firstChunk }
        }),
        sse({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: secondChunk }
        }),
        sse({ type: "content_block_stop", index: 0 }),
        sse({ type: "message_stop" })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(
      { ...createVaultOperationRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  assert.equal(proposal.proposal.operations[0].type, "append_note");

  const body = JSON.parse(capturedBody);
  assert.ok(Array.isArray(body.tools));
  assert.deepEqual(body.tool_choice, {
    type: "tool",
    name: "propose_vault_operations",
    disable_parallel_tool_use: true
  });
  assert.match(JSON.stringify(body.tools[0]), /input_schema/);
  assert.deepEqual(body.tools[0].input_schema.properties.operations.items.required, [
    "type",
    "path",
    "description"
  ]);
  assert.equal(body.tools[0].input_schema.properties.operations.minItems, 1);
  assert.match(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
});

test("AnthropicChatAdapter accepts modify proposals for folder-included context targets", async () => {
  const adapter = new AnthropicChatAdapter(async () => {
    return new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_vault_operations",
            input: {
              summary: "Modify folder context",
              operations: [
                {
                  type: "modify_note",
                  path: "Folder/Beta.md",
                  description: "Modify folder note",
                  previousContent: "old",
                  newContent: "new"
                }
              ]
            }
          }
        }),
        sse({ type: "content_block_stop", index: 0 }),
        sse({ type: "message_stop" })
      ]),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(
      { ...createVaultOperationRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );
  const proposal = events.find((event): event is Extract<ChatEvent, { type: "proposal" }> => event.type === "proposal");

  assert.ok(proposal);
  assert.equal(proposal.proposal.operations[0].path, "Folder/Beta.md");
});

test("raw tool leakage: AnthropicChatAdapter returns one clean Orchestrator Operation error after failed repair", async () => {
  const bodies: string[] = [];
  const adapter = new AnthropicChatAdapter(async (_input, init) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) {
      return new Response(
        streamText([
          sse({ type: "message_start", message: { id: "msg_1" } }),
          sse({
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "toolu_1",
              name: "propose_vault_operations",
              input: {
                summary: "Bad operation",
                operations: [{ type: "modify", path: "Notes/Existing.md", description: "Missing fields" }]
              }
            }
          }),
          sse({ type: "content_block_stop", index: 0 }),
          sse({ type: "message_stop" })
        ]),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ summary: "Still bad", operations: [] }) }]
      }),
      { status: 200 }
    );
  });

  const events = await collectEvents(
    adapter.stream(
      { ...createVaultOperationRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );
  const error = events.find((event): event is Extract<ChatEvent, { type: "error" }> => event.type === "error");
  const assistantText = events.filter((event) => event.type === "delta").map((event) => event.text).join("");

  assert.match(error?.message ?? "", /Provider returned an invalid Orchestrator Operation proposal\./);
  assert.match(error?.message ?? "", /previousContent and newContent|at least one operation/);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /Return valid Orchestrator Operation JSON only/);
  assert.doesNotMatch(assistantText, /<function_calls>|<atml:invoke/);
});

test("AnthropicChatAdapter sends persisted image attachments as Messages content blocks", async () => {
  let capturedBody = "";
  const adapter = new AnthropicChatAdapter(async (_input, init) => {
    capturedBody = String(init.body);

    return new Response(
      streamText([
        sse({ type: "message_start", message: { id: "msg_1" } }),
        sse({ type: "message_stop" })
      ]),
      { status: 200 }
    );
  });

  await collectEvents(
    adapter.stream(
      { ...createImageRequest(), provider: "anthropic", model: "claude-sonnet-4-6" },
      new AbortController().signal
    )
  );

  const body = JSON.parse(capturedBody);
  const finalMessage = body.messages.at(-1);
  assert.equal(finalMessage.role, "user");
  assert.deepEqual(finalMessage.content[0], {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: "ZmFrZS1wbmc="
    }
  });
  assert.equal(finalMessage.content[1].type, "text");
  assert.match(finalMessage.content[1].text, /Alpha context/);
  assert.match(finalMessage.content[1].text, /Use the note/);
  assert.equal(body.tools, undefined);
  assert.doesNotMatch(capturedBody, /propose_vault_operations/);
  assert.doesNotMatch(capturedBody, /Unrelated/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
});

test("provider model options use current predefined defaults", () => {
  const source = readFileSync("src/model-options.ts", "utf8");

  for (const model of [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5"
  ]) {
    assert.match(source, new RegExp(escapeRegExp(model)));
  }

  for (const staleModel of ["claude-sonnet-4-0", "gpt-5-mini"]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(staleModel)));
  }
});

test("provider adapters require an explicit Obsidian-safe transport", () => {
  const openAISource = readFileSync("src/providers/openai-adapter.ts", "utf8");
  const anthropicSource = readFileSync("src/providers/anthropic-adapter.ts", "utf8");

  assert.match(openAISource, /constructor\(fetchImpl: ChatFetch\)/);
  assert.match(anthropicSource, /constructor\(fetchImpl: ChatFetch\)/);
  assert.doesNotMatch(openAISource, /globalThis\.fetch|window\.fetch|\bfetch\s*\(/);
  assert.doesNotMatch(anthropicSource, /globalThis\.fetch|window\.fetch|\bfetch\s*\(/);
});

test("OpenAIChatAdapter surfaces sanitized provider HTTP errors", async () => {
  const adapter = new OpenAIChatAdapter(async () => {
    return new Response(
      JSON.stringify({
        error: {
          message: "The model gpt-old does not exist for sk-testsecret123456789.",
          type: "invalid_request_error",
          code: "model_not_found",
          param: "model"
        }
      }),
      { status: 400 }
    );
  });

  const events = await collectEvents(adapter.stream(createRequest(), new AbortController().signal));
  const error = events[0] as Extract<ChatEvent, { type: "error" }>;

  assert.equal(error.type, "error");
  assert.match(error.message, /OpenAI rejected the request/);
  assert.match(error.message, /model_not_found/);
  assert.doesNotMatch(error.message, /sk-testsecret/);
});

test("AnthropicChatAdapter surfaces sanitized provider HTTP errors", async () => {
  const adapter = new AnthropicChatAdapter(async () => {
    return new Response(
      JSON.stringify({
        error: {
          message: "model: claude-old is not a valid model for sk-ant-testsecret123456789",
          type: "invalid_request_error"
        }
      }),
      { status: 400 }
    );
  });

  const events = await collectEvents(
    adapter.stream({ ...createRequest(), provider: "anthropic", model: "claude-sonnet-4-6" }, new AbortController().signal)
  );
  const error = events[0] as Extract<ChatEvent, { type: "error" }>;

  assert.equal(error.type, "error");
  assert.match(error.message, /Anthropic rejected the request/);
  assert.match(error.message, /claude-old/);
  assert.doesNotMatch(error.message, /sk-ant-testsecret/);
});

test("provider HTTP errors map auth, rate limit, and request_too_large recovery copy", async () => {
  const cases: Array<{
    name: string;
    adapter: OpenAIChatAdapter | AnthropicChatAdapter;
    expected: RegExp;
  }> = [
    {
      name: "openai-authentication",
      adapter: new OpenAIChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Incorrect API key sk-proj-testsecret123456789.",
              type: "invalid_request_error"
            }
          }),
          { status: 401 }
        )
      ),
      expected: /OpenAI authentication failed/
    },
    {
      name: "openai-rate-limit",
      adapter: new OpenAIChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Too many requests for Bearer abcdefghijklmnop.",
              type: "rate_limit_error"
            }
          }),
          { status: 429, headers: { "retry-after": "30" } }
        )
      ),
      expected: /OpenAI rate limit reached.*Retry after 30/
    },
    {
      name: "openai-request-too-large",
      adapter: new OpenAIChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Request body too large for x-api-key: abcdefghijklmnop.",
              code: "request_too_large"
            }
          }),
          { status: 413 }
        )
      ),
      expected: /OpenAI request is too large/
    },
    {
      name: "anthropic-authentication",
      adapter: new AnthropicChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid key sk-ant-testsecret123456789.",
              type: "authentication_error"
            }
          }),
          { status: 401 }
        )
      ),
      expected: /Anthropic authentication failed/
    },
    {
      name: "anthropic-overloaded",
      adapter: new AnthropicChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Service overloaded.",
              type: "overloaded_error"
            }
          }),
          { status: 529 }
        )
      ),
      expected: /Anthropic is temporarily overloaded/
    },
    {
      name: "anthropic-request-too-large",
      adapter: new AnthropicChatAdapter(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Request exceeds maximum size.",
              type: "request_too_large"
            }
          }),
          { status: 413 }
        )
      ),
      expected: /Anthropic request is too large/
    }
  ];

  for (const testCase of cases) {
    const events = await collectEvents(testCase.adapter.stream(createRequest(), new AbortController().signal));
    const error = events[0] as Extract<ChatEvent, { type: "error" }>;
    assert.equal(error.type, "error", testCase.name);
    assert.match(error.message, testCase.expected, testCase.name);
    assert.doesNotMatch(error.message, /sk-|sk-ant-|sk-proj-|Bearer\s+[A-Za-z0-9]/, testCase.name);
  }
});

test("provider stream and invalid proposal errors use safe recovery messages", async () => {
  const openaiMissingBody = await collectEvents(
    new OpenAIChatAdapter(async () => new Response(null, { status: 200 })).stream(
      createRequest(),
      new AbortController().signal
    )
  );
  assert.equal(
    (openaiMissingBody[0] as Extract<ChatEvent, { type: "error" }>).message,
    "OpenAI response stream could not be read."
  );

  const anthropicMalformed = await collectEvents(
    new AnthropicChatAdapter(async () =>
      new Response(streamText(["data: {not-json}\n\n"]), { status: 200 })
    ).stream({ ...createRequest(), provider: "anthropic", model: "claude-sonnet-4-6" }, new AbortController().signal)
  );
  assert.equal(
    (anthropicMalformed[0] as Extract<ChatEvent, { type: "error" }>).message,
    "Anthropic response stream could not be read."
  );

  const openaiInvalidProposal = await collectEvents(
    new OpenAIChatAdapter(async () =>
      new Response(
        streamText([
          sse({ type: "response.created", response: { id: "resp_1" } }),
          sse({
            type: "response.function_call_arguments.done",
            name: "propose_vault_operations",
            arguments: JSON.stringify({ summary: "Delete", operations: [{ type: "delete_note" }] })
          })
        ]),
        { status: 200 }
      )
    ).stream(createVaultOperationRequest(), new AbortController().signal)
  );
  const invalidProposal = openaiInvalidProposal.find(
    (event): event is Extract<ChatEvent, { type: "error" }> => event.type === "error"
  );
  assert.match(invalidProposal?.message ?? "", /Provider returned an invalid Orchestrator Operation proposal\./);
  assert.match(invalidProposal?.message ?? "", /unsafe markdown path/);
});

function createRequest(): ChatRequest {
  return {
    provider: "openai",
    model: "gpt-5.4-mini",
    apiKey: "test-api-key",
    messages: [{ id: "m1", role: "user", content: "Earlier", createdAt: "2026-05-01T00:00:00.000Z" }],
    userMessage: "Use the note",
    context: contextPackage,
    contextSnapshot: {
      files: [
        {
          path: "Notes/Alpha.md",
          sourceIds: ["note:Notes/Alpha.md"],
          charCount: 13,
          estimatedTokens: 4
        },
        {
          path: "Folder/Beta.md",
          sourceIds: ["folder:Folder"],
          charCount: 19,
          estimatedTokens: 5
        }
      ],
      fileCount: 2,
      totalCharacters: 32,
      totalEstimatedTokens: 9,
      sourceIds: ["note:Notes/Alpha.md", "folder:Folder"]
    },
    operationTargets: {
      defaultPath: "/",
      sources: []
    },
    operationTargetSnapshot: {
      defaultPath: "/",
      targets: [
        {
          id: "target:folder:/",
          type: "folder",
          path: "/",
          label: "/",
          explicit: false
        }
      ],
      targetCount: 1
    },
    systemPrompt: "Use context."
  };
}

function createTargetOnlyRequest(targetPath = "My Folder", userMessage = "Create mmm.md here"): ChatRequest {
  return {
    ...createRequest(),
    context: {
      files: [],
      totalCharacters: 0,
      totalEstimatedTokens: 0,
      sourceIds: []
    },
    contextSnapshot: {
      files: [],
      fileCount: 0,
      totalCharacters: 0,
      totalEstimatedTokens: 0,
      sourceIds: []
    },
    operationTargets: {
      defaultPath: "/",
      sources: [
        {
          id: `target:folder:${targetPath}`,
          type: "folder",
          path: targetPath,
          label: targetPath,
          explicit: true
        }
      ]
    },
    operationTargetSnapshot: {
      defaultPath: "/",
      targets: [
        {
          id: `target:folder:${targetPath}`,
          type: "folder",
          path: targetPath,
          label: targetPath,
          explicit: true
        }
      ],
      targetCount: 1
    },
    userMessage,
    enableVaultOperations: true
  };
}

function createImageRequest(): ChatRequest {
  return {
    ...createRequest(),
    imageAttachments: [
      {
        kind: "image",
        id: "image-1",
        label: "Sketch.png",
        mediaType: "image/png",
        persistedPath: ".vault-ai-assistant/attachments/conversation-1/Sketch.png",
        status: "persisted",
        dataBase64: "ZmFrZS1wbmc="
      }
    ]
  };
}

function createVaultOperationRequest(): ChatRequest {
  return {
    ...createRequest(),
    userMessage: "Update this note with the cleaned version.",
    enableVaultOperations: true,
    operationTargets: {
      defaultPath: "/",
      sources: [
        {
          id: "target:folder:Notes",
          type: "folder",
          path: "Notes",
          label: "Notes",
          explicit: true
        }
      ]
    },
    operationTargetSnapshot: {
      defaultPath: "/",
      targets: [
        {
          id: "target:folder:Notes",
          type: "folder",
          path: "Notes",
          label: "Notes",
          explicit: true
        }
      ],
      targetCount: 1
    }
  };
}

function createTemplateOperationRequest(): ChatRequest {
  const request = createVaultOperationRequest();
  return {
    ...request,
    context: {
      files: [
        {
          path: "Notes/Template.md",
          content: "# {{title}}\n\n## Summary\n",
          charCount: 24,
          estimatedTokens: 8,
          sourceIds: ["note:Notes/Template.md"]
        }
      ],
      totalCharacters: 24,
      totalEstimatedTokens: 8,
      sourceIds: ["note:Notes/Template.md"]
    },
    contextSnapshot: {
      files: [
        {
          path: "Notes/Template.md",
          sourceIds: ["note:Notes/Template.md"],
          charCount: 24,
          estimatedTokens: 8
        }
      ],
      fileCount: 1,
      totalCharacters: 24,
      totalEstimatedTokens: 8,
      sourceIds: ["note:Notes/Template.md"]
    }
  };
}

async function collectEvents(events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const result: ChatEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

function createDiagnostics(logs: DiagnosticLogEntry[]): { log(event: string, details?: Record<string, unknown>): void } {
  return {
    log(event: string, details?: Record<string, unknown>): void {
      logs.push({ event, details });
    }
  };
}

function streamText(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
