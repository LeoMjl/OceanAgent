import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check, CheckCircle, GearSix, MagnifyingGlass, SpinnerGap, WarningCircle, X,
} from "@phosphor-icons/react";
import type { ConfiguredModel, ModelDiscoveryResult, ModelSettingsState } from "../api";

interface ModelSettingsDialogProps {
  settings: ModelSettingsState;
  onClose: () => void;
  onDiscover: (providerId: string, apiKey?: string) => Promise<ModelDiscoveryResult>;
  onSave: (providerId: string, apiKey: string | undefined, modelIds: string[]) => Promise<unknown>;
}

export function ModelSettingsDialog(props: ModelSettingsDialogProps) {
  const initial = props.settings.providers.find((provider) => provider.configured)
    ?? props.settings.providers[0];
  const [providerId, setProviderId] = useState(initial?.id ?? "");
  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ConfiguredModel[]>(
    props.settings.enabledModels.filter((model) => model.providerId === initial?.id),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.enabledModelIds ?? []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<ModelDiscoveryResult | null>(null);
  const provider = props.settings.providers.find((item) => item.id === providerId);
  const filteredProviders = useMemo(() => props.settings.providers.filter((item) => (
    `${item.name} ${item.id}`.toLowerCase().includes(providerSearch.trim().toLowerCase())
  )), [props.settings.providers, providerSearch]);
  const filteredModels = useMemo(() => models.filter((model) => (
    `${model.name} ${model.modelId}`.toLowerCase().includes(modelSearch.trim().toLowerCase())
  )), [models, modelSearch]);

  const chooseProvider = (id: string) => {
    const next = props.settings.providers.find((item) => item.id === id);
    setProviderId(id);
    setApiKey("");
    setModelSearch("");
    setModels(props.settings.enabledModels.filter((model) => model.providerId === id));
    setSelectedIds(next?.enabledModelIds ?? []);
    setError(null);
    setSaved(false);
    setDiscoveryResult(null);
  };

  const discover = async () => {
    if (!provider || loading) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const result = await props.onDiscover(provider.id, apiKey.trim() || undefined);
      setModels(result.models);
      setSelectedIds((items) => items.filter((id) => result.models.some((model) => model.modelId === id)));
      setDiscoveryResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!provider || saving || !selectedIds.length) return;
    setSaving(true);
    setError(null);
    try {
      await props.onSave(provider.id, apiKey.trim() || undefined, selectedIds);
      setApiKey("");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = (id: string) => {
    setSelectedIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
    setSaved(false);
  };

  return createPortal(<div className="dialog-backdrop settings-backdrop" role="presentation">
    <section className="model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
      <header>
        <div><span>OCEANAGENT SETTINGS</span><h2 id="model-settings-title">模型与供应商</h2><p>配置 Pi SDK 供应商，并选择允许在对话中使用的模型。</p></div>
        <button type="button" onClick={props.onClose} aria-label="关闭设置"><X /></button>
      </header>
      <div className="model-settings-body">
        <aside className="provider-browser">
          <label><MagnifyingGlass /><input value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder="搜索供应商" /></label>
          <div>
            {filteredProviders.map((item) => <button key={item.id} type="button" className={item.id === providerId ? "selected" : ""} onClick={() => chooseProvider(item.id)}>
              <span>{item.name}<small>{item.id} · {item.modelCount} 个模型</small></span>
              {item.configured ? <CheckCircle weight="fill" /> : item.configurationMode === "advanced" ? <WarningCircle /> : null}
            </button>)}
          </div>
        </aside>
        <main className="provider-config">
          {provider && <>
            <div className="provider-heading"><div className="provider-mark"><GearSix /></div><div><h3>{provider.name}</h3><p>{provider.modelCount} 个 Pi SDK 模型 · {provider.configured ? "已配置" : "未配置"}</p></div></div>
            {provider.configurationMode === "advanced" ? <div className="advanced-provider-note">
              <WarningCircle /><div><b>需要高级认证</b><p>该供应商除了 API Key，还需要云账号、区域、资源地址或 OAuth 登录。当前设置页暂不提供这种认证方式。</p></div>
            </div> : <>
              <label className="settings-key-field"><span>{provider.keyLabel}</span><div><input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider.credentialSource ? "已安全保存，可留空保持不变" : "粘贴供应商 API Key"} /><button type="button" onClick={() => void discover()} disabled={loading}>{loading ? <><SpinnerGap className="spin" />正在获取</> : "获取模型列表"}</button></div><small>Key 使用 Windows DPAPI 加密，仅当前 Windows 用户可以解密。</small></label>
              {discoveryResult && <div className={`catalog-feedback ${discoveryResult.source}`}>
                <CheckCircle weight="fill" /><div><b>{discoveryResult.source === "remote" ? "供应商实时目录" : "Pi 内置目录"}</b><span>{discoveryResult.message}</span></div>
              </div>}
              <section className="model-picker">
                <header><div><b>启用模型</b><small>可多选；已启用 {selectedIds.length} 个</small></div>{models.length > 8 && <label><MagnifyingGlass /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="筛选模型" /></label>}</header>
                <div className="model-options">
                  {filteredModels.map((model) => <button type="button" key={model.key} className={selectedIds.includes(model.modelId) ? "selected" : ""} onClick={() => toggleModel(model.modelId)}>
                    <i>{selectedIds.includes(model.modelId) && <Check weight="bold" />}</i><span><b>{model.name}</b><small>{model.modelId} · {Math.round(model.contextWindow / 1000)}K 上下文{model.reasoning ? " · 推理" : ""}</small></span>
                  </button>)}
                  {!models.length && <p className="empty-models">填写 Key 后读取 Pi SDK 模型目录。</p>}
                </div>
              </section>
            </>}
          </>}
        </main>
      </div>
      {error && <div className="settings-message error">{error}</div>}
      {saved && <div className="settings-message success">模型配置已保存，可在对话输入区选择。</div>}
      <footer><button type="button" className="secondary" onClick={props.onClose}>完成</button><button type="button" className="primary" disabled={provider?.configurationMode === "advanced" || !selectedIds.length || saving} onClick={() => void save()}>{saving && <SpinnerGap className="spin" />}保存供应商</button></footer>
    </section>
  </div>, document.body);
}
