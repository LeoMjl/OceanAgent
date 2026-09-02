import { ChatPane } from "./components/ChatPane";
import { EvidencePanel } from "./components/EvidencePanel";
import { Sidebar } from "./components/Sidebar";
import { useOceanAgent } from "./useOceanAgent";
import "./styles.css";

export default function App() {
  const ocean = useOceanAgent();

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <Sidebar
        projects={ocean.projects}
        remoteConnections={ocean.remoteConnections}
        conversations={ocean.conversations}
        selectedId={ocean.selectedId}
        draftProjectId={ocean.draftProjectId}
        busy={Boolean(ocean.runId)}
        modelSettings={ocean.modelSettings}
        onCreateProject={ocean.createProject}
        onSelectDirectory={ocean.selectLocalDirectory}
        onConnectProject={ocean.connectProject}
        onNewConversation={ocean.startDraftConversation}
        onRenameProject={ocean.renameProject}
        onDeleteProject={ocean.deleteProject}
        onRenameConversation={ocean.renameConversation}
        onDeleteConversation={ocean.deleteConversation}
        onSelect={ocean.selectConversation}
        onDiscoverProviderModels={ocean.discoverProviderModels}
        onSaveProviderModels={ocean.saveProviderModels}
      />
      <ChatPane
        detail={ocean.detail}
        draftProjectTitle={ocean.projects.find((project) => project.id === ocean.draftProjectId)?.title}
        streamingText={ocean.streamingText}
        activities={ocean.activities}
        liveCitations={ocean.liveCitations}
        status={ocean.runStatus}
        busy={Boolean(ocean.runId)}
        error={ocean.error}
        models={ocean.modelSettings?.enabledModels ?? []}
        selectedModel={ocean.selectedModel}
        onModelChange={(model) => void ocean.chooseModel(model)}
        onSend={(content) => void ocean.sendMessage(content)}
        onClarify={(nodeId, content) => void ocean.submitClarification(nodeId, content)}
        onAbort={() => void ocean.abortRun()}
      />
      <EvidencePanel
        detail={ocean.detail}
        livePlan={ocean.livePlan}
        activities={ocean.activities}
        busy={Boolean(ocean.runId)}
        status={ocean.runStatus}
        ragStatus={ocean.ragStatus}
        onPlanAction={(id, action) => void ocean.updatePlan(id, action)}
      />
    </div>
  );
}
