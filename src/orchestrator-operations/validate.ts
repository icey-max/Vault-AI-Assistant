import type { ContextPackageFile, OperationTargetScope } from "../context-utils";
import {
  validateVaultOperationProposal,
  type VaultOperationValidationResult
} from "../vault-operations";

export interface OrchestratorOperationValidationOptions {
  now?: string;
  idPrefix?: string;
  allowedExistingTargetPaths?: string[];
  readableContextPaths?: string[];
  contextFiles?: ContextPackageFile[];
  operationTargets?: OperationTargetScope;
}

export function validateOrchestratorOperationProposal(
  input: unknown,
  options: OrchestratorOperationValidationOptions = {}
): VaultOperationValidationResult {
  return validateVaultOperationProposal(input, {
    now: options.now,
    idPrefix: options.idPrefix
  });
}
