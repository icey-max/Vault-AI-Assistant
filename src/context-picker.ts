import { App, Modal, Setting, TAbstractFile, TFile, TFolder, setIcon } from "obsidian";
import { ContextSource, isAssistantOwnedPath } from "./context-utils";
import { isSupportedImagePath } from "./image-attachments";

interface ContextPickerCopy {
  mode?: "context" | "target";
  currentSources?: ContextSource[];
  onChooseFolder?: (folder: TFolder) => void;
  onRemoveContext?: (sourceId: string) => void;
}

export function openMarkdownNotesPicker(
  app: App,
  onChoose: (files: TFile[]) => void,
  copy: ContextPickerCopy = {}
): void {
  if ((copy.mode ?? "context") === "context") {
    new NavigableContextPickerModal(app, onChoose, copy).open();
    return;
  }

  new MarkdownNotesPickerModal(app, onChoose, copy).open();
}

export function openFolderPicker(
  app: App,
  onChoose: (folder: TFolder) => void,
  copy: ContextPickerCopy = {}
): void {
  if ((copy.mode ?? "context") === "target") {
    new NavigableScopeFolderPickerModal(app, onChoose).open();
    return;
  }

  new FolderPickerModal(app, onChoose, copy).open();
}

export function openImageAttachmentPicker(
  app: App,
  onChoose: (file: TFile) => void
): void {
  new ImageAttachmentPickerModal(app, onChoose).open();
}

class MarkdownNotesPickerModal extends Modal {
  private files: TFile[];
  private selectedPaths = new Set<string>();
  private onChoose: (files: TFile[]) => void;
  private copy: { mode: "context" | "target" };
  private listEl: HTMLElement | null = null;
  private filterValue = "";

  constructor(app: App, onChoose: (files: TFile[]) => void, copy: ContextPickerCopy) {
    super(app);
    this.files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !isAssistantOwnedPath(file.path))
      .sort((first, second) => first.path.localeCompare(second.path));
    this.onChoose = onChoose;
    this.copy = { mode: copy.mode ?? "context" };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.copy.mode === "target" ? "Set edit target note" : "Add notes"
    });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Filter notes";
    input.addClass("vault-ai-assistant-picker-filter");
    input.addEventListener("input", () => {
      this.filterValue = input.value;
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-list" });
    this.renderList();

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText(this.copy.mode === "target" ? "Set edit target note" : "Add notes")
          .setCta()
          .onClick(() => this.chooseSelected());
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.empty();
    for (const file of this.getFilteredFiles()) {
      const label = this.listEl.createEl("label", {
        cls: "vault-ai-assistant-picker-row"
      });
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.selectedPaths.has(file.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedPaths.add(file.path);
          return;
        }

        this.selectedPaths.delete(file.path);
      });
      label.createSpan({ text: file.path });
    }
  }

  private getFilteredFiles(): TFile[] {
    const query = this.filterValue.trim().toLowerCase();
    if (!query) {
      return this.files;
    }

    return this.files.filter((file) => file.path.toLowerCase().includes(query));
  }

  private chooseSelected(): void {
    if (this.selectedPaths.size === 0) {
      return;
    }

    const selectedFiles = this.files.filter((file) => this.selectedPaths.has(file.path));
    this.onChoose(selectedFiles);
    this.close();
  }
}

class NavigableContextPickerModal extends Modal {
  private rootFolder: TFolder;
  private currentFolder: TFolder;
  private onChooseFiles: (files: TFile[]) => void;
  private copy: ContextPickerCopy;
  private attachedSources: ContextSource[];
  private selectedFilePaths: Set<string>;
  private selectedFolderPaths: Set<string>;
  private pathEl: HTMLElement | null = null;
  private filterInputEl: HTMLInputElement | null = null;
  private attachedEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private filterValue = "";

  constructor(app: App, onChooseFiles: (files: TFile[]) => void, copy: ContextPickerCopy) {
    super(app);
    this.rootFolder = this.app.vault.getRoot();
    this.currentFolder = this.rootFolder;
    this.onChooseFiles = onChooseFiles;
    this.copy = copy;
    this.attachedSources = (copy.currentSources ?? []).filter(
      (source) => !isAssistantOwnedPath(source.path)
    );
    this.selectedFilePaths = new Set(
      this.attachedSources
        .filter((source) => source.type !== "folder")
        .map((source) => source.path)
    );
    this.selectedFolderPaths = new Set(
      this.attachedSources
        .filter((source) => source.type === "folder")
        .map((source) => source.path)
    );
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-ai-assistant-picker-modal", "vault-ai-assistant-context-browser-modal");

    const header = contentEl.createDiv({ cls: "vault-ai-assistant-picker-modal-header" });
    header.createEl("h2", { text: "Add context" });
    this.pathEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-helper" });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Filter this folder";
    input.addClass("vault-ai-assistant-picker-filter");
    this.filterInputEl = input;
    input.addEventListener("input", () => {
      this.filterValue = input.value;
      this.renderList();
    });

    this.attachedEl = contentEl.createDiv({
      cls: "vault-ai-assistant-picker-attached-context"
    });
    this.listEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-list" });
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.renderAttachedSources();
    this.renderList();
  }

  private renderAttachedSources(): void {
    if (!this.attachedEl) {
      return;
    }

    this.attachedEl.empty();
    if (this.attachedSources.length === 0) {
      this.attachedEl.createDiv({
        cls: "vault-ai-assistant-picker-helper",
        text: "No context attached."
      });
      return;
    }

    this.attachedEl.createDiv({
      cls: "vault-ai-assistant-picker-section-title",
      text: "Attached context"
    });

    for (const source of this.attachedSources) {
      const row = this.attachedEl.createDiv({ cls: "vault-ai-assistant-picker-attached-row" });
      row.createSpan({
        cls: "vault-ai-assistant-picker-attached-label",
        text: source.path
      });
      const remove = row.createEl("button", {
        cls: "vault-ai-assistant-picker-remove",
        text: "Remove"
      });
      remove.type = "button";
      remove.addEventListener("click", () => {
        this.removeAttachedSource(source);
      });
    }
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.pathEl?.setText(`Browsing ${this.getFolderLabel(this.currentFolder)}`);
    this.listEl.empty();

    if (!this.isRootFolder(this.currentFolder)) {
      this.renderUpRow();
      this.renderCurrentFolderRow();
    }

    const children = this.getFilteredChildren();
    if (children.length === 0) {
      this.listEl.createDiv({
        cls: "vault-ai-assistant-picker-helper",
        text: "No visible markdown files or folders here."
      });
      return;
    }

    for (const child of children) {
      if (child instanceof TFolder) {
        this.renderFolderRow(child);
        continue;
      }

      if (child instanceof TFile) {
        this.renderFileRow(child);
      }
    }
  }

  private renderUpRow(): void {
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-nav-row"
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.setAttr("aria-label", "Back to parent folder");
    const icon = row.createSpan({ cls: "vault-ai-assistant-picker-nav-icon" });
    setIcon(icon, "arrow-left");
    row.createSpan({ text: "Back to parent folder" });
    row.addEventListener("click", () => {
      const parent = this.currentFolder.parent;
      if (parent instanceof TFolder) {
        this.currentFolder = parent;
        this.clearFilter();
        this.renderList();
      }
    });
  }

  private renderCurrentFolderRow(): void {
    const folderPath = this.currentFolder.path || "/";
    const isSelected = this.selectedFolderPaths.has(folderPath);
    const hasMarkdownFiles = this.hasMarkdownFiles(this.currentFolder);
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-current-folder-row",
      text: this.getCurrentFolderActionLabel(folderPath, isSelected, hasMarkdownFiles)
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.disabled = isSelected || !hasMarkdownFiles || !this.copy.onChooseFolder;
    row.addEventListener("click", () => {
      if (isSelected || !hasMarkdownFiles || !this.copy.onChooseFolder) {
        return;
      }

      this.copy.onChooseFolder(this.currentFolder);
      this.selectedFolderPaths.add(folderPath);
      this.upsertAttachedSource({
        id: `folder:${folderPath}`,
        type: "folder",
        path: folderPath,
        label: folderPath,
        expanded: false,
        files: []
      });
      this.render();
    });
  }

  private renderFolderRow(folder: TFolder): void {
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-folder-row",
      text: `${folder.name || folder.path} /`
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.addEventListener("click", () => {
      this.currentFolder = folder;
      this.clearFilter();
      this.renderList();
    });
  }

  private renderFileRow(file: TFile): void {
    const isSelected = this.selectedFilePaths.has(file.path);
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-file-row",
      text: isSelected ? `File added: ${file.name}` : file.name
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.disabled = isSelected;
    row.addEventListener("click", () => {
      if (isSelected) {
        return;
      }

      this.onChooseFiles([file]);
      this.selectedFilePaths.add(file.path);
      this.upsertAttachedSource({
        id: `note:${file.path}`,
        type: "note",
        path: file.path,
        label: file.path,
        expanded: false,
        files: []
      });
      this.render();
    });
  }

  private getFilteredChildren(): TAbstractFile[] {
    const query = this.filterValue.trim().toLowerCase();
    const children = this.currentFolder.children.filter((child) => {
      if (isAssistantOwnedPath(child.path || "/")) {
        return false;
      }

      if (child instanceof TFolder) {
        return this.matchesQuery(child, query);
      }

      return (
        child instanceof TFile &&
        this.isMarkdownFile(child) &&
        this.matchesQuery(child, query)
      );
    });

    return children.sort((first, second) => {
      if (first instanceof TFolder && second instanceof TFile) {
        return -1;
      }
      if (first instanceof TFile && second instanceof TFolder) {
        return 1;
      }

      return first.name.localeCompare(second.name);
    });
  }

  private getCurrentFolderActionLabel(
    folderPath: string,
    isSelected: boolean,
    hasMarkdownFiles: boolean
  ): string {
    if (isSelected) {
      return `Folder added: ${folderPath}`;
    }

    if (!hasMarkdownFiles) {
      return `No markdown files in ${folderPath}`;
    }

    return `Add this whole folder: ${folderPath}`;
  }

  private hasMarkdownFiles(folder: TFolder): boolean {
    if (isAssistantOwnedPath(folder.path || "/")) {
      return false;
    }

    for (const child of folder.children) {
      if (isAssistantOwnedPath(child.path || "/")) {
        continue;
      }

      if (child instanceof TFile && this.isMarkdownFile(child)) {
        return true;
      }

      if (child instanceof TFolder && this.hasMarkdownFiles(child)) {
        return true;
      }
    }

    return false;
  }

  private matchesQuery(item: TAbstractFile, query: string): boolean {
    if (!query) {
      return true;
    }

    return item.name.toLowerCase().includes(query) || item.path.toLowerCase().includes(query);
  }

  private removeAttachedSource(source: ContextSource): void {
    this.attachedSources = this.attachedSources.filter((candidate) => candidate.id !== source.id);
    if (source.type === "folder") {
      this.selectedFolderPaths.delete(source.path);
    } else {
      this.selectedFilePaths.delete(source.path);
    }
    this.copy.onRemoveContext?.(source.id);
    this.render();
  }

  private upsertAttachedSource(source: ContextSource): void {
    this.attachedSources = this.attachedSources
      .filter((candidate) => candidate.id !== source.id)
      .concat(source)
      .sort((first, second) => first.path.localeCompare(second.path));
  }

  private isRootFolder(folder: TFolder): boolean {
    return (folder.path || "") === "";
  }

  private getFolderLabel(folder: TFolder): string {
    return folder.path || "/";
  }

  private clearFilter(): void {
    this.filterValue = "";
    if (this.filterInputEl) {
      this.filterInputEl.value = "";
    }
  }

  private isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === "md";
  }
}

class FolderPickerModal extends Modal {
  private folders: TFolder[];
  private onChoose: (folder: TFolder) => void;
  private copy: { mode: "context" | "target" };
  private listEl: HTMLElement | null = null;
  private filterValue = "";

  constructor(app: App, onChoose: (folder: TFolder) => void, copy: ContextPickerCopy) {
    super(app);
    this.copy = { mode: copy.mode ?? "context" };
    this.folders = this.app.vault
      .getAllFolders(this.copy.mode === "target")
      .filter((folder) => !isAssistantOwnedPath(folder.path || "/"))
      .sort((first, second) => (first.path || "/").localeCompare(second.path || "/"));
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.copy.mode === "target" ? "Set edit target folder" : "Add folder"
    });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Filter folders";
    input.addClass("vault-ai-assistant-picker-filter");
    input.addEventListener("input", () => {
      this.filterValue = input.value;
      this.renderList();
    });

    contentEl.createDiv({
      cls: "vault-ai-assistant-picker-helper",
      text:
        this.copy.mode === "target"
          ? "Edit target contents are not included as context."
          : "Includes markdown files in this folder and subfolders."
    });

    this.listEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-list" });
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.empty();
    for (const folder of this.getFilteredFolders()) {
      const row = this.listEl.createEl("button", {
        cls: "vault-ai-assistant-picker-row",
        text: folder.path || "/"
      });
      row.type = "button";
      row.addEventListener("click", () => {
        this.onChoose(folder);
        this.close();
      });
    }
  }

  private getFilteredFolders(): TFolder[] {
    const query = this.filterValue.trim().toLowerCase();
    if (!query) {
      return this.folders;
    }

    return this.folders.filter((folder) => {
      return (folder.path || "/").toLowerCase().includes(query);
    });
  }
}

class NavigableScopeFolderPickerModal extends Modal {
  private rootFolder: TFolder;
  private currentFolder: TFolder;
  private onChoose: (folder: TFolder) => void;
  private pathEl: HTMLElement | null = null;
  private filterInputEl: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private filterValue = "";

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.rootFolder = this.app.vault.getRoot();
    this.currentFolder = this.rootFolder;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-ai-assistant-picker-modal", "vault-ai-assistant-scope-browser-modal");

    const header = contentEl.createDiv({ cls: "vault-ai-assistant-picker-modal-header" });
    header.createEl("h2", { text: "Set edit target folder" });
    contentEl.createDiv({
      cls: "vault-ai-assistant-picker-helper",
      text: "Edit target folders are path hints only. Contents are not included as context."
    });
    this.pathEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-helper" });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Filter folders";
    input.addClass("vault-ai-assistant-picker-filter");
    this.filterInputEl = input;
    input.addEventListener("input", () => {
      this.filterValue = input.value;
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-list" });
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.pathEl?.setText(`Browsing ${this.getFolderLabel(this.currentFolder)}`);
    this.listEl.empty();

    if (!this.isRootFolder(this.currentFolder)) {
      this.renderUpRow();
    }
    this.renderCurrentFolderRow();

    const folders = this.getFilteredFolders();
    if (folders.length === 0) {
      this.listEl.createDiv({
        cls: "vault-ai-assistant-picker-helper",
        text: "No visible folders here."
      });
      return;
    }

    for (const folder of folders) {
      this.renderFolderRow(folder);
    }
  }

  private renderCurrentFolderRow(): void {
    const folderPath = this.currentFolder.path || "/";
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-current-folder-row",
      text: this.isRootFolder(this.currentFolder)
        ? "Set edit target to vault root"
        : `Set edit target to this folder: ${folderPath}`
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.addEventListener("click", () => {
      this.onChoose(this.currentFolder);
      this.close();
    });
  }

  private renderUpRow(): void {
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-nav-row"
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.setAttr("aria-label", "Back to parent folder");
    const icon = row.createSpan({ cls: "vault-ai-assistant-picker-nav-icon" });
    setIcon(icon, "arrow-left");
    row.createSpan({ text: "Back to parent folder" });
    row.addEventListener("click", () => {
      const parent = this.currentFolder.parent;
      if (parent instanceof TFolder) {
        this.currentFolder = parent;
        this.clearFilter();
        this.renderList();
      }
    });
  }

  private renderFolderRow(folder: TFolder): void {
    const row = this.listEl?.createEl("button", {
      cls: "vault-ai-assistant-picker-row vault-ai-assistant-picker-folder-row",
      text: `${folder.name || folder.path} /`
    });
    if (!row) {
      return;
    }

    row.type = "button";
    row.addEventListener("click", () => {
      this.currentFolder = folder;
      this.clearFilter();
      this.renderList();
    });
  }

  private getFilteredFolders(): TFolder[] {
    const query = this.filterValue.trim().toLowerCase();
    return this.currentFolder.children
      .filter((child): child is TFolder => {
        return (
          child instanceof TFolder &&
          !isAssistantOwnedPath(child.path || "/") &&
          this.matchesQuery(child, query)
        );
      })
      .sort((first, second) => first.name.localeCompare(second.name));
  }

  private matchesQuery(folder: TFolder, query: string): boolean {
    if (!query) {
      return true;
    }

    return folder.name.toLowerCase().includes(query) || folder.path.toLowerCase().includes(query);
  }

  private isRootFolder(folder: TFolder): boolean {
    return (folder.path || "") === "";
  }

  private getFolderLabel(folder: TFolder): string {
    return folder.path || "/";
  }

  private clearFilter(): void {
    this.filterValue = "";
    if (this.filterInputEl) {
      this.filterInputEl.value = "";
    }
  }
}

class ImageAttachmentPickerModal extends Modal {
  private files: TFile[];
  private onChoose: (file: TFile) => void;
  private listEl: HTMLElement | null = null;
  private filterValue = "";

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.files = this.app.vault
      .getFiles()
      .filter((file) => isSupportedImagePath(file.path))
      .sort((first, second) => first.path.localeCompare(second.path));
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vault-ai-assistant-picker-modal", "vault-ai-assistant-image-picker-modal");
    const header = contentEl.createDiv({ cls: "vault-ai-assistant-picker-modal-header" });
    header.createEl("h2", { text: "Attach image" });

    const input = contentEl.createEl("input");
    input.type = "text";
    input.placeholder = "Filter images";
    input.addClass("vault-ai-assistant-picker-filter");
    input.addEventListener("input", () => {
      this.filterValue = input.value;
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "vault-ai-assistant-picker-list" });
    this.renderList();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.empty();
    for (const file of this.getFilteredFiles()) {
      const row = this.listEl.createEl("button", {
        cls: "vault-ai-assistant-picker-row",
        text: file.path
      });
      row.type = "button";
      row.addEventListener("click", () => {
        this.onChoose(file);
        this.close();
      });
    }
  }

  private getFilteredFiles(): TFile[] {
    const query = this.filterValue.trim().toLowerCase();
    if (!query) {
      return this.files;
    }

    return this.files.filter((file) => file.path.toLowerCase().includes(query));
  }
}
