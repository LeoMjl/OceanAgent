import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Desktop, FolderOpen, HardDrives, Plus, SpinnerGap, X } from "@phosphor-icons/react";
import type { CreateResearchProjectInput, ProjectExecutionTarget, RemoteConnectionProfile } from "../api";

interface ProjectCreateDialogProps {
  connections: RemoteConnectionProfile[];
  onClose: () => void;
  onCreate: (input: CreateResearchProjectInput) => Promise<unknown>;
  onSelectDirectory: () => Promise<string | null>;
}

export function ProjectCreateDialog(props: ProjectCreateDialogProps) {
  const [target, setTarget] = useState<ProjectExecutionTarget>("local");
  const [title, setTitle] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [connectionMode, setConnectionMode] = useState<"saved" | "new">(props.connections.length ? "saved" : "new");
  const [connectionId, setConnectionId] = useState(props.connections[0]?.id ?? "");
  const [connectionName, setConnectionName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [selectingDirectory, setSelectingDirectory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedConnection = props.connections.find((item) => item.id === connectionId);

  const chooseDirectory = async () => {
    if (selectingDirectory || pending) return;
    setSelectingDirectory(true);
    setError(null);
    try {
      const path = await props.onSelectDirectory();
      if (path) setWorkspacePath(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelectingDirectory(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await props.onCreate({
        title: title.trim(), executionTarget: target, workspacePath: workspacePath.trim(),
        ...(target === "ssh" ? {
          ssh: connectionMode === "saved" ? { connectionId } : {
            name: connectionName.trim(), host: host.trim(), port: Number.parseInt(port, 10),
            username: username.trim(), password,
          },
        } : {}),
      });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const newConnectionReady = connectionName.trim() && host.trim() && username.trim() && password && Number(port) > 0;
  const remoteReady = connectionMode === "saved" ? Boolean(selectedConnection) : newConnectionReady;
  const ready = title.trim() && workspacePath.trim() && (target === "local" || remoteReady);

  return createPortal((
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending && !selectingDirectory) props.onClose();
    }}>
      <form className="project-dialog" onSubmit={(event) => void submit(event)}>
        <header>
          <div><span>NEW RESEARCH PROJECT</span><h2>创建研究项目</h2></div>
          <button type="button" onClick={props.onClose} disabled={pending} aria-label="关闭"><X /></button>
        </header>
        <label className="dialog-field">
          <span>项目名称</span>
          <input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：北部湾叶绿素反演" />
        </label>
        <fieldset className="target-choice">
          <legend>智能体运行位置</legend>
          <button className={target === "local" ? "selected" : ""} type="button" onClick={() => setTarget("local")}>
            <Desktop /><span><b>本地目录</b><small>Pi 工具直接在本机项目目录运行</small></span>
          </button>
          <button className={target === "ssh" ? "selected" : ""} type="button" onClick={() => setTarget("ssh")}>
            <HardDrives /><span><b>远程服务器</b><small>通过 SSH 在 Linux 科研服务器运行</small></span>
          </button>
        </fieldset>
        <label className="dialog-field">
          <span>{target === "local" ? "本地项目目录" : "远程项目目录"}</span>
          <div className={target === "local" ? "path-picker" : undefined}>
            <input required value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)}
              placeholder={target === "local" ? "选择目录或输入绝对路径" : "/data/research/ocean-project"} />
            {target === "local" && <button type="button" onClick={() => void chooseDirectory()} disabled={selectingDirectory || pending}>
              {selectingDirectory ? <SpinnerGap className="spin" /> : <FolderOpen />}选择目录
            </button>}
          </div>
          <small>{target === "local" ? "可使用系统目录选择器；也可手动输入绝对路径。" : "必须是服务器上的 Linux 绝对路径。"}</small>
        </label>

        {target === "ssh" && <section className="remote-connection-section">
          <div className="connection-mode">
            <button type="button" className={connectionMode === "saved" ? "selected" : ""} disabled={!props.connections.length}
              onClick={() => setConnectionMode("saved")}><HardDrives />使用已保存连接</button>
            <button type="button" className={connectionMode === "new" ? "selected" : ""}
              onClick={() => setConnectionMode("new")}><Plus />新增连接</button>
          </div>
          {connectionMode === "saved" ? <label className="dialog-field saved-connection">
            <span>远程连接</span>
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)}>
              {props.connections.map((connection) => <option key={connection.id} value={connection.id}>
                {connection.name} · {connection.username}@{connection.host}:{connection.port}
              </option>)}
            </select>
            {selectedConnection && <small>将使用已安全保存的凭据连接 {selectedConnection.host}。</small>}
          </label> : <div className="ssh-fields">
            <label className="dialog-field connection-name"><span>连接名称</span><input required value={connectionName} onChange={(event) => setConnectionName(event.target.value)} placeholder="例如：实验室 GPU 服务器" /></label>
            <label className="dialog-field host"><span>SSH 主机</span><input required value={host} onChange={(event) => setHost(event.target.value)} placeholder="192.168.1.10 或域名" /></label>
            <label className="dialog-field port"><span>端口</span><input required type="number" min="1" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></label>
            <label className="dialog-field"><span>用户名</span><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="researcher" /></label>
            <label className="dialog-field"><span>密码</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          </div>}
          <p className="credential-note">创建前会测试 SSH 和远程目录。密码由当前 Windows 用户的 DPAPI 加密后保存，不以明文写入 SQLite。</p>
        </section>}

        {error && <div className="dialog-error">{error}</div>}
        <footer>
          <button className="secondary" type="button" onClick={props.onClose} disabled={pending}>取消</button>
          <button className="primary" type="submit" disabled={!ready || pending || selectingDirectory}>
            {pending && <SpinnerGap className="spin" />}{pending && target === "ssh" ? "正在连接…" : pending ? "正在创建…" : target === "ssh" ? "测试连接并创建" : "创建项目"}
          </button>
        </footer>
      </form>
    </div>
  ), document.body);
}
