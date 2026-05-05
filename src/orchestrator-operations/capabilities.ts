export type OperationSupportStatus = "supported" | "planned" | "unsupported";
export type OperationPreviewMode = "content" | "diff" | "path_change" | "destructive" | "batch_summary";
export type OperationExecutorOwner = "vault" | "file_manager" | "adapter" | "composed" | "none";

export interface OrchestratorOperationCapability {
  type: string;
  status: OperationSupportStatus;
  requiresReadableSource: boolean;
  requiresOperationScope: boolean;
  destructive: boolean;
  pathChanging: boolean;
  previewMode: OperationPreviewMode;
  executorOwner: OperationExecutorOwner;
  failureClasses: readonly string[];
}

export const ORCHESTRATOR_OPERATION_CAPABILITIES = [
  {
    type: "create_note",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: false,
    previewMode: "content",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "existing_destination", "approval_required"]
  },
  {
    type: "create_folder",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: false,
    previewMode: "content",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "existing_destination", "approval_required"]
  },
  {
    type: "modify_note",
    status: "supported",
    requiresReadableSource: true,
    requiresOperationScope: false,
    destructive: false,
    pathChanging: false,
    previewMode: "diff",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "missing_source", "stale_baseline", "approval_required"]
  },
  {
    type: "append_note",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: false,
    previewMode: "content",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "missing_source", "stale_baseline", "approval_required"]
  },
  {
    type: "delete_note",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: true,
    pathChanging: false,
    previewMode: "destructive",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "missing_source", "stale_baseline", "approval_required"]
  },
  {
    type: "move_note",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: true,
    previewMode: "path_change",
    executorOwner: "file_manager",
    failureClasses: ["unsafe_path", "missing_source", "existing_destination", "stale_baseline", "approval_required"]
  },
  {
    type: "move_folder",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: true,
    previewMode: "path_change",
    executorOwner: "file_manager",
    failureClasses: ["unsafe_path", "missing_source", "existing_destination", "approval_required"]
  },
  {
    type: "copy_note",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: true,
    previewMode: "path_change",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "missing_source", "existing_destination", "stale_baseline", "approval_required"]
  },
  {
    type: "delete_folder",
    status: "supported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: true,
    pathChanging: false,
    previewMode: "destructive",
    executorOwner: "vault",
    failureClasses: ["unsafe_path", "missing_source", "approval_required"]
  },
  {
    type: "copy_folder",
    status: "planned",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: true,
    previewMode: "batch_summary",
    executorOwner: "composed",
    failureClasses: ["descendant_limit", "preview_limit", "existing_destination", "approval_required"]
  },
  {
    type: "binary_attachment_write",
    status: "unsupported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: false,
    previewMode: "content",
    executorOwner: "none",
    failureClasses: ["unsupported_operation"]
  },
  {
    type: "whole_vault_operation",
    status: "unsupported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: true,
    pathChanging: false,
    previewMode: "batch_summary",
    executorOwner: "none",
    failureClasses: ["unsupported_operation"]
  },
  {
    type: "plugin_folder_write",
    status: "unsupported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: false,
    pathChanging: false,
    previewMode: "content",
    executorOwner: "none",
    failureClasses: ["unsupported_operation"]
  },
  {
    type: "arbitrary_filesystem_operation",
    status: "unsupported",
    requiresReadableSource: false,
    requiresOperationScope: true,
    destructive: true,
    pathChanging: true,
    previewMode: "batch_summary",
    executorOwner: "none",
    failureClasses: ["unsupported_operation"]
  },
  {
    type: "shell_command",
    status: "unsupported",
    requiresReadableSource: false,
    requiresOperationScope: false,
    destructive: true,
    pathChanging: false,
    previewMode: "batch_summary",
    executorOwner: "none",
    failureClasses: ["unsupported_operation"]
  }
] as const satisfies readonly OrchestratorOperationCapability[];
