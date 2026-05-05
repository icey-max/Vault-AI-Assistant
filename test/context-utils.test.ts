import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeContextFiles,
  estimateTokensFromChars,
  evaluateContextWarnings,
  createDefaultOperationTargetScope,
  createOperationTargetSnapshot,
  isAssistantOwnedPath,
  isMarkdownPath,
  isPathWithinTarget,
  normalizeTargetPath,
  ResolvedContextFile,
  summarizeContext
} from "../src/context-utils";

function createFile(
  path: string,
  estimatedTokens: number,
  sourceIds: string[] = [`note:${path}`]
): ResolvedContextFile {
  return {
    path,
    basename: path.replace(/\.md$/i, ""),
    extension: "md",
    sourceIds,
    charCount: estimatedTokens * 4,
    estimatedTokens
  };
}

test("isMarkdownPath accepts markdown file paths case-insensitively", () => {
  assert.equal(isMarkdownPath("Daily.md"), true);
  assert.equal(isMarkdownPath("Archive/Note.MD"), true);
  assert.equal(isMarkdownPath("image.png"), false);
  assert.equal(isMarkdownPath("Note.md.backup"), false);
});

test("estimateTokensFromChars rounds up by four characters", () => {
  assert.equal(estimateTokensFromChars(801), 201);
});

test("dedupeContextFiles merges duplicate paths and unique source ids", () => {
  const deduped = dedupeContextFiles([
    createFile("Project.md", 10, ["note:Project.md"]),
    createFile("Project.md", 10, ["folder:Projects", "note:Project.md"]),
    createFile("Other.md", 5, ["note:Other.md"])
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped[0]?.sourceIds, ["note:Other.md"]);
  assert.deepEqual(deduped[1]?.sourceIds, ["folder:Projects", "note:Project.md"]);
});

test("summarizeContext totals unique files", () => {
  const summary = summarizeContext([
    createFile("One.md", 7, ["note:One.md"]),
    createFile("One.md", 7, ["folder:/"]),
    createFile("Two.md", 11, ["note:Two.md"])
  ]);

  assert.equal(summary.fileCount, 2);
  assert.equal(summary.totalEstimatedTokens, 18);
  assert.equal(summary.totalCharacters, 72);
});

test("evaluateContextWarnings returns file-count warning above 50 files", () => {
  const files = Array.from({ length: 51 }, (_value, index) => {
    return createFile(`Note ${index}.md`, 1);
  });

  const warnings = evaluateContextWarnings(files);

  assert.equal(warnings.some((warning) => warning.type === "file-count"), true);
});

test("evaluateContextWarnings returns total-size warning above 200000 estimated tokens", () => {
  const warnings = evaluateContextWarnings([
    createFile("Large A.md", 100001),
    createFile("Large B.md", 100001)
  ]);

  assert.equal(warnings.some((warning) => warning.type === "total-size"), true);
});

test("evaluateContextWarnings returns single-file-size warning above 50000 estimated tokens", () => {
  const warnings = evaluateContextWarnings([createFile("Huge.md", 50001)]);
  const singleFileWarning = warnings.find((warning) => warning.type === "single-file-size");

  assert.equal(singleFileWarning?.path, "Huge.md");
});

test("target path helpers normalize root and match folder descendants exactly", () => {
  assert.equal(normalizeTargetPath(""), "/");
  assert.equal(normalizeTargetPath("/"), "/");
  assert.equal(normalizeTargetPath("/Folder/"), "Folder");

  const folderTarget = {
    id: "target:folder:Folder",
    type: "folder" as const,
    path: "Folder",
    label: "Folder",
    explicit: true
  };

  assert.equal(isPathWithinTarget("Folder/Child.md", folderTarget), true);
  assert.equal(isPathWithinTarget("Folderish/Child.md", folderTarget), false);
});

test("assistant-owned paths are excluded from operation target matching", () => {
  const rootTarget = {
    id: "target:folder:/",
    type: "folder" as const,
    path: "/",
    label: "/",
    explicit: false
  };

  assert.equal(isAssistantOwnedPath("vault-ai-assistant/conversations/chat.md"), true);
  assert.equal(isAssistantOwnedPath(".vault-ai-assistant/attachments/image.png"), true);
  assert.equal(isAssistantOwnedPath("Notes/vault-ai-assistant.md"), false);
  assert.equal(isPathWithinTarget("vault-ai-assistant/conversations/chat.md", rootTarget), false);
  assert.equal(isPathWithinTarget(".vault-ai-assistant/attachments/image.png", rootTarget), false);
  assert.equal(isPathWithinTarget("Notes/Allowed.md", rootTarget), true);
});

test("default operation target snapshot exposes root create scope without contents", () => {
  const snapshot = createOperationTargetSnapshot(createDefaultOperationTargetScope());

  assert.equal(snapshot.defaultPath, "/");
  assert.equal(snapshot.targetCount, 1);
  assert.equal(snapshot.targets[0]?.path, "/");
  assert.equal(snapshot.targets[0]?.explicit, false);
});
