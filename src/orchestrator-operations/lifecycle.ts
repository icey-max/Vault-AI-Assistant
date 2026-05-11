export type OrchestratorOperationOutcomeType =
  | "answer_only"
  | "proposal"
  | "clarify"
  | "unsupported"
  | "invalid_repairable"
  | "error";

export interface OrchestratorOperationOutcomeInput {
  requestedOperation: boolean;
  hasProposal: boolean;
  needsClarification: boolean;
  unsupportedOperation: boolean;
  invalidRepairable: boolean;
  safeError: boolean;
}

export function classifyOperationOutcome(
  input: OrchestratorOperationOutcomeInput
): OrchestratorOperationOutcomeType {
  if (input.hasProposal) {
    return "proposal";
  }
  if (input.needsClarification) {
    return "clarify";
  }
  if (input.unsupportedOperation) {
    return "unsupported";
  }
  if (input.invalidRepairable) {
    return "invalid_repairable";
  }
  if (input.safeError) {
    return "error";
  }

  return "answer_only";
}

export function shouldEnableVaultOperations(
  message: string,
  contextFileCount = 0,
  targetCount = 0
): boolean {
  return hasDirectVaultOperationIntent(message, contextFileCount, targetCount);
}

export interface OrchestratorOperationIntentHistoryMessage {
  role?: "user" | "assistant";
  content?: string;
  status?: string;
  error?: string;
  proposals?: Array<{ operations?: unknown[] }>;
}

export interface OrchestratorOperationIntentRequest {
  message: string;
  previousMessages?: OrchestratorOperationIntentHistoryMessage[];
  contextFileCount?: number;
  targetCount?: number;
}

export function shouldEnableVaultOperationsForRequest(
  request: OrchestratorOperationIntentRequest
): boolean {
  const contextFileCount = request.contextFileCount ?? 0;
  const targetCount = request.targetCount ?? 0;
  if (hasDirectVaultOperationIntent(request.message, contextFileCount, targetCount)) {
    return true;
  }

  if (contextFileCount === 0 && targetCount === 0) {
    return false;
  }

  if (!isOperationRetryOrConfirmation(request.message)) {
    return false;
  }

  return hasRecentVaultOperationIntent(
    request.previousMessages ?? [],
    contextFileCount,
    targetCount
  );
}

function hasDirectVaultOperationIntent(
  message: string,
  contextFileCount: number,
  targetCount: number
): boolean {
  const normalized = message.toLowerCase();
  const mentionsVaultTarget =
    /\b(note|file|folder|directory|vault|markdown|md|document|chapter|chapters|template|homepage|index|strategy|strategies)\b/.test(
      normalized
    );
  const explicitVaultChangeIntent = hasVaultChangeVerb(normalized) && mentionsVaultTarget;
  const setupStructureIntent = hasSetupStructureIntent(
    normalized,
    contextFileCount,
    targetCount
  );
  // Orchestrator Operations can be enabled by context-file edit intent over an attached note.
  const contextFileEditIntent =
    contextFileCount > 0 &&
    hasVaultChangeVerb(normalized);
  const targetEditIntent =
    targetCount > 0 &&
    hasVaultChangeVerb(normalized);

  return explicitVaultChangeIntent || setupStructureIntent || contextFileEditIntent || targetEditIntent;
}

function hasVaultChangeVerb(normalizedMessage: string): boolean {
  return (
    /\b(add|append|apply|build|change|clean|cleanup|copy|create|delete|duplicate|edit|format|generate|make|modify|move|organize|populate|proofread|remove|rename|rewrite|save|summarize|trash|update|write)\b/.test(
      normalizedMessage
    ) ||
    (/\bcorrect\s+grammar\b/.test(normalizedMessage) ||
      /\bcorrect\b.*\bgrammatical mistakes\b/.test(normalizedMessage)) ||
    /\bset\s+(?:it|this|that|them)?\s*up\b/.test(normalizedMessage)
  );
}

function hasSetupStructureIntent(
  normalizedMessage: string,
  contextFileCount: number,
  targetCount: number
): boolean {
  if (contextFileCount === 0 && targetCount === 0) {
    return false;
  }

  const setupVerb =
    /\b(build|create|design|generate|give|make|prepare|provide|scaffold|write)\b/.test(
      normalizedMessage
    ) || /\bset\s+(?:it|this|that|them)?\s*up\b/.test(normalizedMessage);
  const structureNoun =
    /\b(reading system|system|structure|dashboard|homepage|home page|reading log|chapter notes|key ideas|quotes|action items|review)\b/.test(
      normalizedMessage
    );

  return setupVerb && structureNoun;
}

function isOperationRetryOrConfirmation(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return (
    /^(yes|yep|yeah|correct|exactly|perfect|sure|ok|okay)\b/.test(normalized) ||
    /\b(another go|another try|give it another try|go ahead|have another go|please do|do it|try again|try now|retry|like this|works now|work now|set it up|set this up)\b/.test(
      normalized
    )
  );
}

function hasRecentVaultOperationIntent(
  previousMessages: OrchestratorOperationIntentHistoryMessage[],
  contextFileCount: number,
  targetCount: number
): boolean {
  const recentMessages = previousMessages.slice(-8);
  return recentMessages.some((message) => {
    if (message.role === "user") {
      return hasDirectVaultOperationIntent(message.content ?? "", contextFileCount, targetCount);
    }

    return hasAssistantOperationAttempt(message);
  });
}

function hasAssistantOperationAttempt(message: OrchestratorOperationIntentHistoryMessage): boolean {
  if (message.proposals?.some((proposal) => (proposal.operations?.length ?? 0) > 0)) {
    return true;
  }

  const text = `${message.content ?? ""}\n${message.error ?? ""}`.toLowerCase();
  return (
    text.includes("orchestrator operation proposal") ||
    text.includes("vault operation proposal") ||
    text.includes("proposed changes") ||
    text.includes("proposed structure") ||
    text.includes("propose edits") ||
    text.includes("propose the actual file contents") ||
    text.includes("propose_vault_operations")
  );
}
