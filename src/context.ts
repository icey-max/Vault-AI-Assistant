import { App, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type { ChatMarkdownAttachment } from "./chat-types";
import {
  ContextPackage,
  ContextPackageFile,
  ContextSource,
  ContextSourceType,
  OperationTargetScope,
  OperationTargetSource,
  dedupeContextFiles,
  estimateTokensFromChars,
  createDefaultOperationTargetScope,
  isAssistantOwnedPath,
  normalizeTargetPath,
  ResolvedContextFile,
  summarizeContext
} from "./context-utils";

type SourceFileType = Extract<ContextSourceType, "current-note" | "note">;
export type RestorableContextSource = ChatMarkdownAttachment;

interface ActiveFileContextOptions {
  includeActiveFile?: boolean;
  includeActiveFileDirectory?: boolean;
}

export class VaultContextManager {
  private app: App;
  private sources: ContextSource[] = [];
  private targetSources: OperationTargetSource[] = [];
  private onChange: () => void;

  constructor(app: App, onChange: () => void) {
    this.app = app;
    this.onChange = onChange;
  }

  getSources(options: ActiveFileContextOptions = {}): ContextSource[] {
    const sources = this.cloneSources(this.sources);
    if (!options.includeActiveFile) {
      return sources;
    }

    const activeFileSource = this.createActiveFileContextSource(sources);
    return activeFileSource ? [activeFileSource, ...sources] : sources;
  }

  getIncludedFiles(options: ActiveFileContextOptions = {}): ResolvedContextFile[] {
    const sourceFiles = this.getSources(options).reduce<ResolvedContextFile[]>((files, source) => {
      return files.concat(source.files);
    }, []);

    return dedupeContextFiles(
      sourceFiles.filter((file) => !isAssistantOwnedPath(file.path))
    );
  }

  getSummary(options: ActiveFileContextOptions = {}) {
    return summarizeContext(this.getIncludedFiles(options));
  }

  getRestorableSources(): RestorableContextSource[] {
    return this.sources
      .filter((source) => !isAssistantOwnedPath(source.path))
      .map((source) => ({
        kind: "markdown",
        id: source.id,
        sourceType: source.type,
        path: source.path,
        label: source.label,
        mode: "context"
      }));
  }

  getTargetSources(options: ActiveFileContextOptions = {}): OperationTargetSource[] {
    const sources = this.targetSources
      .filter((source) => !isAssistantOwnedPath(source.path))
      .map((source) => ({ ...source }));

    if (!options.includeActiveFileDirectory || sources.length > 0) {
      return sources;
    }

    const activeFileTarget = this.createActiveFileDirectoryTargetSource();
    return activeFileTarget ? [activeFileTarget] : sources;
  }

  getOperationTargetScope(options: ActiveFileContextOptions = {}): OperationTargetScope {
    return {
      ...createDefaultOperationTargetScope(),
      sources: this.getTargetSources(options)
    };
  }

  getRestorableAttachments(options: ActiveFileContextOptions = {}): RestorableContextSource[] {
    const contextAttachments = this.getRestorableSources();
    const targetAttachments: RestorableContextSource[] = this.getTargetSources().map((source) => ({
      kind: "markdown",
      id: source.id,
      sourceType: source.type === "folder" ? "folder" : "note",
      path: source.path,
      label: source.label,
      mode: "target",
      targetType: source.type
    }) satisfies RestorableContextSource);

    if (options.includeActiveFile) {
      const activeFileSource = this.createActiveFileContextSource(this.cloneSources(this.sources));
      if (activeFileSource) {
        contextAttachments.push({
          kind: "markdown",
          id: activeFileSource.id,
          sourceType: activeFileSource.type,
          path: activeFileSource.path,
          label: activeFileSource.label,
          mode: "context",
          automatic: true
        });
      }
    }

    if (options.includeActiveFileDirectory && this.targetSources.length === 0) {
      const activeFileTarget = this.createActiveFileDirectoryTargetSource();
      if (activeFileTarget) {
        targetAttachments.push({
          kind: "markdown",
          id: activeFileTarget.id,
          sourceType: activeFileTarget.type === "folder" ? "folder" : "note",
          path: activeFileTarget.path,
          label: activeFileTarget.label,
          mode: "target",
          targetType: activeFileTarget.type,
          automatic: true
        });
      }
    }

    return contextAttachments.concat(targetAttachments);
  }

  restoreSources(sources: RestorableContextSource[]): void {
    const restoredSources: ContextSource[] = [];
    const restoredTargets: OperationTargetSource[] = [];

    for (const source of sources) {
      if (isAssistantOwnedPath(source.path)) {
        continue;
      }

      if (source.automatic) {
        continue;
      }

      if (source.mode === "target") {
        const targetType = source.targetType ?? (source.sourceType === "folder" ? "folder" : "file");
        if (targetType === "folder") {
          const targetPath = normalizeTargetPath(source.path);
          const folder = this.app.vault.getFolderByPath(targetPath === "/" ? "" : targetPath);
          if (!folder) {
            continue;
          }

          restoredTargets.push(this.createTargetSource("folder", folder.path || "/", source.label));
          continue;
        }

        const file = this.app.vault.getFileByPath(source.path);
        if (!file || !this.isMarkdownFile(file)) {
          continue;
        }

        restoredTargets.push(this.createTargetSource("file", file.path, source.label));
        continue;
      }

      if (source.sourceType === "folder") {
        const folder = this.app.vault.getFolderByPath(source.path);
        if (!folder) {
          continue;
        }

        const markdownFiles = this.collectMarkdownFiles(folder);
        if (markdownFiles.length === 0) {
          continue;
        }

        const sourceId = this.getSourceId("folder", folder.path || "/");
        restoredSources.push({
          id: sourceId,
          type: "folder",
          path: folder.path || "/",
          label: source.label || folder.path || "/",
          expanded: false,
          files: markdownFiles.map((file) => this.createResolvedFile(file, sourceId))
        });
        continue;
      }

      const file = this.app.vault.getFileByPath(source.path);
      if (!file || !this.isMarkdownFile(file)) {
        continue;
      }

      restoredSources.push(this.createFileSource(file, source.sourceType));
    }

    this.sources = restoredSources;
    this.targetSources = this.dedupeTargetSources(restoredTargets);
    this.emitChange();
  }

  addCurrentNote(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active Markdown note to add as context.");
      return;
    }

    this.addFile(activeFile, "current-note");
  }

  addFile(file: TFile, sourceType: SourceFileType = "note"): void {
    this.addFiles([file], sourceType);
  }

  addFiles(files: TFile[], sourceType: SourceFileType = "note"): void {
    const markdownFiles = files.filter((file) => this.isMarkdownFile(file));
    if (markdownFiles.length === 0) {
      new Notice("Only Markdown notes can be added as context.");
      return;
    }

    const contextFiles = markdownFiles.filter((file) => !isAssistantOwnedPath(file.path));
    if (contextFiles.length === 0) {
      new Notice("Assistant files cannot be added as context.");
      return;
    }

    for (const file of contextFiles) {
      const source = this.createFileSource(file, sourceType);
      this.upsertSource(source);
    }

    this.emitChange();
  }

  addFolder(folder: TFolder): void {
    if (isAssistantOwnedPath(folder.path || "/")) {
      new Notice("Assistant folders cannot be added as context.");
      return;
    }

    const markdownFiles = this.collectMarkdownFiles(folder);
    if (markdownFiles.length === 0) {
      new Notice("No Markdown notes found in that folder.");
      return;
    }

    this.upsertSource({
      id: this.getSourceId("folder", folder.path || "/"),
      type: "folder",
      path: folder.path || "/",
      label: folder.path || "/",
      expanded: false,
      files: markdownFiles.map((file) => this.createResolvedFile(file, this.getSourceId("folder", folder.path || "/")))
    });
    this.emitChange();
  }

  addTargetFile(file: TFile): void {
    if (!this.isMarkdownFile(file)) {
      new Notice("Only Markdown notes can be used as edit targets.");
      return;
    }

    if (isAssistantOwnedPath(file.path)) {
      new Notice("Assistant files cannot be used as edit targets.");
      return;
    }

    this.upsertTargetSource(this.createTargetSource("file", file.path));
    this.emitChange();
  }

  addTargetFolder(folder: TFolder): void {
    if (isAssistantOwnedPath(folder.path || "/")) {
      new Notice("Assistant folders cannot be used as edit targets.");
      return;
    }

    this.upsertTargetSource(this.createTargetSource("folder", folder.path || "/"));
    this.emitChange();
  }

  removeSource(sourceId: string): void {
    const originalLength = this.sources.length;
    this.sources = this.sources.filter((source) => source.id !== sourceId);

    if (this.sources.length !== originalLength) {
      this.emitChange();
    }
  }

  clearSources(): void {
    if (this.sources.length === 0) {
      return;
    }

    this.sources = [];
    this.emitChange();
  }

  clearSourcesAndTargets(): void {
    if (this.sources.length === 0 && this.targetSources.length === 0) {
      return;
    }

    this.sources = [];
    this.targetSources = [];
    this.emitChange();
  }

  removeTargetSource(sourceId: string): void {
    const originalLength = this.targetSources.length;
    this.targetSources = this.targetSources.filter((source) => source.id !== sourceId);

    if (this.targetSources.length !== originalLength) {
      this.emitChange();
    }
  }

  toggleSourceExpanded(sourceId: string): void {
    this.sources = this.sources.map((source) => {
      if (source.id !== sourceId) {
        return source;
      }

      return {
        ...source,
        expanded: !source.expanded
      };
    });
    this.emitChange();
  }

  async buildContextPackage(options: ActiveFileContextOptions = {}): Promise<ContextPackage> {
    const packageFiles: ContextPackageFile[] = [];

    for (const resolvedFile of this.getIncludedFiles(options)) {
      const file = this.app.vault.getFileByPath(resolvedFile.path);
      if (!file || !this.isMarkdownFile(file) || isAssistantOwnedPath(file.path)) {
        continue;
      }

      const content = await this.app.vault.cachedRead(file);
      packageFiles.push({
        path: resolvedFile.path,
        content,
        charCount: content.length,
        estimatedTokens: estimateTokensFromChars(content.length),
        sourceIds: resolvedFile.sourceIds.slice()
      });
    }

    const sourceIds = packageFiles.reduce<string[]>((result, file) => {
      for (const sourceId of file.sourceIds) {
        if (!result.includes(sourceId)) {
          result.push(sourceId);
        }
      }

      return result;
    }, []);

    return {
      files: packageFiles,
      totalCharacters: packageFiles.reduce((total, file) => total + file.charCount, 0),
      totalEstimatedTokens: packageFiles.reduce(
        (total, file) => total + file.estimatedTokens,
        0
      ),
      sourceIds: sourceIds.sort()
    };
  }

  private createFileSource(file: TFile, sourceType: SourceFileType): ContextSource {
    const sourceId = this.getSourceId(sourceType, file.path);

    return {
      id: sourceId,
      type: sourceType,
      path: file.path,
      label: file.path,
      expanded: false,
      files: [this.createResolvedFile(file, sourceId)]
    };
  }

  private createResolvedFile(file: TFile, sourceId: string): ResolvedContextFile {
    const charCount = file.stat.size;

    return {
      path: file.path,
      basename: file.basename,
      extension: file.extension,
      sourceIds: [sourceId],
      charCount,
      estimatedTokens: estimateTokensFromChars(charCount)
    };
  }

  private collectMarkdownFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];

    const visit = (item: TAbstractFile): void => {
      if (isAssistantOwnedPath(item.path || "/")) {
        return;
      }

      if (item instanceof TFile && this.isMarkdownFile(item)) {
        files.push(item);
        return;
      }

      if (item instanceof TFolder) {
        for (const child of item.children) {
          visit(child);
        }
      }
    };

    visit(folder);
    return files.sort((first, second) => first.path.localeCompare(second.path));
  }

  private isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === "md";
  }

  private cloneSources(sources: ContextSource[]): ContextSource[] {
    return sources.map((source) => ({
      ...source,
      files: source.files.map((file) => ({
        ...file,
        sourceIds: file.sourceIds.slice()
      }))
    }));
  }

  private createActiveFileContextSource(existingSources: ContextSource[]): ContextSource | null {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile || this.isPathIncludedInSources(existingSources, activeFile.path)) {
      return null;
    }

    const sourceId = this.getSourceId("current-note", activeFile.path);
    return {
      id: sourceId,
      type: "current-note",
      path: activeFile.path,
      label: activeFile.path,
      expanded: false,
      files: [this.createResolvedFile(activeFile, sourceId)],
      automatic: true
    };
  }

  private createActiveFileDirectoryTargetSource(): OperationTargetSource | null {
    const activeFile = this.getActiveMarkdownFile();
    if (!activeFile) {
      return null;
    }

    const folderPath = normalizeTargetPath(activeFile.parent?.path ?? "/");
    return {
      id: this.getTargetSourceId("folder", folderPath),
      type: "folder",
      path: folderPath,
      label: folderPath,
      explicit: false,
      automatic: true
    };
  }

  private getActiveMarkdownFile(): TFile | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || !this.isMarkdownFile(activeFile) || isAssistantOwnedPath(activeFile.path)) {
      return null;
    }

    return activeFile;
  }

  private isPathIncludedInSources(sources: ContextSource[], path: string): boolean {
    return sources.some((source) => source.files.some((file) => file.path === path));
  }

  private getSourceId(type: ContextSourceType, path: string): string {
    return `${type}:${path}`;
  }

  private getTargetSourceId(type: OperationTargetSource["type"], path: string): string {
    return `target:${type}:${normalizeTargetPath(path)}`;
  }

  private createTargetSource(
    type: OperationTargetSource["type"],
    path: string,
    label?: string
  ): OperationTargetSource {
    const targetPath = normalizeTargetPath(path);

    return {
      id: this.getTargetSourceId(type, targetPath),
      type,
      path: targetPath,
      label: label || targetPath,
      explicit: true
    };
  }

  private upsertTargetSource(source: OperationTargetSource): void {
    const sourceIndex = this.targetSources.findIndex((existing) => existing.id === source.id);
    if (sourceIndex === -1) {
      this.targetSources.push(source);
      return;
    }

    this.targetSources = this.targetSources.map((existing) => {
      if (existing.id !== source.id) {
        return existing;
      }

      return source;
    });
  }

  private dedupeTargetSources(sources: OperationTargetSource[]): OperationTargetSource[] {
    const byId = new Map<string, OperationTargetSource>();
    for (const source of sources) {
      byId.set(source.id, source);
    }

    return Array.from(byId.values()).sort((first, second) =>
      first.path.localeCompare(second.path)
    );
  }

  private upsertSource(source: ContextSource): void {
    const sourceIndex = this.sources.findIndex((existing) => existing.id === source.id);
    if (sourceIndex === -1) {
      this.sources.push(source);
      return;
    }

    this.sources = this.sources.map((existing) => {
      if (existing.id !== source.id) {
        return existing;
      }

      return source;
    });
  }

  private emitChange(): void {
    this.onChange();
  }
}
