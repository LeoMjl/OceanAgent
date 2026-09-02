export type NodeRole = "user" | "assistant" | "system" | "tool";
export type NodeKind = "message" | "clarification" | "plan" | "status";
export type RunStatus = "queued" | "running" | "settled" | "failed" | "cancelled";
export type PlanStatus = "awaiting_approval" | "approved" | "rejected" | "executing" | "completed" | "failed";
export type ProjectExecutionTarget = "local" | "ssh";
export type ProjectConnectionStatus = "local" | "saved" | "connected" | "credentials_required";

export interface RemoteConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
}

export interface ModelReference {
  providerId: string;
  modelId: string;
}

export interface ConfiguredModel extends ModelReference {
  key: string;
  providerName: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  input: ("text" | "image")[];
}

export interface ModelProviderSummary {
  id: string;
  name: string;
  modelCount: number;
  configured: boolean;
  enabledModelIds: string[];
  configurationMode: "api_key" | "advanced";
  keyLabel: string;
  credentialSource?: "saved";
}

export interface ModelSettingsState {
  providers: ModelProviderSummary[];
  enabledModels: ConfiguredModel[];
  defaultModel: ModelReference | null;
}

export type ModelCatalogSource = "remote" | "pi_catalog";

export interface ModelDiscoveryResult {
  providerId: string;
  models: ConfiguredModel[];
  source: ModelCatalogSource;
  message: string;
  discoveredAt: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  executionTarget: ProjectExecutionTarget;
  workspacePath: string;
  remoteConnectionId?: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  connectionStatus?: ProjectConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResearchProjectInput {
  title: string;
  executionTarget: ProjectExecutionTarget;
  workspacePath: string;
  ssh?: {
    connectionId?: string;
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  activeNodeId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationNode {
  id: string;
  conversationId: string;
  parentId: string | null;
  role: NodeRole;
  kind: NodeKind;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  conversationId: string;
  userNodeId: string;
  assistantNodeId: string | null;
  status: RunStatus;
  model: string;
  error: string | null;
  startedAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface ToolTrace {
  id: string;
  runId: string;
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  tool?: string;
  inputs?: Record<string, unknown>;
  dependsOn: string[];
  expectedOutputs: string[];
  risks: string[];
}

export interface ResearchPlan {
  id: string;
  conversationId: string;
  nodeId?: string;
  version: number;
  status: PlanStatus;
  objective: string;
  assumptions: string[];
  requiredInputs: string[];
  datasets: string[];
  evidenceNeeds: string[];
  steps: PlanStep[];
  deliverables: string[];
  risks: string[];
  estimatedCost?: string;
  createdAt: string;
  approvedAt?: string;
}

export interface Citation {
  id: string;
  nodeId?: string;
  runId: string;
  sourceType: "ocean_rag" | "web";
  sourceId: string;
  title: string;
  locator?: string;
  url?: string;
  evidenceText?: string;
  metadata: Record<string, unknown>;
}

export interface StreamEvent<T = unknown> {
  id?: number;
  runId: string;
  type:
    | "run.started"
    | "run.progress"
    | "message.delta"
    | "tool.started"
    | "tool.progress"
    | "tool.completed"
    | "citation.added"
    | "clarification.requested"
    | "plan.proposed"
    | "plan.awaiting_approval"
    | "run.settled"
    | "run.error";
  data: T;
  createdAt: string;
}

export interface RagSearchResult {
  id: string;
  cardType: "dataset" | "problem_solution" | "usage_bundle";
  title: string;
  excerpt: string;
  sourceIds: string[];
  url?: string;
  locator?: string;
  score: number;
  payload: Record<string, unknown>;
}
