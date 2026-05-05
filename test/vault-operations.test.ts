import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTextOrchestratorOperationPayloads,
  formatInvalidOrchestratorOperationMessage,
  handleOrchestratorOperationPayload,
  hydrateTextOrchestratorOperationPayload,
  ORCHESTRATOR_OPERATION_CAPABILITIES,
  normalizeOrchestratorOperationProposal,
  createContentHash,
  createOperationPreview,
  createUnifiedDiff,
  createVaultOperationToolSchema,
  isSafeMarkdownPath,
  TextOrchestratorOperationStreamFilter,
  validateVaultOperationProposal
} from "../src/orchestrator-operations";

test("operation capability matrix classifies supported and unsupported operations", () => {
  const capabilities = new Map(
    ORCHESTRATOR_OPERATION_CAPABILITIES.map((capability) => [capability.type, capability])
  );

  for (const type of [
    "create_note",
    "create_folder",
    "modify_note",
    "append_note",
    "delete_note",
    "move_note",
    "move_folder",
    "copy_note",
    "delete_folder"
  ]) {
    assert.equal(capabilities.get(type)?.status, "supported", type);
  }

  assert.equal(capabilities.get("copy_folder")?.status, "planned");
  assert.equal(capabilities.get("shell_command")?.status, "unsupported");
  assert.equal(capabilities.get("binary_attachment_write")?.status, "unsupported");
});

test("schema validity: validateVaultOperationProposal accepts folder and note operations", () => {
  const result = validateVaultOperationProposal(
    {
      summary: "Prepare project notes",
      operations: [
        {
          type: "create_folder",
          path: "Projects/New",
          description: "Create a project folder"
        },
        {
          type: "create_note",
          path: "Projects/New.md",
          description: "Create a new note",
          content: "# New"
        },
        {
          type: "modify_note",
          path: "Projects/Existing.md",
          description: "Modify an existing note",
          previousContent: "old",
          newContent: "new",
          baseContentHash: createContentHash("old"),
          baseContentLength: 3
        },
        {
          type: "append_note",
          path: "Projects/Log.md",
          description: "Append to the log",
          content: "- item",
          appendMode: "ignored"
        }
      ]
    },
    { now: "2026-05-02T00:00:00.000Z" }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.proposal.summary, "Prepare project notes");
  assert.equal(result.proposal.createdAt, "2026-05-02T00:00:00.000Z");
  assert.equal(result.proposal.operations.length, 4);
  assert.equal(result.proposal.operations[0].id, "operation-1");
  assert.equal(result.proposal.operations[0].status, "pending");
  assert.equal(result.proposal.operations[0].type, "create_folder");
  assert.match(result.proposal.operations[0].preview ?? "", /Create folder after approval/);
  assert.equal(result.proposal.operations[2].type, "modify_note");
  assert.match(result.proposal.operations[2].preview ?? "", /^\+\+\+ Projects\/Existing\.md/m);
  assert.equal(result.proposal.operations[2].baseContentHash, createContentHash("old"));
  assert.equal(result.proposal.operations[2].baseContentLength, 3);
  const append = result.proposal.operations[3];
  assert.equal(append.type, "append_note");
  assert.equal(append.appendMode, "end");
});

test("validateVaultOperationProposal rejects unsafe paths", () => {
  for (const path of [
    "",
    "/Note.md",
    "../Note.md",
    "Folder/../Note.md",
    "Folder//Note.md",
    "Folder\\Note.md",
    "Folder/Bad:Name.md",
    "Note.txt"
  ]) {
    const result = validateVaultOperationProposal({
      summary: "Bad path",
      operations: [{ type: "create_note", path, description: "Create", content: "x" }]
    });

    assert.equal(result.ok, false, path);
    if (!result.ok) {
      assert.match(result.errors.join("\n"), /unsafe markdown path/);
    }
  }

  assert.equal(isSafeMarkdownPath("Folder/Note.MD"), true);

  for (const path of [
    "",
    "/Folder",
    "../Folder",
    "Folder/../Child",
    "Folder//Child",
    "Folder\\Child",
    "Folder/Bad:Name",
    "Folder/Note.md"
  ]) {
    const result = validateVaultOperationProposal({
      summary: "Bad folder path",
      operations: [{ type: "create_folder", path, description: "Create folder" }]
    });

    assert.equal(result.ok, false, path);
    if (!result.ok) {
      assert.match(result.errors.join("\n"), /unsafe folder path/);
    }
  }
});

test("validateVaultOperationProposal rejects unsupported operation and malformed payloads", () => {
  const unsupported = validateVaultOperationProposal({
    summary: "Bad operation",
    operations: [{ type: "rename_note", path: "Note.md", description: "Unsupported operation" }]
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) {
    assert.match(unsupported.errors.join("\n"), /unsupported operation/);
  }

  for (const input of [
    { summary: "", operations: [] },
    { summary: "Missing create content", operations: [{ type: "create_note", path: "Note.md" }] },
    {
      summary: "Missing modify content",
      operations: [{ type: "modify_note", path: "Note.md", previousContent: "old" }]
    },
    { summary: "Missing append content", operations: [{ type: "append_note", path: "Note.md" }] }
  ]) {
    assert.equal(validateVaultOperationProposal(input).ok, false);
  }
});

test("validateVaultOperationProposal accepts expanded operation shapes and previews", () => {
  const result = validateVaultOperationProposal({
    summary: "Move and clean vault paths",
    operations: [
      {
        type: "move_note",
        path: "Notes/Alpha.md",
        sourcePath: "Notes/Alpha.md",
        destinationPath: "Notes/Archive/Alpha.md",
        description: "Move Alpha"
      },
      {
        type: "move_folder",
        path: "Projects/Old",
        sourcePath: "Projects/Old",
        destinationPath: "Projects/Archive/Old",
        description: "Move folder"
      },
      {
        type: "copy_note",
        path: "Notes/Beta.md",
        sourcePath: "Notes/Beta.md",
        destinationPath: "Notes/Beta Copy.md",
        description: "Copy Beta"
      },
      {
        type: "delete_folder",
        path: "Projects/Trash",
        description: "Delete folder"
      }
    ]
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(
    result.proposal.operations.map((operation) => operation.type),
    ["move_note", "move_folder", "copy_note", "delete_folder"]
  );
  assert.equal(result.proposal.operations[0].path, "Notes/Alpha.md");
  assert.match(result.proposal.operations[0].preview ?? "", /Source: Notes\/Alpha\.md/);
  assert.match(result.proposal.operations[0].preview ?? "", /Destination: Notes\/Archive\/Alpha\.md/);
  assert.match(result.proposal.operations[2].preview ?? "", /Source: Notes\/Beta\.md/);
  assert.match(result.proposal.operations[2].preview ?? "", /Destination: Notes\/Beta Copy\.md/);
  assert.match(result.proposal.operations[3].preview ?? "", /Delete folder after approval/);
  assert.match(result.proposal.operations[3].preview ?? "", /Path: Projects\/Trash/);
});

test("validateVaultOperationProposal rejects malformed expanded operation payloads", () => {
  for (const input of [
    {
      summary: "Missing source",
      operations: [
        {
          type: "move_note",
          path: "Notes/Alpha.md",
          destinationPath: "Notes/Beta.md",
          description: "Missing source"
        }
      ]
    },
    {
      summary: "Missing destination",
      operations: [
        {
          type: "copy_note",
          path: "Notes/Alpha.md",
          sourcePath: "Notes/Alpha.md",
          description: "Missing destination"
        }
      ]
    },
    {
      summary: "Bad folder safety",
      operations: [
        {
          type: "delete_folder",
          path: "Projects/Trash.md",
          description: "Delete folder"
        }
      ]
    }
  ]) {
    const result = validateVaultOperationProposal(input);
    assert.equal(result.ok, false);
  }
});

test("normalizeOrchestratorOperationProposal maps provider aliases to canonical operation types", () => {
  const result = handleOrchestratorOperationPayload(
    normalizeOrchestratorOperationProposal({
      summary: "Alias payloads",
      operations: [
        {
          action: "create",
          path: "Notes/New: Template",
          description: "Create a note",
          markdown: "# New"
        },
        {
          type: "modify",
          path: "Notes/Existing.md",
          description: "Modify a note",
          previous_content: "old",
          new_content: "new"
        },
        {
          action: "mkdir",
          path: "Notes/New Folder/",
          description: "Create a folder"
        },
        {
          action: "append",
          path: "Notes/Log.md",
          description: "Append a note",
          content: "- next"
        },
        {
          operation: "delete",
          path: "Notes/Old.md",
          description: "Delete a note"
        }
      ]
    }),
    {
      readableContextPaths: ["Notes/Existing.md"],
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

  assert.deepEqual(
    result.proposal.operations.map((operation) => operation.type),
    ["create_note", "modify_note", "create_folder", "append_note", "delete_note"]
  );
  assert.equal(result.proposal.operations[0].path, "Notes/New - Template.md");
  assert.equal(result.proposal.operations[2].path, "Notes/New Folder");
});

test("normalizeOrchestratorOperationProposal maps expanded provider aliases safely", () => {
  const result = handleOrchestratorOperationPayload(
    normalizeOrchestratorOperationProposal({
      summary: "Alias path changes",
      operations: [
        {
          type: "rename_file",
          from: "Notes/Alpha",
          to: "Notes/Archive/Alpha",
          description: "Rename Alpha"
        },
        {
          operation: "duplicate",
          source: "Notes/Beta.md",
          new_path: "Notes/Beta Copy.md",
          description: "Duplicate Beta"
        },
        {
          action: "trash_folder",
          path: "Notes/Old Folder",
          description: "Trash old folder"
        }
      ]
    }),
    {
      readableContextPaths: ["Notes/Alpha.md", "Notes/Beta.md"],
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

  assert.deepEqual(
    result.proposal.operations.map((operation) => operation.type),
    ["move_note", "copy_note", "delete_folder"]
  );
  assert.equal(result.proposal.operations[0].path, "Notes/Alpha.md");
  assert.equal(result.proposal.operations[0].type, "move_note");
  assert.equal(result.proposal.operations[0].destinationPath, "Notes/Archive/Alpha.md");
  assert.equal(result.proposal.operations[1].type, "copy_note");
  assert.equal(result.proposal.operations[1].sourcePath, "Notes/Beta.md");
  assert.equal(result.proposal.operations[1].destinationPath, "Notes/Beta Copy.md");
});

test("ambiguous expanded aliases without destination fail validation", () => {
  const result = handleOrchestratorOperationPayload(
    normalizeOrchestratorOperationProposal({
      summary: "Rename without destination",
      operations: [
        {
          type: "rename_file",
          path: "Notes/Alpha.md",
          description: "Rename Alpha"
        }
      ]
    }),
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

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errors.join("\n"), /destinationPath is required/);
  }
});

test("normalizeOrchestratorOperationProposal makes root slash paths vault-relative", () => {
  const result = handleOrchestratorOperationPayload(
    {
      summary: "Create root note",
      operations: [
        {
          type: "create",
          path: "/Root Note",
          description: "Create a root note",
          content: "# Root"
        }
      ]
    },
    {
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:/",
            type: "folder",
            path: "/",
            label: "/",
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

  assert.equal(result.proposal.operations[0].path, "Root Note.md");
});

test("raw tool fallback strips incomplete function call blocks", () => {
  const rawText = [
    "I'll propose five running templates.",
    "",
    "<function_calls>",
    "[",
    "{",
    "\"action\":\"create\",",
    "\"path\":\"Untitled 1/Run Template - Wellness Check.md\",",
    "\"content\":\"# Run on DATE\\n\\n## How I'm Feeling\\n- Physical Comfort: Great /"
  ].join("\n");

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 0);
  assert.equal(extraction.text, "I'll propose five running templates.");
  assert.doesNotMatch(extraction.text, /<function_calls|Run Template|Physical Comfort/);
});

test("stream filter quarantines raw function call text and keeps parseable payloads", () => {
  const filter = new TextOrchestratorOperationStreamFilter();
  const visible = [
    filter.append("I'll propose "),
    filter.append("five templates.\n\n<fun"),
    filter.append("ction_calls>\n["),
    filter.append(
      "{\"action\":\"create\",\"path\":\"Untitled 1/Run Template - Basic.md\",\"description\":\"Create basic run template\",\"content\":\"# Run on DATE\"}"
    ),
    filter.append("]\n</function_calls>\nReview these changes."),
    filter.flushVisibleText()
  ].join("");

  assert.equal(visible, "I'll propose five templates.\n\n\nReview these changes.");
  assert.doesNotMatch(visible, /function_calls|Run Template - Basic/);

  const extraction = extractTextOrchestratorOperationPayloads(filter.getQuarantinedText());
  assert.equal(extraction.payloads.length, 1);

  const result = handleOrchestratorOperationPayload(
    hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []),
    {
      operationTargets: {
        defaultPath: "/",
        sources: [
          {
            id: "target:folder:Untitled 1",
            type: "folder",
            path: "Untitled 1",
            label: "Untitled 1",
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

  assert.equal(result.proposal.operations[0].type, "create_note");
  assert.equal(result.proposal.operations[0].path, "Untitled 1/Run Template - Basic.md");
});

test("handleOrchestratorOperationPayload rejects malformed payloads without raw provider markup", () => {
  const result = handleOrchestratorOperationPayload({
    summary: "Bad",
    operations: [
      {
        type: "modify",
        path: "Notes/Existing.md",
        description: "Modify without content"
      }
    ]
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.message, "Provider returned an invalid Orchestrator Operation proposal.");
  assert.match(formatInvalidOrchestratorOperationMessage(result.errors), /previousContent and newContent/);
  assert.match(result.errors.join("\n"), /previousContent and newContent/);
  assert.match(result.repairPrompt, /Return valid Orchestrator Operation JSON only/);
  assert.doesNotMatch(result.message, /<function_calls>|<atml:invoke/);
});

test("raw tool fallback extracts visible function-call text into context-scoped operations", () => {
  const rawTexts = [
    `I'll correct the file.

<functioncalls>
[
  {
    "type": "modify",
    "path": "Untitled/Thoughts.md",
    "description": "Correct grammar",
    "content": "Corrected content"
  }
]
</function_calls>

Review the proposal.`,
    `I'll correct the file.

<tooluse>
<tool_name>propose_vault_operations</tool_name>
<tool_parameter name="operations">[
  {
    "type": "modify",
    "path": "Untitled/Thoughts.md",
    "description": "Correct grammar",
    "content": "Corrected content"
  }
]</tool_parameter>
</tool_invoke>

Review the proposal.`
  ];

  for (const rawText of rawTexts) {
    const extraction = extractTextOrchestratorOperationPayloads(rawText);

    assert.equal(extraction.payloads.length, 1);
    assert.doesNotMatch(extraction.text, /<function_?calls|<tooluse|Untitled\/Thoughts\.md/);
    assert.match(extraction.text, /I'll correct the file/);

    const hydrated = hydrateTextOrchestratorOperationPayload(extraction.payloads[0], [
      {
        path: "Untitled/Thoughts.md",
        content: "Original content",
        charCount: 16,
        estimatedTokens: 4,
        sourceIds: ["current-note:Untitled/Thoughts.md"]
      }
    ]);
    const result = handleOrchestratorOperationPayload(hydrated, {
      allowedExistingTargetPaths: ["Untitled/Thoughts.md"]
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    const operation = result.proposal.operations[0];
    assert.equal(operation.type, "modify_note");
    assert.equal(operation.path, "Untitled/Thoughts.md");
    assert.equal(operation.status, "pending");
    if (operation.type === "modify_note") {
      assert.equal(operation.previousContent, "Original content");
      assert.equal(operation.newContent, "Corrected content");
    }
  }
});

test("raw tool fallback extracts visible vault_operation text into create proposals", () => {
  const rawText = `I'll propose creating the zzz.md file inside the "My Folder" directory.

<vault_operation>
{
  "operations": [
    {
      "type": "create",
      "path": "My Folder/zzz.md",
      "content": ""
    }
  ]
}
</vault_operation>`;
  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 1);
  assert.doesNotMatch(extraction.text, /<vault_operation|My Folder\/zzz\.md/);
  assert.match(extraction.text, /I'll propose creating/);

  const hydrated = hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []);
  const result = handleOrchestratorOperationPayload(hydrated);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.proposal.operations[0].type, "create_note");
  assert.equal(result.proposal.operations[0].path, "My Folder/zzz.md");
  assert.equal(result.proposal.operations[0].status, "pending");
});

test("raw tool fallback extracts plural vault_operations text with operation aliases", () => {
  const rawText = `Got it. I'll create an empty lop.md file in the root folder.

<vault_operations>
[
  {
    "operation": "create",
    "path": "lop.md",
    "content": ""
  }
]
</vault_operations>

Once you approve, the file will be created.`;
  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 1);
  assert.equal(extraction.matchedOperationText, true);
  assert.equal(extraction.strippedOperationText, true);
  assert.doesNotMatch(extraction.text, /<vault_operations|"\s*operation\s*"/);
  assert.match(extraction.text, /Got it/);

  const hydrated = hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []);
  const result = handleOrchestratorOperationPayload(hydrated);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.proposal.operations[0].type, "create_note");
  assert.equal(result.proposal.operations[0].path, "lop.md");
  assert.equal(result.proposal.operations[0].content, "");
});

test("raw tool fallback extracts standalone operation JSON into create proposals", () => {
  const rawText = `Got it! Let me create these files properly within the Books folder scope:

{
  "operations": [
    {
      "type": "create",
      "path": "Books/Art of Seduction/Index.md",
      "content": "# The Art of Seduction - Archetypes Index\\n\\n## Archetypes\\n\\n1. [[The Siren]]\\n2. [[The Rake]]\\n"
    },
    {
      "type": "create",
      "path": "Books/Art of Seduction/The Siren.md",
      "content": "# The Siren\\n\\n## Description\\n\\n## Key Characteristics\\n"
    },
    {
      "type": "create",
      "path": "Books/Art of Seduction/The Rake.md",
      "content": "# The Rake\\n\\n## Description\\n\\n## Key Characteristics\\n"
    }
  ]
}`;

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 1);
  assert.equal(extraction.text, "Got it! Let me create these files properly within the Books folder scope:");
  assert.doesNotMatch(extraction.text, /"operations"|Books\/Art of Seduction/);

  const hydrated = hydrateTextOrchestratorOperationPayload(extraction.payloads[0], []);
  const result = handleOrchestratorOperationPayload(hydrated, {
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
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(
    result.proposal.operations.map((operation) => operation.path),
    [
      "Books/Art of Seduction/Index.md",
      "Books/Art of Seduction/The Siren.md",
      "Books/Art of Seduction/The Rake.md"
    ]
  );
  assert.equal(result.proposal.operations[0].type, "create_note");
});

test("raw tool fallback leaves non-operation JSON text untouched", () => {
  const rawText = `Here is a JSON example:

{
  "operations": [
    {
      "name": "read",
      "description": "This is documentation, not a vault operation."
    }
  ]
}`;

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 0);
  assert.equal(extraction.matchedOperationText, false);
  assert.equal(extraction.strippedOperationText, false);
  assert.equal(extraction.strippedIncompleteOperationText, false);
  assert.equal(extraction.text, rawText);
});

test("raw tool fallback strips incomplete standalone operation JSON", () => {
  const rawText = `You're right, let me create these properly within the Books scope:

{ "operations": [ { "type": "create", "path": "Books/Art of Seduction - Index.md", "content": "# The Art of Seduction - Archetypes Index\\n\\n## Overview\\nA collection of archetypes from Robert Greene's \\"The Art of Seduction.\\"" }, { "type": "create", "path": "Books/Art of Seduction - The Coquette.md", "content`;

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 0);
  assert.equal(extraction.matchedOperationText, true);
  assert.equal(extraction.strippedOperationText, true);
  assert.equal(extraction.strippedIncompleteOperationText, true);
  assert.equal(extraction.text, "You're right, let me create these properly within the Books scope:");
  assert.doesNotMatch(extraction.text, /"operations"|Books\/Art of Seduction|The Coquette/);
});

test("raw tool fallback leaves incomplete non-operation JSON untouched", () => {
  const rawText = `Here is a JSON example:

{ "operations": [ { "name": "read", "description": "Not a vault operation" }`;

  const extraction = extractTextOrchestratorOperationPayloads(rawText);

  assert.equal(extraction.payloads.length, 0);
  assert.equal(extraction.matchedOperationText, false);
  assert.equal(extraction.strippedOperationText, false);
  assert.equal(extraction.strippedIncompleteOperationText, false);
  assert.equal(extraction.text, rawText);
});

test("validateOrchestratorOperationProposal allows modify targets outside readable context", () => {
  const accepted = handleOrchestratorOperationPayload(
    {
      summary: "Modify attached note",
      operations: [
        {
          type: "modify_note",
          path: "Notes/Alpha.md",
          description: "Clean attached note",
          previousContent: "old",
          newContent: "new"
        }
      ]
    },
    { allowedExistingTargetPaths: ["Notes/Alpha.md"] }
  );

  assert.equal(accepted.ok, true);

  const otherTarget = handleOrchestratorOperationPayload(
    {
      summary: "Modify hidden note",
      operations: [
        {
          type: "modify_note",
          path: "Notes/Other.md",
          description: "Clean hidden note",
          previousContent: "old",
          newContent: "new"
        }
      ]
    },
    { allowedExistingTargetPaths: ["Notes/Alpha.md"] }
  );

  assert.equal(otherTarget.ok, true);

  const createResult = handleOrchestratorOperationPayload(
    {
      summary: "Create safe note",
      operations: [
        {
          type: "create_note",
          path: "Notes/New.md",
          description: "Create new note",
          content: "# New"
        }
      ]
    },
    { allowedExistingTargetPaths: [] }
  );

  assert.equal(createResult.ok, true);
});

test("validateOrchestratorOperationProposal accepts context-scoped delete_note previews", () => {
  const result = handleOrchestratorOperationPayload(
    {
      summary: "Delete attached note",
      operations: [
        {
          type: "delete_note",
          path: "Notes/Alpha.md",
          description: "Delete attached note"
        }
      ]
    },
    { allowedExistingTargetPaths: ["Notes/Alpha.md"] }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.proposal.operations[0].type, "delete_note");
  assert.match(result.proposal.operations[0].preview ?? "", /Delete note after approval/);
  assert.match(result.proposal.operations[0].preview ?? "", /Notes\/Alpha\.md/);

  const rename = handleOrchestratorOperationPayload(
    {
      summary: "Rename unsupported",
      operations: [{ type: "rename_note", path: "Notes/Alpha.md", description: "Rename note" }]
    },
    { allowedExistingTargetPaths: ["Notes/Alpha.md"] }
  );
  assert.equal(rename.ok, false);
});

test("operation validation allows proposals outside explicit scope boundaries", () => {
  const operationTargets = {
    defaultPath: "/" as const,
    sources: [
      {
        id: "target:folder:My Folder",
        type: "folder" as const,
        path: "My Folder",
        label: "My Folder",
        explicit: true
      }
    ]
  };

  const createResult = handleOrchestratorOperationPayload(
    {
      summary: "Create in scoped folder",
      operations: [
        {
          type: "create_note",
          path: "My Folder/mmm.md",
          description: "Create scoped note",
          content: "# Mmm"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );
  assert.equal(createResult.ok, true);

  const createFolderResult = handleOrchestratorOperationPayload(
    {
      summary: "Create scoped folder",
      operations: [
        {
          type: "create_folder",
          path: "My Folder/New Child",
          description: "Create nested folder"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );
  assert.equal(createFolderResult.ok, true);

  const deleteResult = handleOrchestratorOperationPayload(
    {
      summary: "Delete in scoped folder",
      operations: [
        {
          type: "delete_note",
          path: "My Folder/Old.md",
          description: "Delete scoped note"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );
  assert.equal(deleteResult.ok, true);

  const outsideFolder = handleOrchestratorOperationPayload(
    {
      summary: "Create folder outside scope",
      operations: [
        {
          type: "create_folder",
          path: "Other Folder",
          description: "Create outside scope"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );
  assert.equal(outsideFolder.ok, true);
});

test("operation validation allows full modify without exact readable context", () => {
  const operationTargets = {
    defaultPath: "/" as const,
    sources: [
      {
        id: "target:folder:My Folder",
        type: "folder" as const,
        path: "My Folder",
        label: "My Folder",
        explicit: true
      }
    ]
  };

  const scopeOnlyModify = handleOrchestratorOperationPayload(
    {
      summary: "Rewrite hidden note",
      operations: [
        {
          type: "modify_note",
          path: "My Folder/Hidden.md",
          description: "Rewrite hidden scope-only note",
          previousContent: "old",
          newContent: "new"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );

  assert.equal(scopeOnlyModify.ok, true);

  const accepted = handleOrchestratorOperationPayload(
    {
      summary: "Rewrite visible note",
      operations: [
        {
          type: "modify_note",
          path: "My Folder/Hidden.md",
          description: "Rewrite attached note",
          previousContent: "old",
          newContent: "new"
        }
      ]
    },
    { readableContextPaths: ["My Folder/Hidden.md"], operationTargets }
  );

  assert.equal(accepted.ok, true);
});

test("operation validation allows expanded operation source and destination outside scope", () => {
  const operationTargets = {
    defaultPath: "/" as const,
    sources: [
      {
        id: "target:folder:Notes",
        type: "folder" as const,
        path: "Notes",
        label: "Notes",
        explicit: true
      }
    ]
  };

  const accepted = handleOrchestratorOperationPayload(
    {
      summary: "Move scoped note",
      operations: [
        {
          type: "move_note",
          sourcePath: "Notes/Alpha.md",
          destinationPath: "Notes/Archive/Alpha.md",
          path: "Notes/Alpha.md",
          description: "Move note"
        },
        {
          type: "move_folder",
          sourcePath: "Notes/Old Folder",
          destinationPath: "Notes/New Folder",
          path: "Notes/Old Folder",
          description: "Move folder"
        },
        {
          type: "delete_folder",
          path: "Notes/Trash",
          description: "Delete folder"
        }
      ]
    },
    { readableContextPaths: ["Notes/Alpha.md"], operationTargets }
  );
  assert.equal(accepted.ok, true);

  const outOfScopeSource = handleOrchestratorOperationPayload(
    {
      summary: "Copy hidden source",
      operations: [
        {
          type: "copy_note",
          sourcePath: "Other/Hidden.md",
          destinationPath: "Notes/Hidden Copy.md",
          path: "Other/Hidden.md",
          description: "Copy hidden source"
        }
      ]
    },
    { readableContextPaths: [], operationTargets }
  );
  assert.equal(outOfScopeSource.ok, true);

  const outOfScopeDestination = handleOrchestratorOperationPayload(
    {
      summary: "Move outside scope",
      operations: [
        {
          type: "move_note",
          sourcePath: "Notes/Alpha.md",
          destinationPath: "Other/Alpha.md",
          path: "Notes/Alpha.md",
          description: "Move outside scope"
        }
      ]
    },
    { readableContextPaths: ["Notes/Alpha.md"], operationTargets }
  );
  assert.equal(outOfScopeDestination.ok, true);
});

test("proposal validation rejects batch collisions but allows parent folder dependencies", () => {
  const duplicateDestination = validateVaultOperationProposal({
    summary: "Duplicate destination",
    operations: [
      {
        type: "create_note",
        path: "Notes/Dupe.md",
        description: "Create dupe",
        content: "# Dupe"
      },
      {
        type: "copy_note",
        path: "Notes/Alpha.md",
        sourcePath: "Notes/Alpha.md",
        destinationPath: "Notes/Dupe.md",
        description: "Copy to same destination"
      }
    ]
  });
  assert.equal(duplicateDestination.ok, false);
  if (!duplicateDestination.ok) {
    assert.match(duplicateDestination.errors.join("\n"), /conflicting destination path/);
  }

  const samePathConflict = validateVaultOperationProposal({
    summary: "Same path conflict",
    operations: [
      {
        type: "modify_note",
        path: "Notes/Alpha.md",
        description: "Modify Alpha",
        previousContent: "old",
        newContent: "new"
      },
      {
        type: "delete_note",
        path: "Notes/Alpha.md",
        description: "Delete Alpha"
      }
    ]
  });
  assert.equal(samePathConflict.ok, false);
  if (!samePathConflict.ok) {
    assert.match(samePathConflict.errors.join("\n"), /conflicting operations on one primary path/);
  }

  const safeParentDependency = validateVaultOperationProposal({
    summary: "Create parent then child",
    operations: [
      {
        type: "create_folder",
        path: "Notes/New Folder",
        description: "Create parent folder"
      },
      {
        type: "create_note",
        path: "Notes/New Folder/Child.md",
        description: "Create child note",
        content: "# Child"
      }
    ]
  });
  assert.equal(safeParentDependency.ok, true);
});

test("createUnifiedDiff and previews expose readable change content", () => {
  const diff = createUnifiedDiff("Notes/Alpha.md", "one\ntwo\nsame", "one\nthree\nsame\nfour");

  assert.match(diff, /^--- Notes\/Alpha\.md/m);
  assert.match(diff, /^\+\+\+ Notes\/Alpha\.md/m);
  assert.match(diff, /^-two/m);
  assert.match(diff, /^\+three/m);
  assert.match(diff, /^ same/m);

  assert.equal(
    createOperationPreview({
      id: "operation-1",
      type: "create_folder",
      path: "Notes/New",
      description: "Create folder",
      status: "pending"
    }),
    "Create folder after approval\n\nPath: Notes/New"
  );

  assert.equal(
    createOperationPreview({
      id: "operation-2",
      type: "append_note",
      path: "Notes/Alpha.md",
      description: "Append",
      status: "pending",
      content: "- next",
      appendMode: "end"
    }),
    "Append to end of note\n\n- next"
  );
});

test("createVaultOperationToolSchema returns provider-neutral propose_vault_operations schema", () => {
  const schema = createVaultOperationToolSchema();

  assert.equal(schema.name, "propose_vault_operations");
  assert.match(schema.description, /approval/);
  assert.deepEqual(schema.input_schema.required, ["summary", "operations"]);
  assert.match(JSON.stringify(schema), /create_note/);
  assert.match(JSON.stringify(schema), /create_folder/);
  assert.match(JSON.stringify(schema), /modify_note/);
  assert.match(JSON.stringify(schema), /append_note/);
  assert.match(JSON.stringify(schema), /delete_note/);
  assert.match(JSON.stringify(schema), /move_note/);
  assert.match(JSON.stringify(schema), /move_folder/);
  assert.match(JSON.stringify(schema), /copy_note/);
  assert.match(JSON.stringify(schema), /delete_folder/);
  assert.doesNotMatch(JSON.stringify(schema), /rename_note/);
});
