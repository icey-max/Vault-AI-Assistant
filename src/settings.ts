import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type VaultAIAssistantPlugin from "./main";
import {
  MODEL_OPTIONS,
  modelSupportsImages as optionModelSupportsImages,
  type ModelOption,
  type ProviderId
} from "./model-options";
import {
  DEFAULT_SYSTEM_PROMPT_PRESET_ID,
  normalizeSystemPromptPresetId,
  type SystemPromptPresetId
} from "./system-prompts";

export { MODEL_OPTIONS, type ModelOption, type ProviderId };

export interface VaultAIAssistantSettings {
  activeProvider: ProviderId;
  openaiSecretName: string;
  openaiModel: string;
  anthropicSecretName: string;
  anthropicModel: string;
  systemPromptPresetId: SystemPromptPresetId;
  assistantViewLocation: AssistantViewLocation;
  autoAttachActiveFileContext: boolean;
  chatHistoryRetentionDays: ChatHistoryRetentionDays;
  maxOutputTokens: number;
  diagnosticLoggingEnabled: boolean;
}

export type AssistantViewLocation = "sidebar" | "editor";
export type ChatHistoryRetentionDays = null | 1 | 3 | 7 | 30 | 60 | 90;
export const DEFAULT_MAX_OUTPUT_TOKENS = 6000;
export const OUTPUT_TOKEN_LIMIT_MIN = 256;
export const OUTPUT_TOKEN_LIMIT_MAX = 128000;

export const CHAT_HISTORY_RETENTION_OPTIONS: Exclude<ChatHistoryRetentionDays, null>[] = [
  1,
  3,
  7,
  30,
  60,
  90
];

export const DEFAULT_SETTINGS: VaultAIAssistantSettings = {
  activeProvider: "openai",
  openaiSecretName: "",
  openaiModel: "gpt-5.4-mini",
  anthropicSecretName: "",
  anthropicModel: "claude-sonnet-4-6",
  systemPromptPresetId: DEFAULT_SYSTEM_PROMPT_PRESET_ID,
  assistantViewLocation: "sidebar",
  autoAttachActiveFileContext: false,
  chatHistoryRetentionDays: null,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  diagnosticLoggingEnabled: false
};

export function hasConfiguredProvider(settings: VaultAIAssistantSettings): boolean {
  if (settings.activeProvider === "openai") {
    return settings.openaiSecretName.trim().length > 0 && settings.openaiModel.trim().length > 0;
  }

  return settings.anthropicSecretName.trim().length > 0 && settings.anthropicModel.trim().length > 0;
}

export function hasAvailableProvider(app: App, settings: VaultAIAssistantSettings): boolean {
  return (
    hasAvailableProviderKey(app, settings, settings.activeProvider) &&
    getSelectedModelForProvider(settings, settings.activeProvider).trim().length > 0
  );
}

export function hasAnyAvailableProvider(app: App, settings: VaultAIAssistantSettings): boolean {
  return (["openai", "anthropic"] as ProviderId[]).some(
    (provider) =>
      hasAvailableProviderKey(app, settings, provider) &&
      getSelectedModelForProvider(settings, provider).trim().length > 0
  );
}

export function getProviderSecretName(
  settings: VaultAIAssistantSettings,
  provider: ProviderId
): string {
  return provider === "openai" ? settings.openaiSecretName : settings.anthropicSecretName;
}

export function hasAvailableProviderKey(
  app: App,
  settings: VaultAIAssistantSettings,
  provider: ProviderId
): boolean {
  return hasAvailableSecret(app, getProviderSecretName(settings, provider));
}

export function getSelectedModelForProvider(
  settings: VaultAIAssistantSettings,
  provider: ProviderId
): string {
  return provider === "openai" ? settings.openaiModel : settings.anthropicModel;
}

export function setSelectedModelForProvider(
  settings: VaultAIAssistantSettings,
  provider: ProviderId,
  model: string
): void {
  if (!isModelOption(provider, model)) {
    return;
  }

  settings.activeProvider = provider;
  if (provider === "openai") {
    settings.openaiModel = model;
    return;
  }

  settings.anthropicModel = model;
}

function hasAvailableSecret(app: App, secretName: string): boolean {
  const id = secretName.trim();

  if (!id) {
    return false;
  }

  return (app.secretStorage.getSecret(id) ?? "").trim().length > 0;
}

export function normalizeSettings(settings: VaultAIAssistantSettings): VaultAIAssistantSettings {
  const normalized = { ...settings };

  if (!isModelOption("openai", normalized.openaiModel)) {
    normalized.openaiModel = DEFAULT_SETTINGS.openaiModel;
  }

  if (!isModelOption("anthropic", normalized.anthropicModel)) {
    normalized.anthropicModel = DEFAULT_SETTINGS.anthropicModel;
  }

  normalized.systemPromptPresetId = normalizeSystemPromptPresetId(
    normalized.systemPromptPresetId
  );
  normalized.assistantViewLocation = normalizeAssistantViewLocation(
    normalized.assistantViewLocation
  );
  normalized.autoAttachActiveFileContext = normalized.autoAttachActiveFileContext === true;
  normalized.chatHistoryRetentionDays = normalizeChatHistoryRetentionDays(
    normalized.chatHistoryRetentionDays
  );
  normalized.maxOutputTokens = normalizeOutputTokenLimit(normalized.maxOutputTokens);
  normalized.diagnosticLoggingEnabled = normalized.diagnosticLoggingEnabled === true;

  return normalized;
}

export function normalizeOutputTokenLimit(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }

  return Math.min(
    OUTPUT_TOKEN_LIMIT_MAX,
    Math.max(OUTPUT_TOKEN_LIMIT_MIN, Math.round(numeric))
  );
}

export function normalizeChatHistoryRetentionDays(value: unknown): ChatHistoryRetentionDays {
  if (typeof value !== "number") {
    return null;
  }

  return CHAT_HISTORY_RETENTION_OPTIONS.includes(
    value as Exclude<ChatHistoryRetentionDays, null>
  )
    ? (value as Exclude<ChatHistoryRetentionDays, null>)
    : null;
}

export function normalizeAssistantViewLocation(value: unknown): AssistantViewLocation {
  return value === "editor" ? "editor" : "sidebar";
}

function isModelOption(provider: ProviderId, model: string): boolean {
  return MODEL_OPTIONS[provider].some((option) => option.value === model);
}

export function modelSupportsImages(provider: ProviderId, model: string): boolean {
  return optionModelSupportsImages(provider, model);
}

export class VaultAIAssistantSettingTab extends PluginSettingTab {
  plugin: VaultAIAssistantPlugin;

  constructor(app: App, plugin: VaultAIAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.addProviderSection({
      heading: "OpenAI",
      secretField: "openaiSecretName"
    });

    this.addProviderSection({
      heading: "Anthropic",
      secretField: "anthropicSecretName"
    });

    this.addResponseSection();
    this.addInterfaceSection();
    this.addContextSection();
    this.addChatHistorySection();
    this.addDiagnosticsSection();
  }

  private addInterfaceSection(): void {
    new Setting(this.containerEl).setName("Interface").setHeading();

    new Setting(this.containerEl)
      .setName("Assistant view")
      .setDesc("Choose where the open assistant command opens the assistant.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("sidebar", "Sidebar view")
          .addOption("editor", "Editor")
          .setValue(this.plugin.settings.assistantViewLocation)
          .onChange(async (value) => {
            this.plugin.settings.assistantViewLocation = normalizeAssistantViewLocation(value);
            await this.plugin.saveSettings();
          });
      });
  }

  private addContextSection(): void {
    new Setting(this.containerEl).setName("Context").setHeading();

    new Setting(this.containerEl)
      .setName("Auto attach active note")
      .setDesc(
        "When enabled, each message includes the active Markdown note as readable context and uses that note's folder as the default edit target."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.autoAttachActiveFileContext)
          .onChange(async (value) => {
            this.plugin.settings.autoAttachActiveFileContext = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private addResponseSection(): void {
    new Setting(this.containerEl).setName("Responses").setHeading();

    const setting = new Setting(this.containerEl)
      .setName("Token limit")
      .setDesc(
        [
          "Controls the most the AI can write in one reply.",
          "A token is a small chunk of text.",
          "Raise this for longer answers or large vault-change proposals.",
          "Lower it to keep replies shorter, faster, and cheaper.",
          "The AI can still stop early, and each provider/model may have its own maximum."
        ].join(" ")
      );
    this.renderTokenLimitControl(setting);
  }

  private renderTokenLimitControl(setting: Setting): void {
    setting.settingEl.addClass("vault-ai-assistant-token-limit-setting");
    setting.controlEl.empty();

    const control = setting.controlEl.createDiv({
      cls: "vault-ai-assistant-token-limit-control"
    });
    const numberInput = control.createEl("input", {
      cls: "vault-ai-assistant-token-limit-number",
      attr: {
        "aria-label": "Token limit",
        inputmode: "numeric",
        max: String(OUTPUT_TOKEN_LIMIT_MAX),
        min: String(OUTPUT_TOKEN_LIMIT_MIN),
        step: "1",
        type: "number"
      }
    });
    numberInput.value = String(this.plugin.settings.maxOutputTokens);

    const sliderWrap = control.createDiv({
      cls: "vault-ai-assistant-token-limit-slider-wrap"
    });
    const rangeInput = sliderWrap.createEl("input", {
      cls: "vault-ai-assistant-token-limit-slider",
      attr: {
        "aria-label": "Token limit visual scale",
        max: String(OUTPUT_TOKEN_LIMIT_MAX),
        min: String(OUTPUT_TOKEN_LIMIT_MIN),
        step: "1",
        type: "range"
      }
    });
    rangeInput.value = String(this.plugin.settings.maxOutputTokens);

    const visual = sliderWrap.createDiv({
      cls: "vault-ai-assistant-token-limit-slider-visual",
      attr: { "aria-hidden": "true" }
    });
    visual.createDiv({ cls: "vault-ai-assistant-token-limit-slider-track" });
    visual.createDiv({ cls: "vault-ai-assistant-token-limit-slider-thumb" });

    const ticks = sliderWrap.createDiv({
      cls: "vault-ai-assistant-token-limit-ticks",
      attr: { "aria-hidden": "true" }
    });
    for (let index = 0; index < 5; index += 1) {
      ticks.createSpan({ text: "|" });
    }

    const labels = sliderWrap.createDiv({ cls: "vault-ai-assistant-token-limit-labels" });
    labels.createSpan({ cls: "vault-ai-assistant-token-limit-label-low", text: "Shorter" });
    labels.createSpan({ text: "Balanced" });
    labels.createSpan({ cls: "vault-ai-assistant-token-limit-label-high", text: "Longer" });

    const updateControlValue = (value: unknown): number => {
      const normalized = normalizeOutputTokenLimit(value);
      const percentage =
        ((normalized - OUTPUT_TOKEN_LIMIT_MIN) /
          (OUTPUT_TOKEN_LIMIT_MAX - OUTPUT_TOKEN_LIMIT_MIN)) *
        100;
      this.plugin.settings.maxOutputTokens = normalized;
      numberInput.value = String(normalized);
      rangeInput.value = String(normalized);
      sliderWrap.setCssProps({
        "--vault-ai-assistant-token-limit-position": `${percentage}%`
      });
      return normalized;
    };
    const commitValue = async (value: unknown): Promise<void> => {
      updateControlValue(value);
      await this.plugin.saveSettings();
    };
    const setValueFromVisualPointer = (event: PointerEvent): void => {
      const bounds = visual.getBoundingClientRect();
      if (bounds.width <= 0) {
        return;
      }

      const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const value = Math.round(
        OUTPUT_TOKEN_LIMIT_MIN + ratio * (OUTPUT_TOKEN_LIMIT_MAX - OUTPUT_TOKEN_LIMIT_MIN)
      );
      updateControlValue(value);
    };
    let isDraggingVisualScale = false;
    updateControlValue(this.plugin.settings.maxOutputTokens);

    rangeInput.addEventListener("input", () => {
      updateControlValue(rangeInput.value);
    });
    rangeInput.addEventListener("change", () => {
      void commitValue(rangeInput.value);
    });
    sliderWrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      isDraggingVisualScale = true;
      sliderWrap.setPointerCapture(event.pointerId);
      setValueFromVisualPointer(event);
    });
    sliderWrap.addEventListener("pointermove", (event) => {
      if (!isDraggingVisualScale) {
        return;
      }

      setValueFromVisualPointer(event);
    });
    sliderWrap.addEventListener("pointerup", (event) => {
      if (!isDraggingVisualScale) {
        return;
      }

      isDraggingVisualScale = false;
      setValueFromVisualPointer(event);
      void commitValue(rangeInput.value);
    });
    sliderWrap.addEventListener("pointercancel", () => {
      if (!isDraggingVisualScale) {
        return;
      }

      isDraggingVisualScale = false;
      void commitValue(rangeInput.value);
    });
    numberInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        numberInput.blur();
      }
    });
    numberInput.addEventListener("blur", () => {
      void commitValue(numberInput.value);
    });
  }

  private addChatHistorySection(): void {
    new Setting(this.containerEl).setName("Chat history").setHeading();

    new Setting(this.containerEl)
      .setName("Delete chat history")
      .setDesc("Automatically move saved chat history older than this window to Obsidian trash.")
      .addDropdown((dropdown) => {
        dropdown.addOption("never", "Never");
        for (const days of CHAT_HISTORY_RETENTION_OPTIONS) {
          dropdown.addOption(String(days), `${days} ${days === 1 ? "day" : "days"}`);
        }

        dropdown
          .setValue(
            this.plugin.settings.chatHistoryRetentionDays === null
              ? "never"
              : String(this.plugin.settings.chatHistoryRetentionDays)
          )
          .onChange(async (value) => {
            this.plugin.settings.chatHistoryRetentionDays = normalizeChatHistoryRetentionDays(
              value === "never" ? null : Number(value)
            );
            await this.plugin.saveSettings();
            await this.plugin.pruneSavedChatHistory();
          });
      });
  }

  private addDiagnosticsSection(): void {
    new Setting(this.containerEl).setName("Diagnostics").setHeading();

    new Setting(this.containerEl)
      .setName("Provider diagnostics")
      .setDesc(
        "Write provider request and stream metadata to vault-ai-assistant/diagnostics. Logs include model, tool decisions, event types, token counts, and note paths, but not API keys or note contents."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.diagnosticLoggingEnabled)
          .onChange(async (value) => {
            this.plugin.settings.diagnosticLoggingEnabled = value;
            await this.plugin.saveSettings();
          });
      });
  }

  private addProviderSection(options: {
    heading: string;
    secretField: "openaiSecretName" | "anthropicSecretName";
  }): void {
    new Setting(this.containerEl).setName(options.heading).setHeading();

    new Setting(this.containerEl)
      .setName("API key")
      .setDesc(`Select or create the ${options.heading} API key in Obsidian SecretStorage.`)
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings[options.secretField])
          .onChange(async (value) => {
            this.plugin.settings[options.secretField] = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
