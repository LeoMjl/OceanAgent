import { useEffect, useMemo, useState } from "react";
import {
  CaretDown, Check, ChatsCircle, DotsThree, FolderOpen, GearSix, HardDrives, PencilSimple, Plus, Trash, Waves, X,
} from "@phosphor-icons/react";
import type { Conversation, CreateResearchProjectInput, ModelDiscoveryResult, ModelSettingsState, ResearchProject, RemoteConnectionProfile } from "../api";
import { shortText } from "../tree";
import { ProjectCreateDialog } from "./ProjectCreateDialog";
import { ProjectReconnectDialog } from "./ProjectReconnectDialog";
import { ModelSettingsDialog } from "./ModelSettingsDialog";

interface SidebarProps {
  projects: ResearchProject[];
  remoteConnections: RemoteConnectionProfile[];
  conversations: Conversation[];
  selectedId: string | null;
  draftProjectId: string | null;
  busy: boolean;
  modelSettings: ModelSettingsState | null;
  onCreateProject: (input: CreateResearchProjectInput) => Promise<unknown>;
  onSelectDirectory: () => Promise<string | null>;
  onConnectProject: (id: string, password: string) => Promise<unknown>;
  onNewConversation: (projectId: string) => void;
  onRenameProject: (id: string, title: string) => Promise<unknown>;
  onDeleteProject: (id: string) => Promise<unknown>;
  onRenameConversation: (id: string, title: string) => Promise<unknown>;
  onDeleteConversation: (id: string) => Promise<unknown>;
  onSelect: (id: string) => void;
  onDiscoverProviderModels: (providerId: string, apiKey?: string) => Promise<ModelDiscoveryResult>;
  onSaveProviderModels: (providerId: string, apiKey: string | undefined, modelIds: string[]) => Promise<unknown>;
}

function NameEditor(props: {
  initial?: string;
  placeholder: string;
  onCommit: (value: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  const [pending, setPending] = useState(false);
  const submit = async () => {
    const title = value.trim();
    if (!title || pending) return;
    setPending(true);
    try {
      await props.onCommit(title);
      props.onCancel();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="name-editor">
      <input
        autoFocus value={value} placeholder={props.placeholder} disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") props.onCancel();
        }}
      />
      <button type="button" disabled={!value.trim() || pending} onClick={() => void submit()} aria-label="保存名称"><Check /></button>
      <button type="button" disabled={pending} onClick={props.onCancel} aria-label="取消"><X /></button>
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const selectedProjectId = props.draftProjectId
    ?? props.conversations.find((item) => item.id === props.selectedId)?.projectId;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creatingProject, setCreatingProject] = useState(false);
  const [showingSettings, setShowingSettings] = useState(false);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [reconnectingProject, setReconnectingProject] = useState<ResearchProject | null>(null);
  const [renamingConversation, setRenamingConversation] = useState<string | null>(null);
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);
  const [openConversationMenu, setOpenConversationMenu] = useState<string | null>(null);
  const byProject = useMemo(() => {
    const grouped = new Map<string, Conversation[]>();
    for (const conversation of props.conversations) {
      grouped.set(conversation.projectId, [...(grouped.get(conversation.projectId) ?? []), conversation]);
    }
    return grouped;
  }, [props.conversations]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setExpanded((items) => new Set(items).add(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    if (!openProjectMenu) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(`[data-project-menu="${openProjectMenu}"]`)) {
        setOpenProjectMenu(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openProjectMenu]);

  useEffect(() => {
    if (!openConversationMenu) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(`[data-session-menu="${openConversationMenu}"]`)) {
        setOpenConversationMenu(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openConversationMenu]);

  const toggleProject = (id: string) => {
    setExpanded((items) => {
      const next = new Set(items);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <header className="brand">
        <div className="wave-mark" aria-hidden="true"><Waves weight="duotone" /></div>
        <div>
          <strong>OceanAgent</strong>
          <span>海洋科研智能体</span>
        </div>
      </header>

      <button className="new-research" type="button" disabled={props.busy} onClick={() => setCreatingProject(true)}>
        <Plus weight="bold" /> 新建研究项目
      </button>
      {creatingProject && (
        <ProjectCreateDialog
          connections={props.remoteConnections}
          onCreate={props.onCreateProject}
          onSelectDirectory={props.onSelectDirectory}
          onClose={() => setCreatingProject(false)}
        />
      )}
      {reconnectingProject && <ProjectReconnectDialog
        project={reconnectingProject}
        onConnect={props.onConnectProject}
        onClose={() => setReconnectingProject(null)}
      />}
      {showingSettings && props.modelSettings && <ModelSettingsDialog
        settings={props.modelSettings}
        onDiscover={props.onDiscoverProviderModels}
        onSave={props.onSaveProviderModels}
        onClose={() => setShowingSettings(false)}
      />}

      <section className="side-section project-section">
        <div className="section-kicker">研究项目 <span>{props.projects.length}</span></div>
        <div className="project-list">
          {props.projects.map((project) => {
            const sessions = byProject.get(project.id) ?? [];
            const isOpen = expanded.has(project.id);
            return (
              <div className={`project-group ${project.id === selectedProjectId ? "active-project" : ""}`} key={project.id}>
                {renamingProject === project.id ? (
                  <NameEditor
                    initial={project.title}
                    placeholder="项目名称"
                    onCommit={(title) => props.onRenameProject(project.id, title)}
                    onCancel={() => setRenamingProject(null)}
                  />
                ) : (
                  <div className="project-row">
                    <button className="project-main" type="button" onClick={() => toggleProject(project.id)}>
                      <CaretDown className={isOpen ? "open" : ""} />
                      <FolderOpen weight={project.id === selectedProjectId ? "fill" : "regular"} />
                      <span title={`${project.title}\n${project.workspacePath}`}>{shortText(project.title, 24)}</span>
                      {project.executionTarget === "ssh" && <i className={`project-connection ${project.connectionStatus}`} title={project.connectionStatus === "saved" ? "SSH 连接已安全保存" : project.connectionStatus === "connected" ? "SSH 已连接" : "SSH 需要重新连接"}><HardDrives /></i>}
                      <small>{sessions.length}</small>
                    </button>
                    <div className="project-actions" data-project-menu={project.id}>
                      <button
                        className="session-menu-trigger" type="button" disabled={props.busy}
                        aria-label={`${project.title}的更多操作`} aria-expanded={openProjectMenu === project.id}
                        onClick={() => {
                          setOpenConversationMenu(null);
                          setOpenProjectMenu((value) => value === project.id ? null : project.id);
                        }}
                      ><DotsThree weight="bold" /></button>
                      {openProjectMenu === project.id && (
                        <div className="session-menu project-menu" role="menu">
                          {project.executionTarget === "ssh" && project.connectionStatus === "credentials_required" && <button type="button" role="menuitem" onClick={() => {
                            setOpenProjectMenu(null);
                            setReconnectingProject(project);
                          }}><HardDrives /><span>连接服务器</span></button>}
                          <button type="button" role="menuitem" onClick={() => {
                            setOpenProjectMenu(null);
                            setExpanded((items) => new Set(items).add(project.id));
                            props.onNewConversation(project.id);
                          }}><Plus /><span>新建会话</span></button>
                          <button type="button" role="menuitem" onClick={() => {
                            setOpenProjectMenu(null);
                            setRenamingProject(project.id);
                          }}><PencilSimple /><span>重命名</span></button>
                          <div className="session-menu-divider" />
                          <button className="danger" type="button" role="menuitem" onClick={() => {
                            setOpenProjectMenu(null);
                            if (window.confirm(`确定删除项目“${project.title}”及其中的 ${sessions.length} 个会话吗？此操作不可撤销。`)) {
                              void props.onDeleteProject(project.id);
                            }
                          }}><Trash /><span>删除项目</span></button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isOpen && (
                  <div className="session-list">
                    {sessions.map((session) => renamingConversation === session.id ? (
                      <NameEditor key={session.id} initial={session.title} placeholder="会话名称" onCommit={(title) => props.onRenameConversation(session.id, title)} onCancel={() => setRenamingConversation(null)} />
                    ) : (
                      <div className={`session-row ${session.id === props.selectedId ? "selected" : ""}`} key={session.id}>
                        <button className="session-main" type="button" disabled={props.busy} onClick={() => props.onSelect(session.id)}>
                          <ChatsCircle weight={session.id === props.selectedId ? "fill" : "regular"} />
                          <span title={session.title}>{shortText(session.title, 27)}</span>
                        </button>
                        <div className="session-actions" data-session-menu={session.id}>
                          <button
                            className="session-menu-trigger" type="button" disabled={props.busy}
                            aria-label={`${session.title}的更多操作`} aria-expanded={openConversationMenu === session.id}
                            onClick={() => {
                              setOpenProjectMenu(null);
                              setOpenConversationMenu((value) => value === session.id ? null : session.id);
                            }}
                          ><DotsThree weight="bold" /></button>
                          {openConversationMenu === session.id && (
                            <div className="session-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => {
                                setOpenConversationMenu(null);
                                setRenamingConversation(session.id);
                              }}><PencilSimple /><span>重命名</span></button>
                              <div className="session-menu-divider" />
                              <button className="danger" type="button" role="menuitem" onClick={() => {
                                setOpenConversationMenu(null);
                                if (window.confirm(`确定删除会话“${session.title}”吗？此操作不可撤销。`)) {
                                  void props.onDeleteConversation(session.id);
                                }
                              }}><Trash /><span>删除</span></button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {sessions.length === 0 && <p className="empty-sessions">通过项目右侧 ··· 新建会话</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <button className="sidebar-settings" type="button" disabled={!props.modelSettings || props.busy} onClick={() => setShowingSettings(true)}>
        <GearSix /><span><b>设置</b><small>{props.modelSettings?.enabledModels.length ?? 0} 个可用模型</small></span>
      </button>
    </aside>
  );
}
