import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { HardDrives, SpinnerGap, X } from "@phosphor-icons/react";
import type { ResearchProject } from "../api";

export function ProjectReconnectDialog(props: {
  project: ResearchProject;
  onClose: () => void;
  onConnect: (id: string, password: string) => Promise<unknown>;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      await props.onConnect(props.project.id, password);
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return createPortal(<div className="dialog-backdrop" role="presentation">
    <form className="project-dialog reconnect-dialog" onSubmit={(event) => void submit(event)}>
      <header>
        <div><span>SSH CONNECTION</span><h2>重新连接科研服务器</h2></div>
        <button type="button" onClick={props.onClose} disabled={pending} aria-label="关闭"><X /></button>
      </header>
      <div className="connection-summary"><HardDrives /><div><b>{props.project.sshUsername}@{props.project.sshHost}:{props.project.sshPort ?? 22}</b><small>{props.project.workspacePath}</small></div></div>
      <label className="dialog-field"><span>SSH 密码</span><input autoFocus required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <p className="credential-note">连接成功后，密码会由当前 Windows 用户的 DPAPI 加密保存，服务重启后仍可继续使用。</p>
      {error && <div className="dialog-error">{error}</div>}
      <footer>
        <button className="secondary" type="button" onClick={props.onClose} disabled={pending}>取消</button>
        <button className="primary" type="submit" disabled={!password || pending}>{pending && <SpinnerGap className="spin" />}{pending ? "正在连接…" : "测试并连接"}</button>
      </footer>
    </form>
  </div>, document.body);
}
