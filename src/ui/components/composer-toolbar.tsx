import * as React from "react";
import { Check, History, MessageSquarePlus, Settings } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";
import type { SystemPromptPresetId } from "../../system-prompts";

export interface ComposerChatHistoryRow {
  filePath: string;
  title: string;
  formattedDate: string;
}

export interface ComposerSystemPromptOption {
  id: SystemPromptPresetId;
  label: string;
}

interface ComposerToolbarProps {
  chatHistoryOpen: boolean;
  chatSettingsOpen: boolean;
  chatHistoryLoading: boolean;
  chatHistoryRows: ComposerChatHistoryRow[];
  systemPromptOptions: ComposerSystemPromptOption[];
  selectedSystemPromptId: SystemPromptPresetId;
  onNewChat: () => void;
  onToggleChatHistory: () => void;
  onToggleSettings: () => void;
  onOpenSavedChat: (filePath: string) => void;
  onSelectSystemPrompt: (presetId: SystemPromptPresetId) => void;
}

export function ComposerToolbar({
  chatHistoryOpen,
  chatSettingsOpen,
  chatHistoryLoading,
  chatHistoryRows,
  systemPromptOptions,
  selectedSystemPromptId,
  onNewChat,
  onToggleChatHistory,
  onToggleSettings,
  onOpenSavedChat,
  onSelectSystemPrompt
}: ComposerToolbarProps): React.ReactElement {
  return (
    <div className="vault-ai-assistant-composer-settings">
      <div className="vault-ai-assistant-toolbar-nav">
        <ToolbarButton label="New chat" className="vault-ai-assistant-new-chat" onClick={onNewChat}>
          <MessageSquarePlus size={16} strokeWidth={1.8} />
        </ToolbarButton>
        <ToolbarButton
          label="Chat history"
          className="vault-ai-assistant-chat-history-toggle"
          active={chatHistoryOpen}
          ariaPressed={chatHistoryOpen}
          onClick={onToggleChatHistory}
        >
          <History size={16} strokeWidth={1.8} />
        </ToolbarButton>
        <ToolbarButton
          label="Settings"
          className="vault-ai-assistant-chat-settings-toggle"
          active={chatSettingsOpen}
          ariaPressed={chatSettingsOpen}
          onClick={onToggleSettings}
        >
          <Settings size={16} strokeWidth={1.8} />
        </ToolbarButton>
      </div>

      {chatHistoryOpen || chatSettingsOpen ? (
        <div
          className={cn(
            "vault-ai-assistant-toolbar-popover",
            chatHistoryOpen
              ? "vault-ai-assistant-toolbar-popover-history"
              : "vault-ai-assistant-toolbar-popover-settings"
          )}
          role="dialog"
          aria-label={chatHistoryOpen ? "Chat history" : "System Prompt"}
        >
          {chatHistoryOpen ? (
            <ChatHistoryPanel
              loading={chatHistoryLoading}
              rows={chatHistoryRows}
              onOpenSavedChat={onOpenSavedChat}
            />
          ) : (
            <SystemPromptPanel
              options={systemPromptOptions}
              selectedId={selectedSystemPromptId}
              onSelect={onSelectSystemPrompt}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  active = false,
  ariaPressed,
  className,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  ariaPressed?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("vault-ai-assistant-icon-action", className, active && "is-active")}
      aria-label={label}
      aria-pressed={ariaPressed}
      data-tooltip-label={label}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
      <span className="vault-ai-assistant-sr-only">{label}</span>
    </Button>
  );
}

function ChatHistoryPanel({
  loading,
  rows,
  onOpenSavedChat
}: {
  loading: boolean;
  rows: ComposerChatHistoryRow[];
  onOpenSavedChat: (filePath: string) => void;
}): React.ReactElement {
  return (
    <div className="vault-ai-assistant-chat-history">
      <div className="vault-ai-assistant-chat-history-title">Chat History</div>
      <div className="vault-ai-assistant-chat-history-list">
        {loading ? (
          <div className="vault-ai-assistant-message-meta">Loading saved chats...</div>
        ) : rows.length === 0 ? (
          <>
            <div className="vault-ai-assistant-chat-history-title">No saved chats</div>
            <div className="vault-ai-assistant-message-meta">
              Saved conversations will appear here after a response is autosaved.
            </div>
          </>
        ) : (
          rows.map((row) => (
            <button
              key={row.filePath}
              type="button"
              className="vault-ai-assistant-chat-history-row"
              title={`${row.title} · ${row.formattedDate}`}
              onClick={() => onOpenSavedChat(row.filePath)}
            >
              <span className="vault-ai-assistant-chat-history-title">{row.title}</span>
              <span className="vault-ai-assistant-chat-history-date">{row.formattedDate}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function SystemPromptPanel({
  options,
  selectedId,
  onSelect
}: {
  options: ComposerSystemPromptOption[];
  selectedId: SystemPromptPresetId;
  onSelect: (presetId: SystemPromptPresetId) => void;
}): React.ReactElement {
  return (
    <div className="vault-ai-assistant-chat-settings">
      <div className="vault-ai-assistant-chat-settings-title">System Prompt</div>
      <div className="vault-ai-assistant-chat-settings-row" role="menu" aria-label="System Prompt">
        {options.map((option) => {
          const selected = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                "vault-ai-assistant-system-prompt-option",
                selected && "vault-ai-assistant-system-prompt-option-selected"
              )}
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onSelect(option.id)}
            >
              <span className="vault-ai-assistant-system-prompt-option-check" aria-hidden="true">
                {selected ? <Check size={15} strokeWidth={1.8} /> : null}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
