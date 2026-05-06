import type { FileManager, TFile, TFolder, Vault } from "obsidian";
import {
  createContentHash,
  createOperationPreview,
  createUnifiedDiff,
  isSafeMarkdownPath,
  isSafeVaultFolderPath,
  type VaultOperation,
  type VaultOperationProposal
} from "./vault-operations";

export interface VaultOperationApplyResult {
  ok: boolean;
  error?: string;
}

const CONFLICT_ERROR =
  "Note changed since this proposal was created. Regenerate the proposal before applying.";

export class VaultOperationExecutor {
  private vault: Vault;
  private fileManager?: FileManager;

  constructor(vault: Vault, fileManager?: FileManager) {
    this.vault = vault;
    this.fileManager = fileManager;
  }

  async applyOperation(operation: VaultOperation): Promise<VaultOperationApplyResult> {
    if (operation.status !== "pending") {
      return { ok: false, error: "Operation is not pending." };
    }

    const pathError = this.validateOperationPaths(operation);
    if (pathError) {
      return { ok: false, error: pathError };
    }

    try {
      if (operation.type === "create_folder") {
        return await this.applyCreateFolder(operation.path);
      }

      if (operation.type === "create_note") {
        return await this.applyCreate(operation.path, operation.content);
      }

      if (operation.type === "modify_note") {
        return await this.applyModify(operation);
      }

      if (operation.type === "delete_note") {
        return await this.applyDelete(operation);
      }

      if (operation.type === "move_note") {
        return await this.applyMoveNote(operation);
      }

      if (operation.type === "move_folder") {
        return await this.applyMoveFolder(operation);
      }

      if (operation.type === "copy_note") {
        return await this.applyCopyNote(operation);
      }

      if (operation.type === "delete_folder") {
        return await this.applyDeleteFolder(operation);
      }

      return await this.applyAppend(operation);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error && error.message ? error.message : "Unable to apply operation."
      };
    }
  }

  async prepareProposalForReview(proposal: VaultOperationProposal): Promise<VaultOperationProposal> {
    const operations: VaultOperation[] = [];

    for (const operation of proposal.operations) {
      operations.push(await this.prepareOperationForReview(operation));
    }

    return {
      ...proposal,
      operations
    };
  }

  private async prepareOperationForReview(operation: VaultOperation): Promise<VaultOperation> {
    const pathError = this.validateOperationPaths(operation);
    if (pathError) {
      return this.markOperationInvalid(operation, pathError);
    }

    if (operation.type === "create_note") {
      return await this.prepareCreateNoteForReview(operation);
    }

    if (operation.type === "create_folder") {
      return this.prepareCreateFolderForReview(operation);
    }

    if (operation.type === "modify_note") {
      return await this.prepareModifyNoteForReview(operation);
    }

    if (operation.type === "append_note") {
      return await this.prepareAppendNoteForReview(operation);
    }

    if (operation.type === "delete_note") {
      return await this.prepareExistingNoteOperationForReview(operation, operation.path);
    }

    if (operation.type === "move_note" || operation.type === "copy_note") {
      return await this.preparePathChangingNoteOperationForReview(operation);
    }

    if (operation.type === "move_folder") {
      return this.prepareMoveFolderForReview(operation);
    }

    return this.prepareDeleteFolderForReview(operation);
  }

  private async prepareCreateNoteForReview(
    operation: Extract<VaultOperation, { type: "create_note" }>
  ): Promise<VaultOperation> {
    const existingFile: TFile | null = this.vault.getFileByPath(operation.path);
    if (!existingFile) {
      return { ...operation };
    }

    const currentContent = await this.vault.cachedRead(existingFile);
    if (currentContent.trim().length === 0) {
      return { ...operation };
    }

    return this.markOperationInvalid(
      operation,
      currentContent === operation.content
        ? "Note already exists with the proposed content."
        : "Note already exists."
    );
  }

  private prepareCreateFolderForReview(
    operation: Extract<VaultOperation, { type: "create_folder" }>
  ): VaultOperation {
    if (this.vault.getFolderByPath(operation.path)) {
      return this.markOperationInvalid(operation, "Folder already exists.");
    }

    if (this.vault.getFileByPath(operation.path)) {
      return this.markOperationInvalid(operation, "A note already exists at this path.");
    }

    return { ...operation };
  }

  private async prepareModifyNoteForReview(
    operation: Extract<VaultOperation, { type: "modify_note" }>
  ): Promise<VaultOperation> {
    const file: TFile | null = this.vault.getFileByPath(operation.path);
    if (!file) {
      return this.markOperationInvalid(operation, "Note was not found.");
    }

    const currentContent = await this.vault.cachedRead(file);
    if (currentContent === operation.newContent) {
      return this.markOperationInvalid(operation, "Note already has the proposed content.");
    }

    const diff = createUnifiedDiff(operation.path, currentContent, operation.newContent);
    return {
      ...operation,
      previousContent: currentContent,
      diff,
      preview: diff,
      baseContentHash: createContentHash(currentContent),
      baseContentLength: currentContent.length
    };
  }

  private async prepareAppendNoteForReview(
    operation: Extract<VaultOperation, { type: "append_note" }>
  ): Promise<VaultOperation> {
    const file: TFile | null = this.vault.getFileByPath(operation.path);
    if (!file) {
      return this.markOperationInvalid(operation, "Note was not found.");
    }

    const currentContent = await this.vault.cachedRead(file);
    if (currentContent.endsWith(operation.content)) {
      return this.markOperationInvalid(operation, "Note already ends with the proposed appended content.");
    }

    return this.withExistingContentBaseline(operation, currentContent);
  }

  private async prepareExistingNoteOperationForReview(
    operation: VaultOperation,
    path: string
  ): Promise<VaultOperation> {
    const file: TFile | null = this.vault.getFileByPath(path);
    if (!file) {
      return this.markOperationInvalid(operation, "Note was not found.");
    }

    const currentContent = await this.vault.cachedRead(file);
    return this.withExistingContentBaseline(operation, currentContent);
  }

  private async preparePathChangingNoteOperationForReview(
    operation: Extract<VaultOperation, { type: "move_note" | "copy_note" }>
  ): Promise<VaultOperation> {
    const destinationError = this.getDestinationPreflightError(
      operation.sourcePath,
      operation.destinationPath
    );
    if (destinationError) {
      return this.markOperationInvalid(operation, destinationError);
    }

    return await this.prepareExistingNoteOperationForReview(operation, operation.sourcePath);
  }

  private prepareMoveFolderForReview(
    operation: Extract<VaultOperation, { type: "move_folder" }>
  ): VaultOperation {
    if (!this.vault.getFolderByPath(operation.sourcePath)) {
      return this.markOperationInvalid(operation, "Folder was not found.");
    }

    const destinationError = this.getDestinationPreflightError(
      operation.sourcePath,
      operation.destinationPath
    );
    if (destinationError) {
      return this.markOperationInvalid(operation, destinationError);
    }

    return { ...operation };
  }

  private prepareDeleteFolderForReview(
    operation: Extract<VaultOperation, { type: "delete_folder" }>
  ): VaultOperation {
    if (!this.vault.getFolderByPath(operation.path)) {
      return this.markOperationInvalid(operation, "Folder was not found.");
    }

    return { ...operation };
  }

  private withExistingContentBaseline(operation: VaultOperation, currentContent: string): VaultOperation {
    const operationWithBaseline = {
      ...operation,
      baseContentHash: createContentHash(currentContent),
      baseContentLength: currentContent.length
    };
    return {
      ...operationWithBaseline,
      preview: operation.preview ?? createOperationPreview(operationWithBaseline)
    };
  }

  private markOperationInvalid(operation: VaultOperation, error: string): VaultOperation {
    return {
      ...operation,
      status: "invalid",
      error,
      preview: operation.preview ?? createOperationPreview(operation)
    };
  }

  private validateOperationPaths(operation: VaultOperation): string | undefined {
    if (operation.type === "create_folder" || operation.type === "delete_folder") {
      return isSafeVaultFolderPath(operation.path)
        ? undefined
        : "Operation path is not a valid Obsidian folder path.";
    }

    if (operation.type === "move_folder") {
      if (!isSafeVaultFolderPath(operation.sourcePath)) {
        return "Operation source path is not a valid Obsidian folder path.";
      }
      if (!isSafeVaultFolderPath(operation.destinationPath)) {
        return "Operation destination path is not a valid Obsidian folder path.";
      }
      return undefined;
    }

    if (operation.type === "move_note" || operation.type === "copy_note") {
      if (!isSafeMarkdownPath(operation.sourcePath)) {
        return "Operation source path is not a valid Obsidian markdown path.";
      }
      if (!isSafeMarkdownPath(operation.destinationPath)) {
        return "Operation destination path is not a valid Obsidian markdown path.";
      }
      return undefined;
    }

    return isSafeMarkdownPath(operation.path)
      ? undefined
      : "Operation path is not a valid Obsidian markdown path.";
  }

  private async applyCreate(path: string, content: string): Promise<VaultOperationApplyResult> {
    const existingFile: TFile | null = this.vault.getFileByPath(path);
    if (existingFile) {
      await this.vault.process(existingFile, (currentContent) => {
        if (currentContent.trim().length > 0) {
          throw new Error("Note already exists.");
        }

        return content;
      });
      return { ok: true };
    }

    await this.ensureParentFolders(path);
    await this.vault.create(path, content);
    return { ok: true };
  }

  private async applyCreateFolder(path: string): Promise<VaultOperationApplyResult> {
    if (this.vault.getFolderByPath(path)) {
      return { ok: false, error: "Folder already exists." };
    }

    await this.ensureParentFolders(path);
    await this.vault.createFolder(path);
    return { ok: true };
  }

  private async applyModify(operation: Extract<VaultOperation, { type: "modify_note" }>): Promise<VaultOperationApplyResult> {
    const file: TFile | null = this.vault.getFileByPath(operation.path);
    if (!file) {
      return { ok: false, error: "Note was not found." };
    }

    await this.vault.process(file, (currentContent) => {
      if (this.hasStaleBaseline(currentContent, operation)) {
        throw new Error(CONFLICT_ERROR);
      }
      if (!operation.baseContentHash && currentContent !== operation.previousContent) {
        throw new Error(CONFLICT_ERROR);
      }

      return operation.newContent;
    });
    return { ok: true };
  }

  private async applyAppend(operation: Extract<VaultOperation, { type: "append_note" }>): Promise<VaultOperationApplyResult> {
    const file: TFile | null = this.vault.getFileByPath(operation.path);
    if (!file) {
      return { ok: false, error: "Note was not found." };
    }

    await this.vault.process(file, (currentContent) => {
      if (this.hasStaleBaseline(currentContent, operation)) {
        throw new Error(CONFLICT_ERROR);
      }

      const separator = currentContent.length > 0 && !currentContent.endsWith("\n") ? "\n" : "";
      return `${currentContent}${separator}${operation.content}`;
    });
    return { ok: true };
  }

  private async applyDelete(operation: Extract<VaultOperation, { type: "delete_note" }>): Promise<VaultOperationApplyResult> {
    const file: TFile | null = this.vault.getFileByPath(operation.path);
    if (!file) {
      return { ok: false, error: "Note was not found." };
    }

    const currentContent = await this.vault.cachedRead(file);
    if (this.hasStaleBaseline(currentContent, operation)) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    if (!this.fileManager) {
      return { ok: false, error: "FileManager is required for delete operations." };
    }

    await this.fileManager.trashFile(file);
    return { ok: true };
  }

  private async applyMoveNote(operation: Extract<VaultOperation, { type: "move_note" }>): Promise<VaultOperationApplyResult> {
    if (!this.fileManager) {
      return { ok: false, error: "FileManager is required for move operations." };
    }

    const file: TFile | null = this.vault.getFileByPath(operation.sourcePath);
    if (!file) {
      return { ok: false, error: "Note was not found." };
    }

    const destinationError = this.getDestinationPreflightError(operation.sourcePath, operation.destinationPath);
    if (destinationError) {
      return { ok: false, error: destinationError };
    }

    const currentContent = await this.vault.cachedRead(file);
    if (this.hasStaleBaseline(currentContent, operation)) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    await this.ensureParentFolders(operation.destinationPath);
    await this.fileManager.renameFile(file, operation.destinationPath);
    return { ok: true };
  }

  private async applyMoveFolder(operation: Extract<VaultOperation, { type: "move_folder" }>): Promise<VaultOperationApplyResult> {
    if (!this.fileManager) {
      return { ok: false, error: "FileManager is required for move operations." };
    }

    const folder: TFolder | null = this.vault.getFolderByPath(operation.sourcePath);
    if (!folder) {
      return { ok: false, error: "Folder was not found." };
    }

    const destinationError = this.getDestinationPreflightError(operation.sourcePath, operation.destinationPath);
    if (destinationError) {
      return { ok: false, error: destinationError };
    }

    await this.ensureParentFolders(operation.destinationPath);
    await this.fileManager.renameFile(folder, operation.destinationPath);
    return { ok: true };
  }

  private async applyCopyNote(operation: Extract<VaultOperation, { type: "copy_note" }>): Promise<VaultOperationApplyResult> {
    const file: TFile | null = this.vault.getFileByPath(operation.sourcePath);
    if (!file) {
      return { ok: false, error: "Note was not found." };
    }

    const destinationError = this.getDestinationPreflightError(operation.sourcePath, operation.destinationPath);
    if (destinationError) {
      return { ok: false, error: destinationError };
    }

    const currentContent = await this.vault.cachedRead(file);
    if (this.hasStaleBaseline(currentContent, operation)) {
      return { ok: false, error: CONFLICT_ERROR };
    }

    await this.ensureParentFolders(operation.destinationPath);
    await this.vault.create(operation.destinationPath, currentContent);
    return { ok: true };
  }

  private async applyDeleteFolder(operation: Extract<VaultOperation, { type: "delete_folder" }>): Promise<VaultOperationApplyResult> {
    const folder: TFolder | null = this.vault.getFolderByPath(operation.path);
    if (!folder) {
      return { ok: false, error: "Folder was not found." };
    }

    if (!this.fileManager) {
      return { ok: false, error: "FileManager is required for delete operations." };
    }

    await this.fileManager.trashFile(folder);
    return { ok: true };
  }

  private getDestinationPreflightError(sourcePath: string, destinationPath: string): string | undefined {
    if (sourcePath === destinationPath || this.pathExists(destinationPath)) {
      return "Destination already exists.";
    }

    if (sourcePath.toLowerCase() === destinationPath.toLowerCase()) {
      return "Case-only path changes are not supported.";
    }

    if (destinationPath.startsWith(`${sourcePath}/`)) {
      return "Destination cannot be inside the source folder.";
    }

    return undefined;
  }

  private hasStaleBaseline(
    currentContent: string,
    operation: Pick<VaultOperation, "baseContentHash" | "baseContentLength">
  ): boolean {
    if (!operation.baseContentHash) {
      return false;
    }

    return (
      createContentHash(currentContent) !== operation.baseContentHash ||
      (typeof operation.baseContentLength === "number" &&
        currentContent.length !== operation.baseContentLength)
    );
  }

  private pathExists(path: string): boolean {
    return Boolean(this.vault.getFileByPath(path) || this.vault.getFolderByPath(path));
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1).filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.vault.getFolderByPath(current)) {
        continue;
      }

      await this.vault.createFolder(current);
    }
  }
}
