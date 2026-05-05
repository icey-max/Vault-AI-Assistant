import type { ChatMessage } from "../chat-types";
import { stripTextOrchestratorOperationPayloads } from "../orchestrator-operations";

export function serializeAssistantMessageForProviderHistory(message: ChatMessage): string {
  const visibleContent = stripTextOrchestratorOperationPayloads(message.content).trim();
  const proposalContent = serializeProposalHistory(message);

  return [visibleContent, proposalContent].filter(Boolean).join("\n\n");
}

function serializeProposalHistory(message: ChatMessage): string {
  if (!message.proposals || message.proposals.length === 0) {
    return "";
  }

  const lines = [
    "Previously proposed vault operations:",
    "Only operations marked applied were written to the vault.",
    "Use these operation paths to resolve obvious follow-up references such as \"them\", \"those files\", or \"each one\"; ask a brief clarification if multiple referents are plausible."
  ];

  for (const proposal of message.proposals) {
    lines.push(`Proposal: ${proposal.summary}`);
    for (const operation of proposal.operations) {
      lines.push(`- ${operation.type}: ${formatOperationPath(operation)} (${operation.status})`);
    }
  }

  return lines.join("\n");
}

function formatOperationPath(
  operation: NonNullable<ChatMessage["proposals"]>[number]["operations"][number]
): string {
  if (
    operation.type === "move_note" ||
    operation.type === "move_folder" ||
    operation.type === "copy_note"
  ) {
    return `${operation.sourcePath} -> ${operation.destinationPath}`;
  }

  return operation.path;
}
