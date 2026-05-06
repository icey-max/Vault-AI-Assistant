import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
  VAULT_AI_ASSISTANT_VIEW_TYPE,
  VaultAIAssistantView
} from "./assistant-view";
import { ChatStore } from "./chat-store";
import { VaultContextManager } from "./context";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  VaultAIAssistantSettingTab
} from "./settings";
import type { AssistantViewLocation, VaultAIAssistantSettings } from "./settings";
import { ensureSystemPromptFiles } from "./system-prompts";
import { VaultOperationExecutor } from "./vault-operation-executor";

export default class VaultAIAssistantPlugin extends Plugin {
  settings: VaultAIAssistantSettings;
  contextManager: VaultContextManager;
  chatStore: ChatStore;
  operationExecutor: VaultOperationExecutor;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.ensureEditableSystemPrompts();
    this.contextManager = new VaultContextManager(this.app, () => this.refreshAssistantViews());
    this.chatStore = new ChatStore(
      this.app.vault,
      () => this.refreshAssistantViews(),
      this.app.fileManager
    );
    await this.pruneSavedChatHistory();
    this.operationExecutor = new VaultOperationExecutor(this.app.vault, this.app.fileManager);
    this.addSettingTab(new VaultAIAssistantSettingTab(this.app, this));
    this.registerView(
      VAULT_AI_ASSISTANT_VIEW_TYPE,
      (leaf) => new VaultAIAssistantView(leaf, this)
    );
    this.addCommand({
      id: "open-assistant",
      name: "Open assistant",
      callback: () => {
        void this.activateView();
      }
    });
    this.addRibbonIcon("message-square", "Open assistant", () => {
      void this.activateView();
    });
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshAssistantViews()));
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...(await this.loadData()) });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshAssistantViews();
  }

  async pruneSavedChatHistory(): Promise<void> {
    if (!this.chatStore || this.settings.chatHistoryRetentionDays === null) {
      return;
    }

    await this.chatStore.pruneSavedConversations(this.settings.chatHistoryRetentionDays);
    this.refreshAssistantViews();
  }

  async ensureEditableSystemPrompts(): Promise<boolean> {
    try {
      await ensureSystemPromptFiles(this.app.vault);
      return true;
    } catch (error) {
      console.error("Vault AI Assistant could not create system prompt files.", error);
      return false;
    }
  }

  async activateView(): Promise<void> {
    let leaf = this.getAssistantLeafForLocation(this.settings.assistantViewLocation);

    if (!leaf) {
      leaf = this.createAssistantLeafForLocation(this.settings.assistantViewLocation);
    }

    if (!leaf) {
      new Notice("Unable to open assistant view.");
      return;
    }

    await leaf.setViewState({
      type: VAULT_AI_ASSISTANT_VIEW_TYPE,
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private getAssistantLeafForLocation(location: AssistantViewLocation): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(VAULT_AI_ASSISTANT_VIEW_TYPE);

    return (
      leaves.find((leaf) =>
        location === "sidebar" ? this.isLeafInSidebar(leaf) : this.isLeafInEditor(leaf)
      ) ?? null
    );
  }

  private createAssistantLeafForLocation(
    location: AssistantViewLocation
  ): WorkspaceLeaf | null {
    if (location === "editor") {
      return this.app.workspace.getLeaf("tab");
    }

    return this.app.workspace.getRightLeaf(false);
  }

  private isLeafInSidebar(leaf: WorkspaceLeaf): boolean {
    return (
      this.isWorkspaceItemWithin(leaf, this.app.workspace.leftSplit) ||
      this.isWorkspaceItemWithin(leaf, this.app.workspace.rightSplit)
    );
  }

  private isLeafInEditor(leaf: WorkspaceLeaf): boolean {
    return this.isWorkspaceItemWithin(leaf, this.app.workspace.rootSplit);
  }

  private isWorkspaceItemWithin(item: unknown, container: unknown): boolean {
    let parent = this.getWorkspaceItemParent(item);
    while (parent) {
      if (parent === container) {
        return true;
      }

      parent = this.getWorkspaceItemParent(parent);
    }

    return false;
  }

  private getWorkspaceItemParent(item: unknown): object | null {
    if (!item || typeof item !== "object" || !("parent" in item)) {
      return null;
    }

    const parent = (item as { parent?: unknown }).parent;
    return parent && typeof parent === "object" ? parent : null;
  }

  openSettings(): void {
    new Notice("Open plugin settings to configure providers.");
  }

  refreshAssistantViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VAULT_AI_ASSISTANT_VIEW_TYPE)) {
      if (leaf.view instanceof VaultAIAssistantView) {
        leaf.view.render();
      }
    }
  }
}
