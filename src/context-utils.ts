export type ContextSourceType = "current-note" | "note" | "folder";
export type ContextAttachmentMode = "context" | "target";
export type OperationTargetType = "file" | "folder";

export interface ResolvedContextFile {
  path: string;
  basename: string;
  extension: string;
  sourceIds: string[];
  charCount: number;
  estimatedTokens: number;
}

export interface ContextSource {
  id: string;
  type: ContextSourceType;
  path: string;
  label: string;
  expanded: boolean;
  files: ResolvedContextFile[];
  automatic?: boolean;
}

export interface ContextSummary {
  fileCount: number;
  totalCharacters: number;
  totalEstimatedTokens: number;
}

export interface ContextPackageFile {
  path: string;
  content: string;
  charCount: number;
  estimatedTokens: number;
  sourceIds: string[];
}

export interface ContextPackage {
  files: ContextPackageFile[];
  totalCharacters: number;
  totalEstimatedTokens: number;
  sourceIds: string[];
}

export interface OperationTargetSource {
  id: string;
  type: OperationTargetType;
  path: string;
  label: string;
  explicit: boolean;
  automatic?: boolean;
}

export interface OperationTargetScope {
  defaultPath: "/";
  sources: OperationTargetSource[];
}

export interface OperationTargetSnapshot {
  defaultPath: "/";
  targets: OperationTargetSource[];
  targetCount: number;
}

export const APPROX_CHARS_PER_TOKEN = 4;
export const CONTEXT_LIMITS = {
  maxFiles: 50,
  maxTotalEstimatedTokens: 200000,
  maxSingleFileEstimatedTokens: 50000
} as const;

export type ContextWarningType = "file-count" | "total-size" | "single-file-size";

export interface ContextWarning {
  type: ContextWarningType;
  message: string;
  limit: number;
  actual: number;
  path?: string;
}

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / APPROX_CHARS_PER_TOKEN);
}

export function formatEstimatedTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k est. tokens`;
  }

  return `${tokens} est. tokens`;
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

export function sortByPath<T extends { path: string }>(items: T[]): T[] {
  return items.slice().sort((first, second) => first.path.localeCompare(second.path));
}

export function normalizeTargetPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed || "/";
}

export function isAssistantOwnedPath(path: string): boolean {
  const normalizedPath = normalizeTargetPath(path);

  return (
    normalizedPath === "vault-ai-assistant" ||
    normalizedPath.startsWith("vault-ai-assistant/") ||
    normalizedPath === ".vault-ai-assistant" ||
    normalizedPath.startsWith(".vault-ai-assistant/")
  );
}

export function createDefaultOperationTargetScope(): OperationTargetScope {
  return {
    defaultPath: "/",
    sources: []
  };
}

export function createOperationTargetSnapshot(
  scope: OperationTargetScope
): OperationTargetSnapshot {
  const targets =
    scope.sources.length > 0
      ? scope.sources.map(cloneOperationTargetSource)
      : [
          {
            id: "target:folder:/",
            type: "folder" as const,
            path: scope.defaultPath,
            label: scope.defaultPath,
            explicit: false
          }
        ];

  return {
    defaultPath: scope.defaultPath,
    targets: sortByPath(targets),
    targetCount: targets.length
  };
}

export function isPathWithinTarget(path: string, target: OperationTargetSource): boolean {
  const normalizedPath = normalizeTargetPath(path);
  const normalizedTargetPath = normalizeTargetPath(target.path);

  if (isAssistantOwnedPath(normalizedPath) || isAssistantOwnedPath(normalizedTargetPath)) {
    return false;
  }

  if (target.type === "file") {
    return normalizedPath === normalizedTargetPath;
  }

  if (normalizedTargetPath === "/") {
    return normalizedPath !== "/";
  }

  return (
    normalizedPath === normalizedTargetPath ||
    normalizedPath.startsWith(`${normalizedTargetPath}/`)
  );
}

export function dedupeContextFiles(files: ResolvedContextFile[]): ResolvedContextFile[] {
  const byPath: Record<string, ResolvedContextFile> = {};

  for (const file of files) {
    const existing = byPath[file.path];
    if (!existing) {
      byPath[file.path] = {
        ...file,
        sourceIds: uniqueSorted(file.sourceIds)
      };
      continue;
    }

    byPath[file.path] = {
      ...existing,
      sourceIds: uniqueSorted(existing.sourceIds.concat(file.sourceIds))
    };
  }

  const dedupedFiles = Object.keys(byPath).reduce<ResolvedContextFile[]>((result, path) => {
    const file = byPath[path];
    if (file) {
      result.push(file);
    }

    return result;
  }, []);

  return sortByPath(dedupedFiles);
}

export function summarizeContext(files: ResolvedContextFile[]): ContextSummary {
  const dedupedFiles = dedupeContextFiles(files);

  return {
    fileCount: dedupedFiles.length,
    totalCharacters: dedupedFiles.reduce((total, file) => total + file.charCount, 0),
    totalEstimatedTokens: dedupedFiles.reduce(
      (total, file) => total + file.estimatedTokens,
      0
    )
  };
}

export function evaluateContextWarnings(files: ResolvedContextFile[]): ContextWarning[] {
  const warnings: ContextWarning[] = [];
  const dedupedFiles = dedupeContextFiles(files);
  const summary = summarizeContext(dedupedFiles);

  if (summary.fileCount > CONTEXT_LIMITS.maxFiles) {
    warnings.push({
      type: "file-count",
      message: "Context includes more than 50 files. Remove items before sending.",
      limit: CONTEXT_LIMITS.maxFiles,
      actual: summary.fileCount
    });
  }

  if (summary.totalEstimatedTokens > CONTEXT_LIMITS.maxTotalEstimatedTokens) {
    warnings.push({
      type: "total-size",
      message: "Context is over the 200k token warning limit. Remove items before sending.",
      limit: CONTEXT_LIMITS.maxTotalEstimatedTokens,
      actual: summary.totalEstimatedTokens
    });
  }

  for (const file of dedupedFiles) {
    if (file.estimatedTokens > CONTEXT_LIMITS.maxSingleFileEstimatedTokens) {
      warnings.push({
        type: "single-file-size",
        message: "This file is over the 50k token warning limit.",
        limit: CONTEXT_LIMITS.maxSingleFileEstimatedTokens,
        actual: file.estimatedTokens,
        path: file.path
      });
    }
  }

  return warnings;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function cloneOperationTargetSource(source: OperationTargetSource): OperationTargetSource {
  return { ...source };
}
