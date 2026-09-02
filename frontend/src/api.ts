import type {
  AgentRun,
  Citation,
  Conversation,
  ConversationNode,
  CreateResearchProjectInput,
  ProjectExecutionTarget,
  ConfiguredModel,
  ModelDiscoveryResult,
  ModelReference,
  ModelSettingsState,
  ResearchProject,
  RemoteConnectionProfile,
  ResearchPlan,
  StreamEvent,
  ToolTrace,
} from "../../src/contracts";

export type { AgentRun, Citation, Conversation, ConversationNode, ResearchPlan, ResearchProject, RemoteConnectionProfile, StreamEvent, ToolTrace };
export type { CreateResearchProjectInput, ProjectExecutionTarget };
export type { ConfiguredModel, ModelDiscoveryResult, ModelReference, ModelSettingsState };

export interface ConversationDetail {
  conversation: Conversation;
  nodes: ConversationNode[];
  plans: ResearchPlan[];
  citations: Record<string, Citation[]>;
  traces: Record<string, ToolTrace[]>;
}

export interface HealthStatus {
  ok: boolean;
  name: string;
  model: ModelReference | null;
  rag: {
    documents: number;
    version: string | null;
    indexedAt: string | null;
    embeddingModel: string | null;
    embeddingDimensions: number | null;
    credentialConfigured: boolean;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败：HTTP ${response.status}`);
  return payload;
}

export const api = {
  health: () => request<HealthStatus>("/api/health"),
  getModelSettings: () => request<ModelSettingsState>("/api/model-settings"),
  discoverProviderModels: (providerId: string, apiKey?: string) => request<ModelDiscoveryResult>(
    `/api/model-settings/providers/${encodeURIComponent(providerId)}/discover`,
    { method: "POST", body: JSON.stringify({ apiKey }) },
  ),
  saveProviderModels: (providerId: string, apiKey: string | undefined, modelIds: string[]) => request<ModelSettingsState>(
    `/api/model-settings/providers/${encodeURIComponent(providerId)}`,
    { method: "PUT", body: JSON.stringify({ apiKey, modelIds }) },
  ),
  setDefaultModel: (model: ModelReference) => request<ModelSettingsState>("/api/model-settings/default", {
    method: "PATCH", body: JSON.stringify({ model }),
  }),
  listProjects: () => request<ResearchProject[]>("/api/projects"),
  listRemoteConnections: () => request<RemoteConnectionProfile[]>("/api/remote-connections"),
  selectLocalDirectory: () => request<{ path: string | null }>("/api/system/select-directory", {
    method: "POST",
  }),
  createProject: (input: CreateResearchProjectInput) => request<ResearchProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  renameProject: (id: string, title: string) => request<ResearchProject>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }),
  connectProject: (id: string, password: string) => request<ResearchProject>(`/api/projects/${id}/connect`, {
    method: "POST",
    body: JSON.stringify({ password }),
  }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  listConversations: () => request<Conversation[]>("/api/conversations"),
  createConversation: (projectId: string, title?: string) => request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ projectId, title }),
  }),
  startConversation: (projectId: string, content: string, model: ModelReference) => request<{
    conversation: Conversation;
    run: AgentRun;
    userNode: ConversationNode;
    eventsUrl: string;
  }>(`/api/projects/${projectId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, model }),
  }),
  renameConversation: (id: string, title: string) => request<Conversation>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }),
  deleteConversation: (id: string) => request<void>(`/api/conversations/${id}`, { method: "DELETE" }),
  getConversation: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
  setActiveNode: (conversationId: string, nodeId: string | null) => request<{ ok: boolean }>(
    `/api/conversations/${conversationId}/active-node`,
    { method: "POST", body: JSON.stringify({ nodeId }) },
  ),
  sendMessage: (conversationId: string, content: string, parentId: string | null, model: ModelReference) => request<{
    run: AgentRun;
    userNode: ConversationNode;
    plan?: ResearchPlan;
    executionQueued?: boolean;
    eventsUrl: string;
  }>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, parentId, model }),
  }),
  submitClarification: (
    conversationId: string,
    clarificationForNodeId: string,
    content: string,
    model: ModelReference,
  ) => request<{
    run: AgentRun;
    userNode: ConversationNode;
    plan?: ResearchPlan;
    executionQueued?: boolean;
    eventsUrl: string;
  }>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, parentId: clarificationForNodeId, clarificationForNodeId, model }),
  }),
  abortRun: (runId: string) => request<{ stopped: boolean }>(`/api/runs/${runId}/abort`, { method: "POST" }),
  approvePlan: (planId: string) => request<{
    plan: ResearchPlan;
    run: AgentRun;
    userNode: ConversationNode;
    eventsUrl: string;
    executionQueued: true;
    message: string;
  }>(
    `/api/plans/${planId}/approve`, { method: "POST" },
  ),
  rejectPlan: (planId: string) => request<{ plan: ResearchPlan }>(
    `/api/plans/${planId}/reject`, { method: "POST" },
  ),
};

const EVENT_TYPES: StreamEvent["type"][] = [
  "run.started",
  "run.progress",
  "message.delta",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "citation.added",
  "clarification.requested",
  "plan.proposed",
  "plan.awaiting_approval",
  "run.settled",
  "run.error",
];

export function streamRun(
  url: string,
  onEvent: (event: StreamEvent) => void,
  onConnectionError: () => void,
): () => void {
  const source = new EventSource(url);
  let terminal = false;
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (raw) => {
      const message = raw as MessageEvent<string>;
      const event: StreamEvent = {
        id: Number(message.lastEventId) || undefined,
        runId: url.split("/").at(-2) ?? "",
        type,
        data: JSON.parse(message.data) as unknown,
        createdAt: new Date().toISOString(),
      };
      onEvent(event);
      if (type === "run.settled" || type === "run.error") {
        terminal = true;
        source.close();
      }
    });
  }
  source.onerror = () => {
    if (!terminal) onConnectionError();
  };
  return () => source.close();
}
