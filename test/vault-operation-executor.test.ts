import assert from "node:assert/strict";
import test from "node:test";
import { VaultOperationExecutor } from "../src/vault-operation-executor";
import { createContentHash, VaultOperation } from "../src/vault-operations";

test("VaultOperationExecutor applies create_note and creates parent folders", async () => {
  const vault = createMockVault();
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_note",
    path: "Projects/New/Note.md",
    description: "Create a note",
    status: "pending",
    content: "# New"
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(vault.files.get("Projects/New/Note.md"), "# New");
  assert.deepEqual(vault.createFolderCalls, ["Projects", "Projects/New"]);
  assert.equal(vault.createCalls, 1);
});

test("VaultOperationExecutor applies create_folder and creates parent folders", async () => {
  const vault = createMockVault();
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_folder",
    path: "Projects/New/Research",
    description: "Create a folder",
    status: "pending"
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(vault.createFolderCalls, ["Projects", "Projects/New", "Projects/New/Research"]);
  assert.deepEqual(vault.getFolderByPath("Projects/New/Research"), {
    path: "Projects/New/Research"
  });
  assert.equal(vault.createCalls, 0);
});

test("VaultOperationExecutor rejects existing create_folder targets", async () => {
  const vault = createMockVault();
  await vault.createFolder("Projects");
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_folder",
    path: "Projects",
    description: "Create existing folder",
    status: "pending"
  });

  assert.deepEqual(result, { ok: false, error: "Folder already exists." });
});

test("VaultOperationExecutor fills existing empty create_note targets", async () => {
  const vault = createMockVault([["Books/empty 1.md", ""]]);
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_note",
    path: "Books/empty 1.md",
    description: "Create Books/empty 1.md",
    status: "pending",
    content: "# The Siren\n\nThe Siren is the ultimate seducer."
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(vault.files.get("Books/empty 1.md"), "# The Siren\n\nThe Siren is the ultimate seducer.");
  assert.equal(vault.createCalls, 0);
  assert.equal(vault.processCalls, 1);
});

test("VaultOperationExecutor applies modify_note and append_note", async () => {
  const vault = createMockVault([["Notes/Existing.md", "old"], ["Notes/Log.md", "first"]]);
  const executor = new VaultOperationExecutor(vault as never);

  const modifyResult = await executor.applyOperation({
    id: "operation-1",
    type: "modify_note",
    path: "Notes/Existing.md",
    description: "Modify a note",
    status: "pending",
    previousContent: "old",
    newContent: "new"
  });
  const appendResult = await executor.applyOperation({
    id: "operation-2",
    type: "append_note",
    path: "Notes/Log.md",
    description: "Append a note",
    status: "pending",
    content: "- next",
    appendMode: "end"
  });

  assert.deepEqual(modifyResult, { ok: true });
  assert.deepEqual(appendResult, { ok: true });
  assert.equal(vault.files.get("Notes/Existing.md"), "new");
  assert.equal(vault.files.get("Notes/Log.md"), "first\n- next");
  assert.equal(vault.processCalls, 2);
});

test("VaultOperationExecutor rejects existing create targets and missing modify or append targets", async () => {
  const vault = createMockVault([["Notes/Existing.md", "old"]]);
  const executor = new VaultOperationExecutor(vault as never);

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-1",
      type: "create_note",
      path: "Notes/Existing.md",
      description: "Create a note",
      status: "pending",
      content: "# Existing"
    }),
    { ok: false, error: "Note already exists." }
  );
  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-2",
      type: "modify_note",
      path: "Notes/Missing.md",
      description: "Modify a note",
      status: "pending",
      previousContent: "",
      newContent: "new"
    }),
    { ok: false, error: "Note was not found." }
  );
  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-3",
      type: "append_note",
      path: "Notes/Missing.md",
      description: "Append a note",
      status: "pending",
      content: "- next",
      appendMode: "end"
    }),
    { ok: false, error: "Note was not found." }
  );
});

test("VaultOperationExecutor rejects invalid Obsidian markdown paths before apply", async () => {
  const vault = createMockVault();
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_note",
    path: "Notes/Bad:Name.md",
    description: "Create a note",
    status: "pending",
    content: "# Bad"
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Operation path is not a valid Obsidian markdown path."
  });
  assert.equal(vault.createCalls, 0);
});

test("VaultOperationExecutor rejects invalid Obsidian folder paths before apply", async () => {
  const vault = createMockVault();
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "create_folder",
    path: "Notes/Bad:Name",
    description: "Create a folder",
    status: "pending"
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Operation path is not a valid Obsidian folder path."
  });
  assert.deepEqual(vault.createFolderCalls, []);
});

test("VaultOperationExecutor prepareProposalForReview captures compact baselines", async () => {
  const vault = createMockVault([
    ["Notes/Existing.md", "old"],
    ["Notes/Log.md", "first"],
    ["Notes/Delete.md", "delete me"]
  ]);
  await vault.createFolder("Notes/Old Folder");
  const executor = new VaultOperationExecutor(vault as never);

  const originalProposal = {
    id: "proposal-1",
    summary: "Update notes",
    createdAt: "2026-05-02T00:00:00.000Z",
    operations: [
      {
        id: "operation-1",
        type: "modify_note",
        path: "Notes/Existing.md",
        description: "Modify a note",
        status: "pending",
        previousContent: "model guessed old content",
        newContent: "new"
      },
      {
        id: "operation-2",
        type: "append_note",
        path: "Notes/Log.md",
        description: "Append a note",
        status: "pending",
        content: "- next",
        appendMode: "end"
      },
      {
        id: "operation-3",
        type: "create_note",
        path: "Notes/New.md",
        description: "Create a note",
        status: "pending",
        content: "# New"
      },
      {
        id: "operation-4",
        type: "create_folder",
        path: "Notes/New Folder",
        description: "Create a folder",
        status: "pending"
      },
      {
        id: "operation-5",
        type: "delete_note",
        path: "Notes/Delete.md",
        description: "Delete a note",
        status: "pending"
      },
      {
        id: "operation-6",
        type: "move_note",
        path: "Notes/Existing.md",
        sourcePath: "Notes/Existing.md",
        destinationPath: "Notes/Moved.md",
        description: "Move a note",
        status: "pending"
      },
      {
        id: "operation-7",
        type: "copy_note",
        path: "Notes/Log.md",
        sourcePath: "Notes/Log.md",
        destinationPath: "Notes/Log Copy.md",
        description: "Copy a note",
        status: "pending"
      },
      {
        id: "operation-8",
        type: "delete_folder",
        path: "Notes/Old Folder",
        description: "Delete folder",
        status: "pending"
      }
    ]
  } satisfies Parameters<VaultOperationExecutor["prepareProposalForReview"]>[0];
  const proposal = await executor.prepareProposalForReview(originalProposal);

  assert.notEqual(proposal.operations, originalProposal.operations);
  assert.equal(proposal.operations[0].baseContentHash, createContentHash("old"));
  assert.equal(proposal.operations[0].baseContentLength, 3);
  assert.equal(proposal.operations[0].type, "modify_note");
  if (proposal.operations[0].type === "modify_note") {
    assert.equal(proposal.operations[0].previousContent, "old");
    assert.match(proposal.operations[0].diff ?? "", /-old/);
    assert.match(proposal.operations[0].diff ?? "", /\+new/);
    assert.equal(proposal.operations[0].preview, proposal.operations[0].diff);
  }
  assert.equal(proposal.operations[1].baseContentHash, createContentHash("first"));
  assert.equal(proposal.operations[1].baseContentLength, 5);
  assert.equal(proposal.operations[2].baseContentHash, undefined);
  assert.equal(proposal.operations[2].baseContentLength, undefined);
  assert.equal(proposal.operations[3].baseContentHash, undefined);
  assert.equal(proposal.operations[3].baseContentLength, undefined);
  assert.equal(proposal.operations[4].baseContentHash, createContentHash("delete me"));
  assert.equal(proposal.operations[4].baseContentLength, 9);
  assert.equal(proposal.operations[5].baseContentHash, createContentHash("old"));
  assert.equal(proposal.operations[5].baseContentLength, 3);
  assert.equal(proposal.operations[6].baseContentHash, createContentHash("first"));
  assert.equal(proposal.operations[6].baseContentLength, 5);
  assert.equal(proposal.operations[7].baseContentHash, undefined);
  assert.equal(proposal.operations[7].baseContentLength, undefined);
});

test("VaultOperationExecutor prepareProposalForReview marks deterministic no-op and collision operations invalid", async () => {
  const vault = createMockVault([
    ["Notes/Existing.md", "old"],
    ["Notes/Done.md", "done"],
    ["Notes/Log.md", "first\n- next"],
    ["Notes/Move.md", "move"],
    ["Notes/Destination.md", "destination"]
  ]);
  await vault.createFolder("Notes/Existing Folder");
  const executor = new VaultOperationExecutor(vault as never);

  const proposal = await executor.prepareProposalForReview({
    id: "proposal-1",
    summary: "Preflight operations",
    createdAt: "2026-05-05T00:00:00.000Z",
    operations: [
      {
        id: "operation-1",
        type: "create_note",
        path: "Notes/Existing.md",
        description: "Create existing note",
        status: "pending",
        content: "old"
      },
      {
        id: "operation-2",
        type: "create_folder",
        path: "Notes/Existing Folder",
        description: "Create existing folder",
        status: "pending"
      },
      {
        id: "operation-3",
        type: "modify_note",
        path: "Notes/Done.md",
        description: "Modify already current note",
        status: "pending",
        previousContent: "model guessed",
        newContent: "done"
      },
      {
        id: "operation-4",
        type: "append_note",
        path: "Notes/Log.md",
        description: "Append already present content",
        status: "pending",
        content: "- next",
        appendMode: "end"
      },
      {
        id: "operation-5",
        type: "move_note",
        path: "Notes/Move.md",
        sourcePath: "Notes/Move.md",
        destinationPath: "Notes/Destination.md",
        description: "Move into existing destination",
        status: "pending"
      },
      {
        id: "operation-6",
        type: "delete_note",
        path: "Notes/Missing.md",
        description: "Delete missing note",
        status: "pending"
      }
    ]
  });

  assert.deepEqual(
    proposal.operations.map((operation) => ({
      id: operation.id,
      status: operation.status,
      error: operation.error
    })),
    [
      {
        id: "operation-1",
        status: "invalid",
        error: "Note already exists with the proposed content."
      },
      { id: "operation-2", status: "invalid", error: "Folder already exists." },
      { id: "operation-3", status: "invalid", error: "Note already has the proposed content." },
      {
        id: "operation-4",
        status: "invalid",
        error: "Note already ends with the proposed appended content."
      },
      { id: "operation-5", status: "invalid", error: "Destination already exists." },
      { id: "operation-6", status: "invalid", error: "Note was not found." }
    ]
  );
});

test("delete safety: VaultOperationExecutor applies approved delete_note through trash", async () => {
  const vault = createMockVault([["Notes/Delete.md", "delete me"]]);
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "delete_note",
    path: "Notes/Delete.md",
    description: "Delete a note",
    status: "pending",
    baseContentHash: createContentHash("delete me"),
    baseContentLength: 9
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(vault.files.has("Notes/Delete.md"), false);
  assert.deepEqual(vault.trashCalls, [{ path: "Notes/Delete.md", system: true }]);
});

test("VaultOperationExecutor rejects missing and stale delete_note operations", async () => {
  const vault = createMockVault([["Notes/Delete.md", "changed"]]);
  const executor = new VaultOperationExecutor(vault as never);

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-1",
      type: "delete_note",
      path: "Notes/Missing.md",
      description: "Delete missing note",
      status: "pending"
    }),
    { ok: false, error: "Note was not found." }
  );

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-2",
      type: "delete_note",
      path: "Notes/Delete.md",
      description: "Delete stale note",
      status: "pending",
      baseContentHash: createContentHash("delete me"),
      baseContentLength: 9
    }),
    {
      ok: false,
      error: "Note changed since this proposal was created. Regenerate the proposal before applying."
    }
  );
  assert.equal(vault.files.get("Notes/Delete.md"), "changed");
  assert.deepEqual(vault.trashCalls, []);
});

test("VaultOperationExecutor applies move_note, move_folder, copy_note, and delete_folder", async () => {
  const vault = createMockVault([
    ["Notes/Alpha.md", "alpha"],
    ["Folder/Beta.md", "beta"],
    ["Projects/Old/Index.md", "# Old"],
    ["Trash/Child.md", "remove"]
  ]);
  await vault.createFolder("Trash");
  const executor = new VaultOperationExecutor(vault as never, vault.fileManager as never);

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-1",
      type: "move_note",
      path: "Notes/Alpha.md",
      sourcePath: "Notes/Alpha.md",
      destinationPath: "Notes/Archive/Alpha.md",
      description: "Move Alpha",
      status: "pending",
      baseContentHash: createContentHash("alpha"),
      baseContentLength: 5
    }),
    { ok: true }
  );
  assert.equal(vault.files.has("Notes/Alpha.md"), false);
  assert.equal(vault.files.get("Notes/Archive/Alpha.md"), "alpha");

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-2",
      type: "move_folder",
      path: "Projects/Old",
      sourcePath: "Projects/Old",
      destinationPath: "Projects/Archive/Old",
      description: "Move project folder",
      status: "pending"
    }),
    { ok: true }
  );
  assert.equal(vault.folders.has("Projects/Old"), false);
  assert.equal(vault.folders.has("Projects/Archive/Old"), true);
  assert.equal(vault.files.get("Projects/Archive/Old/Index.md"), "# Old");

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-3",
      type: "copy_note",
      path: "Folder/Beta.md",
      sourcePath: "Folder/Beta.md",
      destinationPath: "Folder/Beta Copy.md",
      description: "Copy Beta",
      status: "pending",
      baseContentHash: createContentHash("beta"),
      baseContentLength: 4
    }),
    { ok: true }
  );
  assert.equal(vault.files.get("Folder/Beta.md"), "beta");
  assert.equal(vault.files.get("Folder/Beta Copy.md"), "beta");

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-4",
      type: "delete_folder",
      path: "Trash",
      description: "Delete folder",
      status: "pending"
    }),
    { ok: true }
  );
  assert.equal(vault.folders.has("Trash"), false);
  assert.equal(vault.files.has("Trash/Child.md"), false);
  assert.deepEqual(vault.trashCalls.at(-1), { path: "Trash", system: true });
  assert.deepEqual(vault.renameFileCalls, [
    { path: "Notes/Alpha.md", newPath: "Notes/Archive/Alpha.md" },
    { path: "Projects/Old", newPath: "Projects/Archive/Old" }
  ]);
});

test("VaultOperationExecutor rejects missing sources and existing destinations for expanded operations", async () => {
  const vault = createMockVault([
    ["Notes/Alpha.md", "alpha"],
    ["Notes/Existing.md", "existing"]
  ]);
  const executor = new VaultOperationExecutor(vault as never, vault.fileManager as never);

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-1",
      type: "move_note",
      path: "Notes/Missing.md",
      sourcePath: "Notes/Missing.md",
      destinationPath: "Notes/Moved.md",
      description: "Move missing",
      status: "pending"
    }),
    { ok: false, error: "Note was not found." }
  );
  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-2",
      type: "copy_note",
      path: "Notes/Alpha.md",
      sourcePath: "Notes/Alpha.md",
      destinationPath: "Notes/Existing.md",
      description: "Copy into existing",
      status: "pending"
    }),
    { ok: false, error: "Destination already exists." }
  );
  assert.equal(vault.files.get("Notes/Existing.md"), "existing");
  assert.equal(vault.files.has("Notes/Moved.md"), false);
});

test("VaultOperationExecutor rejects expanded operation stale baselines and missing FileManager", async () => {
  const vault = createMockVault([["Notes/Alpha.md", "changed"]]);
  const executor = new VaultOperationExecutor(vault as never, vault.fileManager as never);

  assert.deepEqual(
    await executor.applyOperation({
      id: "operation-1",
      type: "copy_note",
      path: "Notes/Alpha.md",
      sourcePath: "Notes/Alpha.md",
      destinationPath: "Notes/Copy.md",
      description: "Copy stale",
      status: "pending",
      baseContentHash: createContentHash("original"),
      baseContentLength: 8
    }),
    {
      ok: false,
      error: "Note changed since this proposal was created. Regenerate the proposal before applying."
    }
  );
  assert.equal(vault.files.has("Notes/Copy.md"), false);

  const missingFileManager = new VaultOperationExecutor(vault as never);
  assert.deepEqual(
    await missingFileManager.applyOperation({
      id: "operation-2",
      type: "move_note",
      path: "Notes/Alpha.md",
      sourcePath: "Notes/Alpha.md",
      destinationPath: "Notes/Moved.md",
      description: "Move without FileManager",
      status: "pending"
    }),
    { ok: false, error: "FileManager is required for move operations." }
  );
});

test("VaultOperationExecutor blocks modify_note when target changed since this proposal was created", async () => {
  const vault = createMockVault([["Notes/Existing.md", "changed"]]);
  const executor = new VaultOperationExecutor(vault as never);

  const result = await executor.applyOperation({
    id: "operation-1",
    type: "modify_note",
    path: "Notes/Existing.md",
    description: "Modify a note",
    status: "pending",
    previousContent: "old",
    newContent: "new"
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Note changed since this proposal was created. Regenerate the proposal before applying."
  });
  assert.equal(vault.files.get("Notes/Existing.md"), "changed");
  assert.equal(vault.processCalls, 0);
});

test("VaultOperationExecutor blocks stale modify_note and append_note baselines", async () => {
  const vault = createMockVault([
    ["Notes/Existing.md", "changed"],
    ["Notes/Log.md", "changed"]
  ]);
  const executor = new VaultOperationExecutor(vault as never);

  const modifyResult = await executor.applyOperation({
    id: "operation-1",
    type: "modify_note",
    path: "Notes/Existing.md",
    description: "Modify a note",
    status: "pending",
    previousContent: "old",
    newContent: "new",
    baseContentHash: createContentHash("old"),
    baseContentLength: 3
  });
  const appendResult = await executor.applyOperation({
    id: "operation-2",
    type: "append_note",
    path: "Notes/Log.md",
    description: "Append a note",
    status: "pending",
    content: "- next",
    appendMode: "end",
    baseContentHash: createContentHash("first"),
    baseContentLength: 5
  });

  assert.deepEqual(modifyResult, {
    ok: false,
    error: "Note changed since this proposal was created. Regenerate the proposal before applying."
  });
  assert.deepEqual(appendResult, {
    ok: false,
    error: "Note changed since this proposal was created. Regenerate the proposal before applying."
  });
  assert.equal(vault.files.get("Notes/Existing.md"), "changed");
  assert.equal(vault.files.get("Notes/Log.md"), "changed");
  assert.equal(vault.processCalls, 0);
});

test("VaultOperationExecutor leaves rejected operation and non-pending operations as no-ops", async () => {
  const vault = createMockVault();
  const executor = new VaultOperationExecutor(vault as never);

  const rejectedOperation: VaultOperation = {
    id: "operation-1",
    type: "create_note",
    path: "Notes/Rejected.md",
    description: "Create a note",
    status: "rejected",
    content: "# Rejected"
  };
  const appliedOperation: VaultOperation = {
    ...rejectedOperation,
    id: "operation-2",
    status: "applied"
  };

  assert.deepEqual(await executor.applyOperation(rejectedOperation), {
    ok: false,
    error: "Operation is not pending."
  });
  assert.deepEqual(await executor.applyOperation(appliedOperation), {
    ok: false,
    error: "Operation is not pending."
  });
  assert.equal(vault.createCalls, 0);
  assert.equal(vault.processCalls, 0);
  assert.deepEqual(vault.trashCalls, []);
  assert.equal(vault.files.size, 0);
});

function createMockVault(initialFiles: Array<[string, string]> = []) {
  const files = new Map<string, string>(initialFiles);
  const folders = new Set<string>();
  const createFolderCalls: string[] = [];
  const renameFileCalls: Array<{ path: string; newPath: string }> = [];
  let createCalls = 0;
  let processCalls = 0;
  const trashCalls: Array<{ path: string; system: boolean }> = [];
  for (const path of files.keys()) {
    addParentFolders(folders, path);
  }

  const vault = {
    files,
    folders,
    get createCalls() {
      return createCalls;
    },
    get processCalls() {
      return processCalls;
    },
    createFolderCalls,
    renameFileCalls,
    trashCalls,
    getFolderByPath(path: string) {
      return folders.has(path) ? { path } : null;
    },
    async createFolder(path: string) {
      folders.add(path);
      createFolderCalls.push(path);
      return { path };
    },
    getFileByPath(path: string) {
      return files.has(path) ? { path } : null;
    },
    async create(path: string, data: string) {
      createCalls += 1;
      files.set(path, data);
      return { path };
    },
    async process(file: { path: string }, fn: (data: string) => string) {
      const data = fn(files.get(file.path) ?? "");
      processCalls += 1;
      files.set(file.path, data);
      return data;
    },
    async trash(file: { path: string }, system: boolean) {
      trashCalls.push({ path: file.path, system });
      if (files.has(file.path)) {
        files.delete(file.path);
        return;
      }
      folders.delete(file.path);
      for (const path of Array.from(files.keys())) {
        if (path.startsWith(`${file.path}/`)) {
          files.delete(path);
        }
      }
      for (const path of Array.from(folders)) {
        if (path.startsWith(`${file.path}/`)) {
          folders.delete(path);
        }
      }
    },
    async cachedRead(file: { path: string }) {
      return files.get(file.path) ?? "";
    }
  };

  const fileManager = {
    async renameFile(file: { path: string }, newPath: string) {
      renameFileCalls.push({ path: file.path, newPath });
      if (files.has(file.path)) {
        const content = files.get(file.path) ?? "";
        files.delete(file.path);
        files.set(newPath, content);
        addParentFolders(folders, newPath);
        return;
      }

      if (folders.has(file.path)) {
        const oldPath = file.path;
        folders.delete(oldPath);
        folders.add(newPath);
        addParentFolders(folders, newPath);
        for (const folderPath of Array.from(folders)) {
          if (folderPath.startsWith(`${oldPath}/`)) {
            folders.delete(folderPath);
            folders.add(`${newPath}${folderPath.slice(oldPath.length)}`);
          }
        }
        for (const filePath of Array.from(files.keys())) {
          if (filePath.startsWith(`${oldPath}/`)) {
            const content = files.get(filePath) ?? "";
            files.delete(filePath);
            files.set(`${newPath}${filePath.slice(oldPath.length)}`, content);
          }
        }
      }
    }
  };

  return Object.assign(vault, { fileManager });
}

function addParentFolders(folders: Set<string>, path: string): void {
  const parts = path.split("/").slice(0, -1).filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    folders.add(current);
  }
}
