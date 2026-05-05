import * as React from "react";
import { BookOpen, FileLock, FileText, Folder, FolderKey, Image, ImageOff, ShieldCheck, X } from "lucide-react";
import { Button } from "./button";
import { cn } from "../lib/utils";
import type { ChatImageAttachment } from "../../chat-types";
import type { ContextAttachmentMode, ContextSource, OperationTargetSource } from "../../context-utils";

const CONTEXT_SUMMARY_THRESHOLD = 5;

interface ComposerAttachmentBarProps {
  scopeMode: ContextAttachmentMode;
  contextSources: ContextSource[];
  targetSources: OperationTargetSource[];
  imageAttachments: ChatImageAttachment[];
  getContextDisplayName: (source: ContextSource) => string;
  getContextBadgeLabel: (source: ContextSource) => string;
  onScopeModeChange: (mode: ContextAttachmentMode) => void;
  onAddContext: () => void;
  onAddScope: () => void;
  onRemoveContext: (source: ContextSource) => void;
  onRemoveAllContext: () => void;
  onRemoveScope: (target: OperationTargetSource) => void;
  onRemoveImage: (attachment: ChatImageAttachment) => void;
}

export function ComposerAttachmentBar({
  scopeMode,
  contextSources,
  targetSources,
  imageAttachments,
  getContextDisplayName,
  getContextBadgeLabel,
  onScopeModeChange,
  onAddContext,
  onAddScope,
  onRemoveContext,
  onRemoveAllContext,
  onRemoveScope,
  onRemoveImage
}: ComposerAttachmentBarProps): React.ReactElement {
  const requestMode = (mode: ContextAttachmentMode, requestPicker: () => void): void => {
    onScopeModeChange(mode);
    requestPicker();
  };
  const shouldSummarizeContext = contextSources.length > CONTEXT_SUMMARY_THRESHOLD;

  return (
    <div className="vault-ai-assistant-composer-context vault-ai-assistant-attachment-bar">
      <div className="vault-ai-assistant-scope-mode">
        <Button
          type="button"
          variant="ghost"
          className="vault-ai-assistant-context-trigger vault-ai-assistant-scope-mode-button vault-ai-assistant-scope-mode-context"
          aria-label="Add readable context"
          aria-pressed={scopeMode === "context"}
          onClick={() => requestMode("context", onAddContext)}
        >
          <span className="vault-ai-assistant-scope-mode-icon" aria-hidden="true">
            <BookOpen size={16} strokeWidth={1.8} />
          </span>
          <span>Context</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="vault-ai-assistant-context-trigger vault-ai-assistant-scope-mode-button vault-ai-assistant-scope-mode-scope"
          aria-label="Set edit target"
          aria-pressed={scopeMode === "target"}
          onClick={() => requestMode("target", onAddScope)}
        >
          <span className="vault-ai-assistant-scope-mode-icon" aria-hidden="true">
            <ShieldCheck size={16} strokeWidth={1.8} />
          </span>
          <span>Target</span>
        </Button>
      </div>

      <div className="vault-ai-assistant-context-chips">
        {shouldSummarizeContext ? (
          <ContextSummaryChip
            count={contextSources.length}
            onManage={onAddContext}
            onRemoveAll={onRemoveAllContext}
          />
        ) : (
          contextSources.map((source) => (
            <ContextChip
              key={source.id}
              source={source}
              displayName={getContextDisplayName(source)}
              badgeLabel={getContextBadgeLabel(source)}
              onRemove={onRemoveContext}
            />
          ))
        )}
        {targetSources.length === 0 ? (
          <DefaultScopeChip />
        ) : (
          targetSources.map((target) => (
            <ScopeChip key={target.id} target={target} onRemove={onRemoveScope} />
          ))
        )}
        {imageAttachments.map((attachment) => (
          <ImageChip
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemoveImage}
          />
        ))}
      </div>
    </div>
  );
}

function ContextSummaryChip({
  count,
  onManage,
  onRemoveAll
}: {
  count: number;
  onManage: () => void;
  onRemoveAll: () => void;
}): React.ReactElement {
  return (
    <div
      className="vault-ai-assistant-context-chip vault-ai-assistant-context-read-chip vault-ai-assistant-context-summary-chip"
      title={`${count} context items attached`}
    >
      <span className="vault-ai-assistant-context-chip-summary vault-ai-assistant-context-summary-body">
        <span className="vault-ai-assistant-context-chip-icon-shell">
          <span className="vault-ai-assistant-context-chip-icon" aria-hidden="true">
            <BookOpen size={16} strokeWidth={1.8} />
          </span>
        </span>
        <span className="vault-ai-assistant-context-summary-copy">
          <span className="vault-ai-assistant-context-path">
            {count} context {count === 1 ? "item" : "items"}
          </span>
          <span className="vault-ai-assistant-context-meta">
            Manage individual items in the context popup
          </span>
        </span>
        <span className="vault-ai-assistant-context-summary-actions">
          <button
            type="button"
            className="vault-ai-assistant-context-summary-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onManage();
            }}
          >
            Manage
          </button>
          <button
            type="button"
            className="vault-ai-assistant-context-summary-action vault-ai-assistant-context-summary-action-danger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveAll();
            }}
          >
            Remove all
          </button>
        </span>
      </span>
    </div>
  );
}

function ContextChip({
  source,
  displayName,
  badgeLabel,
  onRemove
}: {
  source: ContextSource;
  displayName: string;
  badgeLabel: string;
  onRemove: (source: ContextSource) => void;
}): React.ReactElement {
  const estimatedTokens = source.files.reduce((total, file) => total + file.estimatedTokens, 0);
  const title = `${source.path} · ${source.files.length} ${source.files.length === 1 ? "file" : "files"} · ${estimatedTokens} est. tokens`;

  return (
    <div className="vault-ai-assistant-context-chip vault-ai-assistant-context-read-chip" title={title}>
      <span className="vault-ai-assistant-context-chip-summary">
        <span className="vault-ai-assistant-context-chip-icon-shell">
          <span className="vault-ai-assistant-context-chip-icon" aria-hidden="true">
            {source.type === "folder" ? <Folder size={16} strokeWidth={1.8} /> : <FileText size={16} strokeWidth={1.8} />}
          </span>
          <button
            type="button"
            className="vault-ai-assistant-context-chip-remove"
            aria-label={`Remove ${source.path} from context`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(source);
            }}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </span>
        <span className="vault-ai-assistant-context-path">{displayName}</span>
        <span className="vault-ai-assistant-context-meta">Context · sends content · {badgeLabel}</span>
      </span>
    </div>
  );
}

function DefaultScopeChip(): React.ReactElement {
  return (
    <div className="vault-ai-assistant-context-chip vault-ai-assistant-scope-chip vault-ai-assistant-default-scope-chip">
      <span className="vault-ai-assistant-context-chip-summary">
        <span className="vault-ai-assistant-context-chip-icon-shell">
          <span className="vault-ai-assistant-context-chip-icon" aria-hidden="true">
            <ShieldCheck size={16} strokeWidth={1.8} />
          </span>
        </span>
        <span className="vault-ai-assistant-context-path">Target /</span>
        <span className="vault-ai-assistant-context-meta">Edit target hint</span>
      </span>
    </div>
  );
}

function ScopeChip({
  target,
  onRemove
}: {
  target: OperationTargetSource;
  onRemove: (target: OperationTargetSource) => void;
}): React.ReactElement {
  return (
    <div
      className="vault-ai-assistant-context-chip vault-ai-assistant-scope-chip"
      title={`${target.path} · Edit target hint`}
    >
      <span className="vault-ai-assistant-context-chip-summary">
        <span className="vault-ai-assistant-context-chip-icon-shell">
          <span className="vault-ai-assistant-context-chip-icon" aria-hidden="true">
            {target.type === "folder" ? <FolderKey size={16} strokeWidth={1.8} /> : <FileLock size={16} strokeWidth={1.8} />}
          </span>
          <button
            type="button"
            className="vault-ai-assistant-context-chip-remove"
            aria-label={`Remove ${target.path} from edit targets`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(target);
            }}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </span>
        <span className="vault-ai-assistant-context-path">
          {target.path === "/" ? "Target /" : target.path}
        </span>
        <span className="vault-ai-assistant-context-meta">Target · path hint only</span>
      </span>
    </div>
  );
}

function ImageChip({
  attachment,
  onRemove
}: {
  attachment: ChatImageAttachment;
  onRemove: (attachment: ChatImageAttachment) => void;
}): React.ReactElement {
  const isMissing = attachment.status === "missing";

  return (
    <div
      className={cn(
        "vault-ai-assistant-context-chip vault-ai-assistant-image-chip",
        isMissing && "vault-ai-assistant-missing-image-chip"
      )}
      aria-disabled={isMissing || undefined}
    >
      <span className="vault-ai-assistant-context-chip-summary">
        <span className="vault-ai-assistant-context-chip-icon-shell">
          <span className="vault-ai-assistant-context-chip-icon" aria-hidden="true">
            {isMissing ? <ImageOff size={16} strokeWidth={1.8} /> : <Image size={16} strokeWidth={1.8} />}
          </span>
          {!isMissing ? (
            <button
              type="button"
              className="vault-ai-assistant-context-chip-remove"
              aria-label={`Remove ${attachment.label} from attachments`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove(attachment);
              }}
            >
              <X size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </span>
        <span className="vault-ai-assistant-context-path">
          {isMissing ? `${attachment.label} · Missing image` : attachment.label}
        </span>
      </span>
    </div>
  );
}
