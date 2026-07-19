import React, { useEffect, useMemo, useState } from "react";
import { callAdmin } from "./api";

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 });
const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 4 });
const pick = (item, ...keys) => keys.find((key) => item?.[key] !== undefined) ? item[keys.find((key) => item?.[key] !== undefined)] : undefined;
const num = (value) => Number(value || 0);
const clientId = (client) => Number(pick(client, "id", "appClientId", "app_client_id") || 0);
const communityIdOf = (item) => Number(pick(item, "communityId", "community_id") || 0);
const accountId = (account) => Number(pick(account, "id", "accountId", "account_id") || 0);
const accountsOf = (payload) => payload?.accounts || payload?.aiProviderAccounts || payload?.providerAccounts || [];
const settingsOf = (client) => client?.billingSettings || client?.billing_settings || client?.settings || {};
const walletOf = (client) => client?.wallet || client?.appClientWallet || {};
const clientName = (client) => pick(client, "name", "clientName", "client_name") || `AppClient #${clientId(client)}`;
const billingSource = (client) => pick(settingsOf(client), "billingSource", "billing_source") || (pick(client, "balanceSource", "balance_source") === "ai_provider" ? "external" : "local");
const isExternalClient = (client) => pick(client, "balanceSource", "balance_source") === "ai_provider" || ["relay", "external"].includes(billingSource(client));
const taskModelsOf = (settings) => pick(settings, "taskModels", "task_models") || {};
const displayDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";

function communityName(communities, id) {
  return communities.find((item) => Number(item.id) === Number(id))?.name || `社区 #${id || "-"}`;
}

function readAccountBalance(externalBilling) {
  const account = externalBilling?.account || {};
  const available = pick(account, "availableBalance", "available_balance", "available", "balance");
  return available === undefined ? null : num(available);
}

function usageRows(externalBilling) {
  const raw = externalBilling?.usage;
  if (Array.isArray(raw)) return raw;
  return raw?.items || raw?.list || raw?.records || raw?.data || [];
}

export default function BillingPage({ onError, onToast, isSuperAdmin = true, communities = [] }) {
  const [mode, setMode] = useState(isSuperAdmin ? "platform" : "community");
  const [clients, setClients] = useState([]);
  const [billingPayload, setBillingPayload] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadClients() {
    setLoading(true);
    try {
      const payload = await callAdmin("adminGetAppClientBilling", { page: 1, pageSize: 100 });
      setClients(payload.clients || []);
      setBillingPayload(payload);
    } catch (error) {
      onError(error, "AppClient 计费信息加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadClients(); }, []);

  return <section className="content-grid billing-page ai-billing-page">
    <header className="billing-toolbar dm-card">
      <div>
        <p className="eyebrow">AI ROUTING & BILLING</p>
        <h3>AI 路由与计费</h3>
        <p className="muted">供应商直接计费；数据中心只负责路由、审计与安全转发。</p>
      </div>
      <div className="billing-view-tabs" role="tablist">
        {isSuperAdmin && <button className={mode === "platform" ? "primary-button" : ""} onClick={() => setMode("platform")}>平台 AI</button>}
        <button className={mode === "community" ? "primary-button" : ""} onClick={() => setMode("community")}>社区 AI</button>
        <button className={mode === "legacy" ? "primary-button" : ""} onClick={() => setMode("legacy")}>旧本地计费</button>
      </div>
    </header>

    {mode === "platform" && isSuperAdmin && <PlatformAiPanel loading={loading} onError={onError} onToast={onToast} />}
    {mode === "community" && <CommunityAiPanel clients={clients} communities={communities} isSuperAdmin={isSuperAdmin} loading={loading} onReload={loadClients} onError={onError} onToast={onToast} />}
    {mode === "legacy" && <LegacyBillingPanel clients={clients.filter((item) => !isExternalClient(item))} payload={billingPayload} isSuperAdmin={isSuperAdmin} onReload={loadClients} onError={onError} onToast={onToast} />}
  </section>;
}

function PlatformAiPanel({ onError, onToast }) {
  const [payload, setPayload] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [accountModal, setAccountModal] = useState(null);
  const [routeModal, setRouteModal] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [settingsResult, accountResult] = await Promise.all([
        callAdmin("adminGetPlatformAiSettings", { page: 1, pageSize: 10 }),
        callAdmin("adminListAiProviderAccounts", { accountScope: "platform" }),
      ]);
      setPayload(settingsResult);
      setAccounts(accountsOf(accountResult));
    } catch (error) { onError(error, "平台 AI 配置加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  const settings = payload?.platformAiSettings || {};
  const external = payload?.externalBilling || {};
  const selectedAccount = payload?.providerAccount || accounts.find((item) => accountId(item) === Number(pick(settings, "aiProviderAccountId", "ai_provider_account_id")));

  async function checkConnection() {
    if (!window.confirm("连通测试会发起一次真实模型请求并产生少量费用，确认继续吗？")) return;
    setLoading(true);
    try {
      await callAdmin("adminCheckPlatformAiConnection");
      onToast({ type: "success", message: "平台 AI 连通测试成功" });
      await load();
    } catch (error) { onError(error, "平台 AI 连通测试失败"); }
    finally { setLoading(false); }
  }

  return <>
    <section className="panel dm-card ai-route-summary">
      <div className="panel-heading">
        <div><h3>平台默认路由</h3><span className="muted">仅承接数据中心自身、无来源或无法归属社区的 AI 请求</span></div>
        <div className="actions"><button onClick={load} disabled={loading}>刷新</button><button onClick={() => setRouteModal(true)} disabled={loading}>编辑路由</button><button className="primary-button" onClick={checkConnection} disabled={loading}>真实连通测试</button></div>
      </div>
      <div className="ai-route-grid">
        <Info label="状态" value={pick(settings, "billingEnabled", "billing_enabled") === false ? "已停用" : "已启用"} />
        <Info label="线路来源" value={sourceLabel(pick(settings, "billingSource", "billing_source") || "local")} />
        <Info label="供应商账户" value={selectedAccount?.name || "未绑定"} />
        <Info label="默认模型" value={pick(settings, "defaultModel", "default_model") || "未配置"} mono />
        <Info label="配置来源" value={payload?.configurationSource === "environment_fallback" ? "旧环境变量回退" : "平台数据库"} />
        <Info label="任务模型" value={`${Object.keys(taskModelsOf(settings)).length} 项`} />
      </div>
      <p className="operation-note">连通测试会产生一次真实模型请求和少量费用；旧环境变量请保留到平台线路验证稳定之后。</p>
    </section>

    <ExternalBillingSummary externalBilling={external} providerAccount={selectedAccount} />
    <ProviderAccountsPanel title="平台供应商账户" accounts={accounts} onCreate={() => setAccountModal({ scope: "platform" })} onEdit={(account) => setAccountModal({ scope: "platform", account })} />

    {external.readError && <ReadError error={external.readError} />}
    {!!usageRows(external).length && <ExternalUsageTable rows={usageRows(external)} />}
    {accountModal && <ProviderAccountModal state={accountModal} onClose={() => setAccountModal(null)} onSaved={async () => { setAccountModal(null); await load(); }} onError={onError} onToast={onToast} />}
    {routeModal && <RouteModal scope="platform" settings={settings} accounts={accounts} onClose={() => setRouteModal(false)} onSaved={async () => { setRouteModal(false); await load(); }} onError={onError} onToast={onToast} />}
  </>;
}

function CommunityAiPanel({ clients, communities, isSuperAdmin, loading, onReload, onError, onToast }) {
  const initialCommunityId = Number(communities[0]?.id || communityIdOf(clients[0]) || 0);
  const [communityId, setCommunityId] = useState(initialCommunityId);
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(0);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [accountModal, setAccountModal] = useState(null);
  const [routeClient, setRouteClient] = useState(null);
  const communityClients = useMemo(() => clients.filter((item) => communityIdOf(item) === Number(communityId)), [clients, communityId]);
  const selectedClient = communityClients.find((item) => clientId(item) === Number(selectedId)) || communityClients[0];

  async function loadAccounts(nextCommunityId = communityId) {
    if (!nextCommunityId) return setAccounts([]);
    setBusy(true);
    try {
      const result = await callAdmin("adminListAiProviderAccounts", { accountScope: "community", communityId: Number(nextCommunityId) });
      setAccounts(accountsOf(result));
    } catch (error) { onError(error, "社区供应商账户加载失败"); }
    finally { setBusy(false); }
  }

  async function loadDetail(id) {
    if (!id) return setDetail(null);
    setBusy(true);
    try {
      setDetail(await callAdmin("adminGetAppClientBilling", { appClientId: Number(id), page: 1, pageSize: 10 }));
    } catch (error) { onError(error, "社区计费详情加载失败"); }
    finally { setBusy(false); }
  }

  useEffect(() => { loadAccounts(communityId); }, [communityId]);
  useEffect(() => {
    const nextId = clientId(selectedClient);
    setSelectedId(nextId);
    loadDetail(nextId);
  }, [communityId, clients.length]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const external = detail?.externalBilling || {};
  const effectiveClient = (detail?.clients || []).find((item) => clientId(item) === clientId(selectedClient)) || selectedClient;
  const selectedAccount = external.providerAccount || accounts.find((item) => accountId(item) === Number(pick(settingsOf(effectiveClient), "aiProviderAccountId", "ai_provider_account_id")));

  return <>
    <section className="panel dm-card">
      <div className="panel-heading">
        <div><h3>社区 AI 路由</h3><span className="muted">每个社区使用独立上游 Key；AppClient 只能绑定同社区账户</span></div>
        <div className="actions">
          <select aria-label="选择社区" value={communityId} onChange={(event) => setCommunityId(Number(event.target.value))} disabled={busy || loading}>
            {communities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button onClick={async () => { await onReload(); await loadAccounts(); }} disabled={busy || loading}>刷新</button>
        </div>
      </div>
      {!communityId && <Empty title="没有可管理的社区" detail="请先为当前后台账号绑定社区。" />}
      {!!communityId && <div className="appclient-route-list">
        {communityClients.length ? communityClients.map((client) => {
          const settings = settingsOf(client);
          const source = billingSource(client);
          return <button key={clientId(client)} className={`appclient-route-card ${clientId(client) === clientId(selectedClient) ? "selected" : ""}`} onClick={() => setSelectedId(clientId(client))}>
            <strong>{clientName(client)}</strong>
            <span>{pick(client, "appid", "appId", "app_id") || `#${clientId(client)}`}</span>
            <em>{sourceLabel(source)} · {pick(settings, "defaultModel", "default_model") || "未配置模型"}</em>
          </button>;
        }) : <Empty title="该社区暂无 AppClient" detail={isSuperAdmin ? "请先创建并绑定社区 AppClient。" : "请联系超级管理员创建 AppClient。"} />}
      </div>}
    </section>

    {selectedClient && <section className="panel dm-card ai-route-summary">
      <div className="panel-heading">
        <div><h3>{clientName(selectedClient)}</h3><span className="muted">{communityName(communities, communityIdOf(selectedClient))}</span></div>
        <button className="primary-button" onClick={() => setRouteClient(effectiveClient)} disabled={busy}>配置账户与模型</button>
      </div>
      <div className="ai-route-grid">
        <Info label="计费来源" value={sourceLabel(billingSource(effectiveClient))} />
        <Info label="余额事实来源" value={isExternalClient(effectiveClient) ? "上游供应商" : "数据中心旧钱包"} />
        <Info label="供应商账户" value={selectedAccount?.name || "未绑定"} />
        <Info label="默认模型" value={pick(settingsOf(effectiveClient), "defaultModel", "default_model") || "未配置"} mono />
      </div>
    </section>}

    {selectedClient && isExternalClient(effectiveClient) && <>
      <ExternalBillingSummary externalBilling={external} providerAccount={selectedAccount} />
      {external.readError && <ReadError error={external.readError} />}
      {!!usageRows(external).length && <ExternalUsageTable rows={usageRows(external)} />}
      <AuditUsageTable rows={detail?.usageEvents || []} />
    </>}
    {selectedClient && !isExternalClient(effectiveClient) && <div className="billing-migration-note dm-card"><strong>此 AppClient 仍使用旧本地钱包</strong><span>余额和历史流水请到“旧本地计费”查看；迁移时为它选择社区供应商账户和模型。</span></div>}

    {!!communityId && <ProviderAccountsPanel title={`${communityName(communities, communityId)} · 供应商账户`} accounts={accounts} onCreate={() => setAccountModal({ scope: "community", communityId })} onEdit={(account) => setAccountModal({ scope: "community", communityId, account })} />}
    {accountModal && <ProviderAccountModal state={accountModal} onClose={() => setAccountModal(null)} onSaved={async () => { setAccountModal(null); await loadAccounts(); }} onError={onError} onToast={onToast} />}
    {routeClient && <RouteModal scope="community" client={routeClient} settings={settingsOf(routeClient)} accounts={accounts} onClose={() => setRouteClient(null)} onSaved={async () => { setRouteClient(null); await onReload(); await loadDetail(clientId(routeClient)); }} onError={onError} onToast={onToast} />}
  </>;
}

function ExternalBillingSummary({ externalBilling = {}, providerAccount }) {
  const account = externalBilling.account || {};
  const balance = readAccountBalance(externalBilling);
  const total = pick(account, "balance", "totalBalance", "total_balance");
  const monthly = pick(account, "currentMonth", "current_month", "monthUsage", "month_usage");
  const cumulative = pick(account, "totalUsage", "total_usage", "used");
  const rechargeUrl = externalBilling?.providerAccount?.rechargeUrl || externalBilling?.providerAccount?.recharge_url || providerAccount?.rechargeUrl || providerAccount?.recharge_url;
  return <div className="metric-row billing-metrics external-billing-metrics">
    <Metric label="上游可用余额" value={balance === null ? "暂不可读" : money.format(balance)} hint="以供应商返回为准" />
    <Metric label="上游总余额" value={total === undefined ? "-" : money.format(num(total))} hint={total === undefined ? "该供应商未返回汇总" : `预留 ${fmt.format(num(pick(account, "reserved", "reservedBalance", "reserved_balance")))}`} />
    <Metric label="本月用量" value={monthly === undefined ? "-" : fmt.format(num(monthly))} hint={cumulative === undefined ? "该供应商未返回汇总" : `累计 ${fmt.format(num(cumulative))}`} />
    <div className="metric dm-card"><span>充值</span><strong>{rechargeUrl ? "供应商管理" : "未配置入口"}</strong>{rechargeUrl ? <a className="primary-button external-recharge-link" href={rechargeUrl} target="_blank" rel="noreferrer">前往供应商充值</a> : <em>请在供应商账户中配置充值链接</em>}</div>
  </div>;
}

function ProviderAccountsPanel({ title, accounts, onCreate, onEdit }) {
  return <section className="panel dm-card">
    <div className="panel-heading"><div><h3>{title}</h3><span className="muted">API Key 永不回显；编辑时留空表示保持原 Key</span></div><button className="primary-button" onClick={onCreate}>新建账户</button></div>
    <div className="billing-scroll"><table><thead><tr><th>账户名</th><th>供应商 / 协议</th><th>Base URL</th><th>Key</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      {accounts.length ? accounts.map((account) => <tr key={accountId(account)}><td><strong>{account.name || `账户 #${accountId(account)}`}</strong></td><td>{providerLabel(pick(account, "providerType", "provider_type"))}<br/><span className="muted">{protocolLabel(account.protocol)}</span></td><td className="mono url-cell">{pick(account, "baseUrl", "base_url") || "-"}</td><td className="mono">•••• {pick(account, "apiKeyLastFour", "api_key_last_four") || "----"}</td><td><span className={`badge badge-${account.status === "active" ? "green" : "red"}`}>{account.status === "active" ? "启用" : "停用"}</span></td><td>{displayDate(pick(account, "updatedAt", "updated_at"))}</td><td><button onClick={() => onEdit(account)}>编辑 / 轮换 Key</button></td></tr>) : <tr><td colSpan="7"><Empty title="暂无供应商账户" detail="先创建账户，再为路由选择账户和模型。" /></td></tr>}
    </tbody></table></div>
  </section>;
}

function ProviderAccountModal({ state, onClose, onSaved, onError, onToast }) {
  const source = state.account || {};
  const [form, setForm] = useState({
    name: source.name || "",
    providerType: pick(source, "providerType", "provider_type") || "relay",
    protocol: source.protocol || "openai_chat",
    baseUrl: pick(source, "baseUrl", "base_url") || "https://s-api.aiarrival.cn/v1",
    apiKey: "",
    rechargeUrl: pick(source, "rechargeUrl", "recharge_url") || "",
    status: source.status || "active",
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((next) => ({ ...next, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const account = { ...form, accountScope: state.scope, ...(state.communityId ? { communityId: Number(state.communityId) } : {}), ...(accountId(source) ? { id: accountId(source) } : {}) };
      if (!account.apiKey) delete account.apiKey;
      await callAdmin("adminUpsertAiProviderAccount", { account });
      onToast({ type: "success", message: accountId(source) ? "供应商账户已保存" : "供应商账户已创建" });
      await onSaved();
    } catch (error) { onError(error, "供应商账户保存失败"); }
    finally { setSaving(false); }
  }
  return <Modal title={accountId(source) ? "编辑供应商账户" : "新建供应商账户"} onClose={onClose}>
    <form className="billing-form" onSubmit={submit}>
      <label>账户名<input required maxLength="120" value={form.name} onChange={(event) => set("name", event.target.value)} /></label>
      <label>供应商类型<select value={form.providerType} onChange={(event) => set("providerType", event.target.value)}><option value="relay">呆猫中转站</option><option value="openai_compatible">OpenAI 兼容服务</option><option value="anthropic">Anthropic</option></select></label>
      <label>协议<select value={form.protocol} onChange={(event) => set("protocol", event.target.value)}><option value="openai_chat">OpenAI Chat</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic_messages">Anthropic Messages</option></select></label>
      <label>状态<select value={form.status} onChange={(event) => set("status", event.target.value)}><option value="active">启用</option><option value="disabled">停用</option></select></label>
      <label>Base URL<input required type="url" placeholder="https://..." value={form.baseUrl} onChange={(event) => set("baseUrl", event.target.value)} /><small>必须是数据中心允许域名内的 HTTPS 地址</small></label>
      <label>充值链接<input type="url" placeholder="https://..." value={form.rechargeUrl} onChange={(event) => set("rechargeUrl", event.target.value)} /></label>
      <label>API Key<input required={!accountId(source)} type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => set("apiKey", event.target.value)} placeholder={accountId(source) ? "留空保持原 Key" : "只会提交到服务端"} /><small>后台不提供查看完整 Key；填写即覆盖/轮换</small></label>
      <button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存账户"}</button>
    </form>
  </Modal>;
}

function RouteModal({ scope, client, settings = {}, accounts, onClose, onSaved, onError, onToast }) {
  const [form, setForm] = useState({
    billingEnabled: pick(settings, "billingEnabled", "billing_enabled") !== false,
    billingSource: pick(settings, "billingSource", "billing_source") || "relay",
    aiProviderAccountId: pick(settings, "aiProviderAccountId", "ai_provider_account_id") || "",
    defaultModel: pick(settings, "defaultModel", "default_model") || "",
    taskModels: JSON.stringify(taskModelsOf(settings), null, 2),
    note: settings.note || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((next) => ({ ...next, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    let taskModels;
    try { taskModels = form.taskModels.trim() ? JSON.parse(form.taskModels) : {}; }
    catch { return onError(new Error("任务模型必须是合法 JSON 对象"), "路由保存失败"); }
    if (!taskModels || Array.isArray(taskModels) || typeof taskModels !== "object") return onError(new Error("任务模型必须是 JSON 对象"), "路由保存失败");
    const next = { ...form, aiProviderAccountId: form.aiProviderAccountId ? Number(form.aiProviderAccountId) : null, taskModels };
    delete next.taskModelsText;
    setSaving(true);
    try {
      if (scope === "platform") await callAdmin("adminUpdatePlatformAiSettings", { settings: next });
      else await callAdmin("adminUpdateAppClientBillingSettings", { appClientId: clientId(client), settings: next });
      onToast({ type: "success", message: "AI 路由配置已保存" });
      await onSaved();
    } catch (error) { onError(error, "AI 路由保存失败"); }
    finally { setSaving(false); }
  }
  const external = ["relay", "external"].includes(form.billingSource);
  return <Modal title={scope === "platform" ? "配置平台默认路由" : `配置 ${clientName(client)} 路由`} onClose={onClose} wide>
    <form className="billing-form" onSubmit={submit}>
      <label className="check-row"><input type="checkbox" checked={form.billingEnabled} onChange={(event) => set("billingEnabled", event.target.checked)} />启用 AI 路由</label>
      <label>线路来源<select value={form.billingSource} onChange={(event) => set("billingSource", event.target.value)}><option value="relay">呆猫中转站（可读余额）</option><option value="external">其他外部供应商</option>{scope === "platform" && <option value="local">旧环境变量回退</option>}{scope === "community" && <option value="local">旧本地计费（迁移期）</option>}</select></label>
      <label>供应商账户<select required={external} disabled={!external} value={form.aiProviderAccountId} onChange={(event) => set("aiProviderAccountId", event.target.value)}><option value="">请选择</option>{accounts.filter((item) => item.status === "active").map((account) => <option key={accountId(account)} value={accountId(account)}>{account.name}</option>)}</select></label>
      <label>默认模型<input required={external} value={form.defaultModel} onChange={(event) => set("defaultModel", event.target.value)} placeholder="供应商模型 ID" /></label>
      <label>备注<input value={form.note} onChange={(event) => set("note", event.target.value)} /></label>
      <label>任务模型 JSON<textarea className="mono" rows="8" value={form.taskModels} onChange={(event) => set("taskModels", event.target.value)} /><small>按任务 key 覆盖默认模型，例如 {`{"assistant_chat_turn":"chat-model"}`}</small></label>
      <button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存路由"}</button>
    </form>
  </Modal>;
}

function LegacyBillingPanel({ clients, payload, isSuperAdmin, onReload, onError, onToast }) {
  const [modal, setModal] = useState(null);
  const ledger = (payload?.walletLedger || []).filter((row) => clients.some((client) => clientId(client) === Number(pick(row, "appClientId", "app_client_id"))));
  async function adjust(form) {
    try {
      await callAdmin("adminAdjustAppClientBalance", form);
      onToast({ type: "success", message: "旧本地钱包余额已调整" });
      setModal(null);
      await onReload();
    } catch (error) { onError(error, "余额调整失败"); }
  }
  return <>
    <div className="billing-migration-note dm-card"><strong>旧本地计费仅用于尚未迁移的 AppClient</strong><span>历史钱包和流水会保留，不回滚、不重算；relay / external 账户禁止在这里充值、调账或冻结。</span></div>
    <section className="panel dm-card"><div className="panel-heading"><div><h3>旧本地钱包</h3><span className="muted">共 {clients.length} 个尚未迁移账户</span></div></div><div className="billing-scroll"><table><thead><tr><th>AppClient</th><th>社区</th><th>状态</th><th>本地余额</th>{isSuperAdmin && <th>操作</th>}</tr></thead><tbody>
      {clients.length ? clients.map((client) => <tr key={clientId(client)}><td><strong>{clientName(client)}</strong></td><td>{communityIdOf(client) || "-"}</td><td>{pick(walletOf(client), "status") || "active"}</td><td>{fmt.format(num(pick(walletOf(client), "balanceUnits", "balance_units", "balance")))}</td>{isSuperAdmin && <td><button onClick={() => setModal(client)}>余额调整</button></td>}</tr>) : <tr><td colSpan={isSuperAdmin ? "5" : "4"}><Empty title="没有旧本地钱包" detail="当前可见 AppClient 已全部迁移或尚未创建。" /></td></tr>}
    </tbody></table></div></section>
    <LegacyLedger rows={ledger} clients={clients} />
    {modal && <LegacyAdjustModal client={modal} onClose={() => setModal(null)} onSubmit={adjust} />}
  </>;
}

function LegacyAdjustModal({ client, onClose, onSubmit }) {
  const [form, setForm] = useState({ mode: "add", entryType: "adjustment", units: "", reason: "", idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}` });
  return <Modal title={`旧钱包余额调整 · ${clientName(client)}`} onClose={onClose}><form className="billing-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, appClientId: clientId(client), units: num(form.units) }); }}>
    <label>方式<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="add">增加</option><option value="subtract">扣减</option><option value="set">设定余额</option></select></label>
    <label>类型<select value={form.entryType} onChange={(event) => setForm({ ...form, entryType: event.target.value })}><option value="adjustment">人工调整</option><option value="grant">赠送</option><option value="refund">退款 / 补偿</option></select></label>
    <label>电力数量<input required min="0" type="number" value={form.units} onChange={(event) => setForm({ ...form, units: event.target.value })} /></label>
    <label>原因<textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
    <button className="primary-button">确认调整旧钱包</button>
  </form></Modal>;
}

function ExternalUsageTable({ rows }) {
  return <section className="panel dm-card"><div className="panel-heading"><div><h3>上游真实计量</h3><span className="muted">供应商返回的最近 {rows.length} 条数据</span></div></div><div className="billing-scroll"><table><thead><tr><th>时间</th><th>模型 / 类型</th><th>输入</th><th>输出</th><th>费用</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at", "timestamp", "time"))}</td><td>{pick(row, "model", "modelName", "model_name", "type") || "-"}</td><td>{fmt.format(num(pick(row, "inputTokens", "input_tokens", "prompt_tokens")))}</td><td>{fmt.format(num(pick(row, "outputTokens", "output_tokens", "completion_tokens")))}</td><td>{fmt.format(num(pick(row, "cost", "amount", "used")))}</td></tr>)}</tbody></table></div></section>;
}

function AuditUsageTable({ rows }) {
  return <section className="panel dm-card"><div className="panel-heading"><div><h3>数据中心审计记录</h3><span className="muted">仅用于审计，不是余额事实来源</span></div></div><div className="billing-scroll"><table><thead><tr><th>时间</th><th>任务</th><th>模型</th><th>Token</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at"))}</td><td>{pick(row, "action", "taskType", "task_type") || "AI 请求"}</td><td>{row.model || "-"}</td><td>{fmt.format(num(pick(row, "totalTokens", "total_tokens")))}</td></tr>) : <tr><td colSpan="4"><Empty title="暂无审计记录" /></td></tr>}</tbody></table></div></section>;
}

function LegacyLedger({ rows, clients }) {
  return <section className="panel dm-card"><div className="panel-heading"><div><h3>旧钱包历史流水</h3><span className="muted">只展示本地钱包数据</span></div></div><div className="billing-scroll"><table><thead><tr><th>时间</th><th>AppClient</th><th>类型</th><th>变动</th><th>余额</th><th>原因</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => { const client = clients.find((item) => clientId(item) === Number(pick(row, "appClientId", "app_client_id"))); return <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at"))}</td><td>{clientName(client || row)}</td><td>{pick(row, "entryType", "entry_type") || "-"}</td><td>{fmt.format(num(pick(row, "unitsDelta", "delta_units", "units")))}</td><td>{fmt.format(num(pick(row, "balanceAfter", "balance_after")))}</td><td>{row.reason || "-"}</td></tr>; }) : <tr><td colSpan="6"><Empty title="暂无旧钱包流水" /></td></tr>}</tbody></table></div></section>;
}

function ReadError({ error }) { return <div className="external-read-error dm-card"><strong>上游数据暂不可用</strong><span>{typeof error === "string" ? error : `${error.code ? `${error.code}: ` : ""}${error.message || JSON.stringify(error)}`}</span><em>不会回退展示数据中心本地钱包余额。</em></div>; }
function Metric({ label, value, hint }) { return <div className="metric dm-card"><span>{label}</span><strong>{value}</strong><em>{hint}</em></div>; }
function Info({ label, value, mono }) { return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function Empty({ title, detail }) { return <div className="empty-state"><strong>{title}</strong>{detail && <span>{detail}</span>}</div>; }
function Modal({ title, children, onClose, wide }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className={`modal-card dm-card billing-modal ${wide ? "modal-wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" onClick={onClose}>关闭</button></div>{children}</div></div>; }
function sourceLabel(source) { return ({ relay: "呆猫中转站", external: "外部供应商", local: "旧本地线路" })[source] || source || "未配置"; }
function providerLabel(type) { return ({ relay: "呆猫中转站", openai_compatible: "OpenAI 兼容", anthropic: "Anthropic" })[type] || type || "-"; }
function protocolLabel(protocol) { return ({ openai_chat: "OpenAI Chat", openai_responses: "OpenAI Responses", anthropic_messages: "Anthropic Messages" })[protocol] || protocol || "-"; }
