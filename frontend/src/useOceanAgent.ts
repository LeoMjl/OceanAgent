import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  streamRun,
  type Citation,
  type Conversation,
  type ConversationDetail,
  type CreateResearchProjectInput,
  type ResearchPlan,
  type ResearchProject,
  type RemoteConnectionProfile,
  type ModelReference,
  type ModelSettingsState,
  type HealthStatus,
  type StreamEvent,
} from "./api";

export interface ResearchActivity {
  id: string;
  toolName?: string;
  label: string;
  detail?: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
}

const TOOL_LABELS: Record<string, string> = {
  read: "读取科研文件",
  bash: "运行科研计算命令",
  run_remote_command: "运行远程科研命令",
  edit: "编辑科研文件",
  write: "创建科研文件",
  search_ocean_knowledge: "检索 Ocean-RAG 知识库（旧版）",
  search_research_cases: "按研究领域检索相似研究",
  expand_research_case: "展开相关研究的实验结构",
  search_ocean_datasets: "检索可复用官方数据产品",
  get_dataset_facts: "读取官方数据产品事实",
  search_official_web: "检索官方网络资料",
  report_research_reasoning: "模型推理摘要",
  request_clarification: "确认研究需求",
  propose_research_plan: "生成可执行科研规划",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `调用 ${name}`;
}

function eventData<T>(event: StreamEvent): T {
  return event.data as T;
}

export function useOceanAgent() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnectionProfile[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettingsState | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelReference | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [liveCitations, setLiveCitations] = useState<Citation[]>([]);
  const [livePlan, setLivePlan] = useState<ResearchPlan | null>(null);
  const [activities, setActivities] = useState<ResearchActivity[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState("就绪");
  const [ragDocumentCount, setRagDocumentCount] = useState<number | null>(null);
  const [ragStatus, setRagStatus] = useState<HealthStatus["rag"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const closeStream = useRef<(() => void) | null>(null);
  const streamConversationId = useRef<string | null>(null);

  const refreshWorkspace = useCallback(async () => {
    const [projectList, connectionList, conversationList, health, models] = await Promise.all([
      api.listProjects(),
      api.listRemoteConnections(),
      api.listConversations(),
      api.health(),
      api.getModelSettings(),
    ]);
    setRagDocumentCount(health.rag.documents);
    setRagStatus(health.rag);
    setProjects(projectList);
    setRemoteConnections(connectionList);
    setModelSettings(models);
    setSelectedModel((current) => {
      const key = current ? `${current.providerId}::${current.modelId}` : "";
      return models.enabledModels.some((model) => model.key === key) ? current : models.defaultModel;
    });
    const visibleConversations = conversationList.filter((conversation) => !(
      conversation.title === "新的海洋科研会话" && !conversation.activeNodeId
    ));
    setConversations(visibleConversations);
    return { projects: projectList, conversations: visibleConversations };
  }, []);

  const refreshDetail = useCallback(async (id = selectedId) => {
    if (!id) return;
    setDetail(await api.getConversation(id));
  }, [selectedId]);

  const selectConversation = useCallback((id: string) => {
    closeStream.current?.();
    setSelectedId(id);
    setDraftProjectId(null);
    setStreamingText("");
    setLiveCitations([]);
    setLivePlan(null);
    setActivities([]);
    setRunId(null);
    setRunStatus("就绪");
  }, []);

  const createProject = useCallback(async (input: CreateResearchProjectInput) => {
    const project = await api.createProject(input);
    await refreshWorkspace();
    return project;
  }, [refreshWorkspace]);

  const selectLocalDirectory = useCallback(async () => {
    const result = await api.selectLocalDirectory();
    return result.path;
  }, []);

  const discoverProviderModels = useCallback((providerId: string, apiKey?: string) => (
    api.discoverProviderModels(providerId, apiKey)
  ), []);

  const saveProviderModels = useCallback(async (providerId: string, apiKey: string | undefined, modelIds: string[]) => {
    const settings = await api.saveProviderModels(providerId, apiKey, modelIds);
    setModelSettings(settings);
    setSelectedModel((current) => {
      const key = current ? `${current.providerId}::${current.modelId}` : "";
      return settings.enabledModels.some((model) => model.key === key) ? current : settings.defaultModel;
    });
    return settings;
  }, []);

  const chooseModel = useCallback(async (model: ModelReference) => {
    setSelectedModel(model);
    try {
      const settings = await api.setDefaultModel(model);
      setModelSettings(settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSelectedModel(modelSettings?.defaultModel ?? null);
    }
  }, [modelSettings?.defaultModel]);

  const startDraftConversation = useCallback((projectId: string) => {
    closeStream.current?.();
    setDraftProjectId(projectId);
    setSelectedId(null);
    setDetail(null);
    setStreamingText("");
    setLiveCitations([]);
    setLivePlan(null);
    setActivities([]);
    setRunId(null);
    setRunStatus("就绪");
    setError(null);
  }, []);

  const renameProject = useCallback(async (id: string, title: string) => {
    await api.renameProject(id, title);
    await refreshWorkspace();
  }, [refreshWorkspace]);

  const connectProject = useCallback(async (id: string, password: string) => {
    const project = await api.connectProject(id, password);
    setProjects((items) => items.map((item) => item.id === id ? project : item));
    return project;
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    setError(null);
    const removesCurrentView = draftProjectId === id || conversations.some(
      (conversation) => conversation.id === selectedId && conversation.projectId === id,
    );
    try {
      await api.deleteProject(id);
      const workspace = await refreshWorkspace();
      if (!removesCurrentView) return;
      const next = workspace.conversations[0];
      if (next) selectConversation(next.id);
      else {
        setSelectedId(null);
        setDetail(null);
        setDraftProjectId(workspace.projects[0]?.id ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [conversations, draftProjectId, refreshWorkspace, selectConversation, selectedId]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const conversation = await api.renameConversation(id, title);
    setConversations((items) => items.map((item) => item.id === id ? conversation : item));
    setDetail((current) => current?.conversation.id === id
      ? { ...current, conversation }
      : current);
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setError(null);
    try {
      await api.deleteConversation(id);
      const workspace = await refreshWorkspace();
      if (selectedId !== id) return;
      const next = workspace.conversations[0];
      if (next) selectConversation(next.id);
      else {
        setSelectedId(null);
        setDetail(null);
        setDraftProjectId(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [refreshWorkspace, selectConversation, selectedId]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const workspace = await refreshWorkspace();
        if (workspace.conversations[0]) selectConversation(workspace.conversations[0].id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [refreshWorkspace, selectConversation]);

  useEffect(() => {
    if (!selectedId) return;
    void refreshDetail(selectedId).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [selectedId, refreshDetail]);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "run.started") {
      setActivities([{
        id: `run-${event.runId}`,
        label: "分析研究问题并选择知识来源",
        status: "completed",
        createdAt: event.createdAt,
      }]);
    } else if (event.type === "run.progress") {
      const progress = eventData<{ label: string; detail?: string }>(event);
      setRunStatus(progress.label);
      setActivities((items) => [
        ...items.filter((item) => item.id !== `agent-${event.runId}`),
        {
          id: `agent-${event.runId}`,
          label: progress.label,
          detail: progress.detail,
          status: "running",
          createdAt: event.createdAt,
        },
      ]);
    } else if (event.type === "message.delta") {
      setStreamingText((value) => value + eventData<{ delta: string }>(event).delta);
    } else if (event.type === "tool.started") {
      const tool = eventData<{ id: string; name: string; detail?: string }>(event);
      const label = toolLabel(tool.name);
      setRunStatus(label);
      setActivities((items) => [
        ...items.filter((item) => (
          item.id !== `agent-${event.runId}`
          && item.id !== tool.id
          && !(item.toolName === tool.name && item.status === "failed")
        )),
        {
          id: tool.id,
          toolName: tool.name,
          label,
          detail: tool.detail,
          status: "running",
          createdAt: event.createdAt,
        },
      ]);
    } else if (event.type === "tool.progress") {
      const tool = eventData<{ id: string; name: string }>(event);
      setActivities((items) => items.map((item) => item.id === tool.id
        ? { ...item, status: "running" }
        : item));
    } else if (event.type === "tool.completed") {
      const tool = eventData<{ id: string; name: string; failed: boolean }>(event);
      setActivities((items) => items.map((item) => item.id === tool.id
        ? { ...item, status: tool.failed ? "failed" : "completed" }
        : item));
    } else if (event.type === "citation.added") {
      const citation = eventData<Citation>(event);
      setLiveCitations((items) => items.some((item) => item.sourceId === citation.sourceId) ? items : [...items, citation]);
      setActivities((items) => items.some((item) => item.id === `source-${citation.sourceId}`) ? items : [
        ...items,
        {
          id: `source-${citation.sourceId}`,
          label: "收录可追溯证据",
          detail: citation.title,
          status: "completed",
          createdAt: event.createdAt,
        },
      ]);
    } else if (event.type === "clarification.requested") {
      setRunStatus("等待补充研究参数");
    } else if (event.type === "plan.proposed") {
      setLivePlan(eventData<ResearchPlan>(event));
      setRunStatus("科研规划已生成，等待确认");
    } else if (event.type === "run.settled" || event.type === "run.error") {
      setRunStatus(event.type === "run.settled" ? "已完成" : "运行结束");
      setActivities((items) => items.map((item) => item.status === "running"
        ? { ...item, status: event.type === "run.settled" ? "completed" : "failed" }
        : item));
      setRunId(null);
      setStreamingText("");
      const conversationId = streamConversationId.current;
      const detailRequest = conversationId
        ? api.getConversation(conversationId).then(setDetail)
        : Promise.resolve();
      void Promise.all([detailRequest, refreshWorkspace()]).then(() => setLivePlan(null));
    }
  }, [refreshWorkspace]);

  const sendMessage = useCallback(async (content: string, clarificationForNodeId?: string) => {
    if (runId || !selectedModel || (!draftProjectId && (!selectedId || !detail))) return;
    setError(null);
    setStreamingText("");
    setLiveCitations([]);
    setLivePlan(null);
    setActivities([]);
    setRunStatus("正在连接 OceanAgent");
    try {
      if (draftProjectId) {
        const response = await api.startConversation(draftProjectId, content, selectedModel);
        const conversation = response.conversation;
        setSelectedId(conversation.id);
        setDraftProjectId(null);
        setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
        setDetail({
          conversation: { ...conversation, activeNodeId: response.userNode.id },
          nodes: [response.userNode],
          plans: [],
          citations: {},
          traces: {},
        });
        streamConversationId.current = conversation.id;
        setRunId(response.run.id);
        closeStream.current?.();
        closeStream.current = streamRun(response.eventsUrl, handleEvent, () => {
          setError("与 OceanAgent 的事件连接中断，可刷新页面查看已保存结果。");
        });
      } else {
        const response = clarificationForNodeId
          ? await api.submitClarification(selectedId!, clarificationForNodeId, content, selectedModel)
          : await api.sendMessage(selectedId!, content, detail!.conversation.activeNodeId, selectedModel);
        if (response.plan) {
          setLivePlan(response.plan);
          setRunStatus("已通过对话确认规划，正在执行");
        }
        setDetail((current) => current ? {
          ...current,
          conversation: { ...current.conversation, activeNodeId: response.userNode.id },
          nodes: [...current.nodes, response.userNode],
          plans: response.plan
            ? current.plans.map((plan) => plan.id === response.plan!.id ? response.plan! : plan)
            : current.plans,
        } : current);
        streamConversationId.current = selectedId;
        setRunId(response.run.id);
        closeStream.current?.();
        closeStream.current = streamRun(response.eventsUrl, handleEvent, () => {
          setError("与 OceanAgent 的事件连接中断，可刷新页面查看已保存结果。");
        });
      }
    } catch (cause) {
      setRunStatus("发送失败");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [selectedId, draftProjectId, detail, runId, handleEvent, selectedModel]);

  const submitClarification = useCallback((nodeId: string, content: string) => (
    sendMessage(content, nodeId)
  ), [sendMessage]);

  const selectNode = useCallback(async (nodeId: string) => {
    if (!selectedId || runId) return;
    await api.setActiveNode(selectedId, nodeId);
    setDetail((current) => current ? {
      ...current,
      conversation: { ...current.conversation, activeNodeId: nodeId },
    } : current);
  }, [selectedId, runId]);

  const abortRun = useCallback(async () => {
    if (!runId) return;
    setRunStatus("正在停止");
    await api.abortRun(runId);
  }, [runId]);

  const updatePlan = useCallback(async (planId: string, action: "approve" | "reject") => {
    setError(null);
    try {
      if (action === "reject") {
        const response = await api.rejectPlan(planId);
        setLivePlan(response.plan);
        await refreshDetail();
        return;
      }
      const response = await api.approvePlan(planId);
      setLivePlan(response.plan);
      setStreamingText("");
      setLiveCitations([]);
      setActivities([]);
      setRunStatus("已确认规划，正在执行");
      setDetail((current) => current ? {
        ...current,
        conversation: { ...current.conversation, activeNodeId: response.userNode.id },
        nodes: [...current.nodes, response.userNode],
        plans: current.plans.map((plan) => plan.id === response.plan.id ? response.plan : plan),
      } : current);
      streamConversationId.current = selectedId;
      setRunId(response.run.id);
      closeStream.current?.();
      closeStream.current = streamRun(response.eventsUrl, handleEvent, () => {
        setError("规划执行事件连接中断，可刷新页面查看已保存结果。");
      });
    } catch (cause) {
      setRunStatus("规划执行启动失败");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [handleEvent, refreshDetail, selectedId]);

  useEffect(() => () => closeStream.current?.(), []);

  return {
    projects, remoteConnections, modelSettings, selectedModel, conversations, selectedId, draftProjectId, detail, streamingText, liveCitations, livePlan,
    activities, runId, runStatus, ragDocumentCount, ragStatus, error,
    selectConversation, startDraftConversation, createProject, selectLocalDirectory, connectProject, renameProject, renameConversation,
    discoverProviderModels, saveProviderModels, chooseModel,
    deleteProject, deleteConversation, sendMessage, submitClarification, selectNode, abortRun, updatePlan,
  };
}
