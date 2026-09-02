import type { Citation, ResearchPlan } from "../contracts.js";

export type CitationDraft = Omit<Citation, "id" | "runId" | "nodeId">;

export interface ClarificationQuestion {
  id: string;
  label: string;
  question: string;
  required: boolean;
  reason?: string;
  options: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
  allowCustom: boolean;
}

export type TerminalAction =
  | { type: "clarification"; questions: ClarificationQuestion[]; summary: string }
  | { type: "plan"; plan: ResearchPlan };

export interface OceanToolContext {
  addCitation(citation: CitationDraft): void;
  setTerminalAction(action: TerminalAction): void;
  createPlan(input: Omit<ResearchPlan, "id" | "conversationId" | "version" | "status" | "createdAt">): ResearchPlan;
}
