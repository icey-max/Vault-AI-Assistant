import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOperationOutcome,
  extractTextOrchestratorOperationPayloads,
  handleOrchestratorOperationPayload,
  hydrateTextOrchestratorOperationPayload,
  shouldEnableVaultOperations,
  shouldEnableVaultOperationsForRequest,
  TextOrchestratorOperationStreamFilter
} from "../src/orchestrator-operations";

test("classifyOperationOutcome distinguishes unsupported, clarify, and repairable outcomes", () => {
  assert.equal(
    classifyOperationOutcome({
      requestedOperation: true,
      hasProposal: false,
      needsClarification: true,
      unsupportedOperation: false,
      invalidRepairable: false,
      safeError: false
    }),
    "clarify"
  );
  assert.equal(
    classifyOperationOutcome({
      requestedOperation: true,
      hasProposal: false,
      needsClarification: false,
      unsupportedOperation: true,
      invalidRepairable: false,
      safeError: false
    }),
    "unsupported"
  );
  assert.equal(
    classifyOperationOutcome({
      requestedOperation: true,
      hasProposal: false,
      needsClarification: false,
      unsupportedOperation: false,
      invalidRepairable: true,
      safeError: false
    }),
    "invalid_repairable"
  );
});

test("classifyOperationOutcome gives proposal priority over invalid repairable", () => {
  assert.equal(
    classifyOperationOutcome({
      requestedOperation: true,
      hasProposal: true,
      needsClarification: false,
      unsupportedOperation: false,
      invalidRepairable: true,
      safeError: true
    }),
    "proposal"
  );
});

test("shouldEnableVaultOperations handles scoped confirmations and edit intents", () => {
  assert.equal(shouldEnableVaultOperations("Yes create them", 0, 1), true);
  assert.equal(shouldEnableVaultOperations("make it here please", 0, 1), true);
  assert.equal(shouldEnableVaultOperations("what is here?", 0, 1), false);
  assert.equal(
    shouldEnableVaultOperations("can you correct all grammatical mistakes here", 1, 0),
    true
  );
  assert.equal(shouldEnableVaultOperations("what does this note say?", 1, 0), false);
  assert.equal(shouldEnableVaultOperations("create a markdown file", 0, 0), true);
  assert.equal(shouldEnableVaultOperations("create a folder called Projects", 0, 0), true);
  assert.equal(shouldEnableVaultOperations("rename this note", 1, 0), true);
  assert.equal(shouldEnableVaultOperations("copy this file", 1, 0), true);
  assert.equal(
    shouldEnableVaultOperations(
      "Can you add all the chapters there with the template?",
      3,
      1
    ),
    true
  );
  assert.equal(shouldEnableVaultOperations("set this up in my vault", 0, 1), true);
  assert.equal(shouldEnableVaultOperations("populate these chapter notes", 0, 1), true);
});

test("shouldEnableVaultOperationsForRequest keeps operation tools on for scoped confirmations and retries", () => {
  const previousMessages = [
    {
      id: "user-1",
      role: "user" as const,
      content:
        "Can you add all the chapters there with the template? Just the title, and the template so I could fill it myself",
      createdAt: "2026-05-05T17:00:00.000Z"
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: "The provider returned an incomplete Orchestrator Operation proposal.",
      createdAt: "2026-05-05T17:00:01.000Z",
      status: "error"
    }
  ];

  assert.equal(
    shouldEnableVaultOperationsForRequest({
      message: "Yes like this Strategy 1 - Disarm and Infuriate the Enemy.md",
      previousMessages,
      contextFileCount: 3,
      targetCount: 1
    }),
    true
  );
  assert.equal(
    shouldEnableVaultOperationsForRequest({
      message: "Perhaps try again?",
      previousMessages,
      contextFileCount: 3,
      targetCount: 1
    }),
    true
  );
  assert.equal(
    shouldEnableVaultOperationsForRequest({
      message: "See if it works now..",
      previousMessages,
      contextFileCount: 3,
      targetCount: 1
    }),
    true
  );
  assert.equal(
    shouldEnableVaultOperationsForRequest({
      message: "what is here?",
      previousMessages,
      contextFileCount: 3,
      targetCount: 1
    }),
    false
  );
});

test("fallback strips incomplete standalone Books operation JSON without exposing raw text", () => {
  const rawText = [
    "You're right, let me create these properly within the Books scope:",
    "",
    "{ \"operations\": [ { \"type\": \"create\", \"path\": \"Books/Art of Seduction - Index.md\", \"content\""
  ].join("\n");

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 0);
  assert.equal(extraction.matchedOperationText, true);
  assert.equal(extraction.strippedOperationText, true);
  assert.equal(extraction.strippedIncompleteOperationText, true);
  assert.equal(extraction.text, "You're right, let me create these properly within the Books scope:");
  assert.doesNotMatch(extraction.text, /"operations"|Books\/Art of Seduction|content/);
});

test("stream filter recovers quarantined wrapper text into a scoped Books create proposal", () => {
  const filter = new TextOrchestratorOperationStreamFilter();
  const visible = [
    filter.append("<function_calls>"),
    filter.append("[{\"type\":\"create\",\"path\":\"Books/Index.md\",\"content\":\"# Index\"}]"),
    filter.append("</function_calls>"),
    filter.flushVisibleText()
  ].join("");

  assert.equal(visible, "");
  assert.match(filter.getQuarantinedText(), /Books\/Index\.md/);
  assert.doesNotMatch(visible, /function_calls|Books\/Index/);

  const extraction = extractTextOrchestratorOperationPayloads(filter.getQuarantinedText());
  assert.equal(extraction.payloads.length, 1);
  assert.equal(extraction.matchedOperationText, true);
  assert.equal(extraction.strippedOperationText, true);
  assert.equal(extraction.strippedIncompleteOperationText, false);

  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []),
    {
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:Books",
            type: "folder",
            path: "Books",
            label: "Books",
            explicit: true
          }
        ]
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.proposal.operations.length, 1);
  assert.equal(result.proposal.operations[0].type, "create_note");
  assert.equal(result.proposal.operations[0].path, "Books/Index.md");
});

test("stream filter recovers create_folder proposals without adding markdown suffixes", () => {
  const filter = new TextOrchestratorOperationStreamFilter();
  const visible = [
    filter.append("<vault_operation>"),
    filter.append("[{\"operation\":\"mkdir\",\"path\":\"Books/New Shelf/\",\"description\":\"Create shelf folder\"}]"),
    filter.append("</vault_operation>"),
    filter.flushVisibleText()
  ].join("");

  assert.equal(visible, "");
  const extraction = extractTextOrchestratorOperationPayloads(filter.getQuarantinedText());
  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []),
    {
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:Books",
            type: "folder",
            path: "Books",
            label: "Books",
            explicit: true
          }
        ]
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.proposal.operations[0].type, "create_folder");
  assert.equal(result.proposal.operations[0].path, "Books/New Shelf");
});

test("handleOrchestratorOperationPayload expands create_note from attached template context", () => {
  const result = handleOrchestratorOperationPayload(
    {
      summary: "Create strategy notes from chapter template",
      operations: [
        {
          type: "create_note",
          path: "33 Strategies of War/Chapters/Strategy 1 - Disarm and Infuriate the Enemy.md",
          templatePath: "33 Strategies of War/Templates/Chapter Template.md",
          title: "Strategy 1 - Disarm and Infuriate the Enemy",
          description: "Create strategy note from template"
        }
      ]
    },
    {
      contextFiles: [
        {
          path: "33 Strategies of War/Templates/Chapter Template.md",
          content: "# {{title}}\n\n## Summary\n\n## Key Points\n",
          charCount: 37,
          estimatedTokens: 10,
          sourceIds: ["folder:33 Strategies of War"]
        }
      ],
      readableContextPaths: ["33 Strategies of War/Templates/Chapter Template.md"],
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:33 Strategies of War/Chapters",
            type: "folder",
            path: "33 Strategies of War/Chapters",
            label: "Chapters",
            explicit: true
          }
        ]
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const operation = result.proposal.operations[0];
  assert.equal(operation.type, "create_note");
  if (operation.type !== "create_note") {
    return;
  }
  assert.equal(operation.content, "# Strategy 1 - Disarm and Infuriate the Enemy\n\n## Summary\n\n## Key Points\n");
});

test("handleOrchestratorOperationPayload derives heading when template has no title placeholder", () => {
  const result = handleOrchestratorOperationPayload(
    {
      summary: "Create strategy note from bare template",
      operations: [
        {
          type: "create_note",
          path: "33 Strategies of War/Chapters/Strategy 2 - Do Not Fight the Last War.md",
          templatePath: "33 Strategies of War/Templates/Chapter Template.md",
          description: "Create strategy note from template"
        }
      ]
    },
    {
      contextFiles: [
        {
          path: "33 Strategies of War/Templates/Chapter Template.md",
          content: "## Summary\n\n## Application\n",
          charCount: 25,
          estimatedTokens: 8,
          sourceIds: ["folder:33 Strategies of War"]
        }
      ],
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:33 Strategies of War/Chapters",
            type: "folder",
            path: "33 Strategies of War/Chapters",
            label: "Chapters",
            explicit: true
          }
        ]
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const operation = result.proposal.operations[0];
  assert.equal(operation.type, "create_note");
  if (operation.type !== "create_note") {
    return;
  }
  assert.equal(
    operation.content,
    "# Strategy 2 - Do Not Fight the Last War\n\n## Summary\n\n## Application\n"
  );
});

test("stream filter quarantines plural vault operation wrapper text", () => {
  const filter = new TextOrchestratorOperationStreamFilter();
  const visible = [
    filter.append("<vault_operations>"),
    filter.append("[{\"operation\":\"create\",\"path\":\"lop.md\",\"content\":\"\"}]"),
    filter.append("</vault_operations>"),
    filter.flushVisibleText()
  ].join("");

  assert.equal(visible, "");
  assert.match(filter.getQuarantinedText(), /lop\.md/);
  assert.doesNotMatch(visible, /vault_operations|lop\.md/);

  const extraction = extractTextOrchestratorOperationPayloads(filter.getQuarantinedText());
  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], [])
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.proposal.operations[0].type, "create_note");
  assert.equal(result.proposal.operations[0].path, "lop.md");
});

test("fallback no-proposal recovery copy omits raw operation markup", () => {
  const error =
    "The provider returned an incomplete Orchestrator Operation proposal. No vault files were changed. Retry the request or ask for fewer file changes.";

  assert.match(error, /No vault files were changed/);
  assert.doesNotMatch(error, /"operations"|<function_calls>/);
});

test("fallback recovers expanded alias payloads without exposing fake tool tags", () => {
  const rawText = [
    "I'll prepare the move.",
    "",
    "<function_calls>",
    JSON.stringify({
      operations: [
        {
          type: "rename_file",
          from: "Notes/Alpha.md",
          to: "Notes/Archive/Alpha.md",
          description: "Move Alpha"
        }
      ]
    }),
    "</function_calls>"
  ].join("\n");
  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 1);
  assert.doesNotMatch(extraction.text, /<function_calls>|Notes\/Alpha/);

  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []),
    {
      readableContextPaths: ["Notes/Alpha.md"],
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
      }
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.proposal.operations[0].type, "move_note");
});

test("safe operation errors do not expose raw function call text", () => {
  const rawText = "<function_calls>{\"operations\":[{\"type\":\"move_note\",\"sourcePath\":\"Notes/Alpha.md\"}]}</function_calls>";
  const extraction = extractTextOrchestratorOperationPayloads(rawText);
  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], [])
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.doesNotMatch(result.message, /<function_calls>|"operations"/);
  assert.doesNotMatch(result.errors.join("\n"), /<function_calls>/);
});
