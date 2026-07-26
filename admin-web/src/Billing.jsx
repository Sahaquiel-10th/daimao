import React, { useEffect, useMemo, useState } from "react";
import { callAdmin } from "./api";

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 });
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
const displayDate = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
const daimaoMiniProgramAppId = "wx2bc83fb7b03cd3d1";
const usagePageSize = 15;

const providerPresets = {
  super_relay: { label: "超级中转站（推荐）", baseUrl: "https://s-api.aiarrival.cn/v1", hint: "默认地址已经填好。系统按模型自动选择 OpenAI Chat 或 Anthropic Messages，并读取真实电力余额和用量。" },
  custom_auto: { label: "其他 API 服务", baseUrl: "", hint: "适用于官方 API 和兼容中转站。填写对方提供的 /v1 Base URL；系统默认按模型自动判断接口格式。" },
};

function communityName(communities, id) {
  return communities.find((item) => Number(item.id) === Number(id))?.name || `社区 #${id || "-"}`;
}

function usageRows(externalBilling) {
  const raw = externalBilling?.usage;
  if (Array.isArray(raw)) return raw;
  return raw?.items || raw?.list || raw?.records || raw?.data || [];
}

function usagePagination(externalBilling, page, rows) {
  const raw = externalBilling?.usage || {};
  const pagination = raw.pagination || raw.meta || {};
  const totalPages = Number(pick(pagination, "totalPages", "total_pages", "pages") || pick(raw, "totalPages", "total_pages", "pages") || 0);
  const hasMoreValue = pick(pagination, "hasMore", "has_more") ?? pick(raw, "hasMore", "has_more");
  return {
    totalPages,
    hasMore: hasMoreValue === undefined ? (totalPages ? page < totalPages : rows.length >= usagePageSize) : Boolean(hasMoreValue),
  };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function exportUsageCsv(rows, filename) {
  const columns = ["时间", "任务", "模型", "输入 Token", "输出 Token", "总 Token", "消耗电力", "状态", "请求 ID"];
  const lines = rows.map((row) => [
    displayDate(pick(row, "createdAt", "created_at", "occurredAt", "occurred_at", "timestamp", "time")),
    pick(row, "action", "taskType", "task_type") || "AI 请求",
    pick(row, "model", "providerModel", "provider_model", "modelName", "model_name", "type") || "",
    num(pick(row, "inputTokens", "input_tokens", "prompt_tokens")),
    num(pick(row, "outputTokens", "output_tokens", "completion_tokens")),
    num(pick(row, "totalTokens", "total_tokens")) || num(pick(row, "inputTokens", "input_tokens", "prompt_tokens")) + num(pick(row, "outputTokens", "output_tokens", "completion_tokens")),
    pick(row, "providerChargedPower", "provider_charged_power", "cost", "chargedPower", "charged_power", "amount", "used") ?? "",
    pick(row, "providerStatus", "provider_status", "status", "billingStatus", "billing_status") || "",
    pick(row, "providerRequestId", "provider_request_id", "requestId", "request_id", "id") || "",
  ].map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${columns.map(csvCell).join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
    } catch (error) { onError(error, "AI 线路加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadClients(); }, []);

  return <section className="content-grid billing-page ai-billing-page">
    <header className="billing-toolbar dm-card simple-ai-header">
      <div><p className="eyebrow">AI CONNECTION</p><h3>AI 连接与用量</h3><p className="muted">日常接入只需要模型 ID 和 API Key，地址已经默认填好。</p></div>
      <div className="billing-view-tabs" role="tablist">
        {isSuperAdmin && <button className={mode === "platform" ? "primary-button" : ""} onClick={() => setMode("platform")}>平台线路</button>}
        <button className={mode === "community" ? "primary-button" : ""} onClick={() => setMode("community")}>社区线路</button>
        <button className={mode === "legacy" ? "primary-button" : ""} onClick={() => setMode("legacy")}>旧钱包记录</button>
      </div>
    </header>
    {mode === "platform" && isSuperAdmin && <PlatformPanel onError={onError} onToast={onToast} />}
    {mode === "community" && <CommunityPanel clients={clients} communities={communities} isSuperAdmin={isSuperAdmin} loading={loading} onReload={loadClients} onError={onError} onToast={onToast} />}
    {mode === "legacy" && <LegacyPanel clients={clients.filter((item) => !isExternalClient(item))} payload={billingPayload} isSuperAdmin={isSuperAdmin} onReload={loadClients} onError={onError} onToast={onToast} />}
  </section>;
}

function PlatformPanel({ onError, onToast }) {
  const [payload, setPayload] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connect, setConnect] = useState(false);
  const [usagePage, setUsagePage] = useState(1);

  async function load(page = usagePage) {
    setLoading(true);
    try {
      const [settingsResult, accountsResult] = await Promise.all([
        callAdmin("adminGetPlatformAiSettings", { page, pageSize: usagePageSize }),
        callAdmin("adminListAiProviderAccounts", { accountScope: "platform" }),
      ]);
      setPayload(settingsResult);
      setAccounts(accountsOf(accountsResult));
    } catch (error) { onError(error, "平台 AI 线路加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const settings = payload?.platformAiSettings || {};
  const account = payload?.providerAccount || accounts.find((item) => accountId(item) === Number(pick(settings, "aiProviderAccountId", "ai_provider_account_id")));
  const connected = pick(settings, "billingSource", "billing_source") !== "local" && account;
  const providerRows = usageRows(payload?.externalBilling);
  const providerPagination = usagePagination(payload?.externalBilling, usagePage, providerRows);

  async function changeUsagePage(nextPage) {
    const next = Math.max(1, nextPage);
    setUsagePage(next);
    await load(next);
  }

  async function exportAllUsage() {
    setLoading(true);
    try {
      const allRows = [];
      for (let page = 1; page <= 667; page += 1) {
        const result = await callAdmin("adminGetPlatformAiSettings", { page, pageSize: usagePageSize });
        const rows = usageRows(result?.externalBilling);
        allRows.push(...rows);
        const pagination = usagePagination(result?.externalBilling, page, rows);
        if (!pagination.hasMore || !rows.length) break;
      }
      exportUsageCsv(allRows, "平台-AI调用消耗-全部.csv");
      onToast({ type: "success", message: `已导出 ${allRows.length} 条平台调用记录` });
    } catch (error) { onError(error, "平台调用日志导出失败"); }
    finally { setLoading(false); }
  }

  async function test() {
    if (!window.confirm("会发送一次很短的真实请求，产生少量费用。继续测试吗？")) return;
    setLoading(true);
    try { await callAdmin("adminCheckPlatformAiConnection"); onToast({ type: "success", message: "平台线路连接成功" }); }
    catch (error) { onError(error, "平台线路测试失败"); }
    finally { setLoading(false); }
  }

  return <>
    <ConnectionCard title="平台默认线路" description="供数据中心自身和无法归属社区的请求使用" settings={settings} account={account} connected={connected} loading={loading} onConnect={() => setConnect(true)} onTest={connected ? test : null} />
    {connected && <BillingFacts externalBilling={payload?.externalBilling} account={account} />}
    {payload?.externalBilling?.readError && <ReadError error={payload.externalBilling.readError} />}
    {connected && <CallUsage
      rows={providerRows}
      page={usagePage}
      hasMore={providerPagination.hasMore}
      totalPages={providerPagination.totalPages}
      loading={loading}
      source="provider"
      onPageChange={changeUsagePage}
      onExportAll={exportAllUsage}
    />}
    <AdvancedAccounts title="历史供应商连接" accounts={accounts} />
    {connect && <QuickConnectModal scope="platform" currentSettings={settings} currentAccount={account} onClose={() => setConnect(false)} onSaved={load} onError={onError} onToast={onToast} />}
  </>;
}

function CommunityPanel({ clients, communities, isSuperAdmin, loading, onReload, onError, onToast }) {
  const initialCommunityId = Number(communities[0]?.id || communityIdOf(clients[0]) || 0);
  const [communityId, setCommunityId] = useState(initialCommunityId);
  const [selectedId, setSelectedId] = useState(0);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [connect, setConnect] = useState(false);
  const [clientSetup, setClientSetup] = useState(false);
  const [usagePage, setUsagePage] = useState(1);
  const communityClients = useMemo(() => clients.filter((item) => communityIdOf(item) === communityId), [clients, communityId]);
  const selected = communityClients.find((item) => clientId(item) === selectedId) || communityClients[0];

  async function loadDetail(id, page = usagePage) {
    if (!id) return setDetail(null);
    setBusy(true);
    try { setDetail(await callAdmin("adminGetAppClientBilling", { appClientId: id, page, pageSize: usagePageSize })); }
    catch (error) { onError(error, "社区 AI 线路加载失败"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const next = clientId(communityClients[0]);
    setSelectedId(next);
    setUsagePage(1);
    loadDetail(next, 1);
  }, [communityId, clients.length]);
  useEffect(() => {
    if (!selectedId) return;
    setUsagePage(1);
    loadDetail(selectedId, 1);
  }, [selectedId]);
  useEffect(() => {
    if (!communityId && communities[0]?.id) setCommunityId(Number(communities[0].id));
  }, [communityId, communities]);

  const effectiveClient = (detail?.clients || []).find((item) => clientId(item) === clientId(selected)) || selected;
  const settings = settingsOf(effectiveClient);
  const account = detail?.externalBilling?.providerAccount;
  const connected = effectiveClient && isExternalClient(effectiveClient) && account;
  const auditRows = detail?.usageEvents || [];
  const providerRows = usageRows(detail?.externalBilling);
  const callRows = providerRows.length ? providerRows : auditRows;
  const localHasMore = Boolean(pick(detail?.pagination || {}, "hasMoreUsage", "has_more_usage"));
  const providerPagination = usagePagination(detail?.externalBilling, usagePage, providerRows);
  const hasMoreUsage = providerRows.length ? providerPagination.hasMore : localHasMore;

  async function changeUsagePage(nextPage) {
    const next = Math.max(1, nextPage);
    setUsagePage(next);
    await loadDetail(clientId(selected), next);
  }

  async function exportAllUsage() {
    setBusy(true);
    try {
      const allRows = [];
      let useProvider = null;
      for (let page = 1; page <= 667; page += 1) {
        const result = await callAdmin("adminGetAppClientBilling", { appClientId: clientId(selected), page, pageSize: usagePageSize });
        const pageAuditRows = result?.usageEvents || [];
        const pageProviderRows = usageRows(result?.externalBilling);
        if (useProvider === null) useProvider = pageProviderRows.length > 0;
        const rows = useProvider ? pageProviderRows : pageAuditRows;
        allRows.push(...rows);
        const hasMore = useProvider
          ? usagePagination(result?.externalBilling, page, pageProviderRows).hasMore
          : Boolean(pick(result?.pagination || {}, "hasMoreUsage", "has_more_usage"));
        if (!hasMore || !rows.length) break;
      }
      exportUsageCsv(allRows, `${clientName(selected)}-AI调用消耗-全部.csv`);
      onToast({ type: "success", message: `已导出 ${allRows.length} 条调用记录` });
    } catch (error) { onError(error, "社区调用日志导出失败"); }
    finally { setBusy(false); }
  }

  return <>
    <section className="panel dm-card simple-client-picker">
      <div className="panel-heading"><div><h3>选择要接入的应用</h3><span className="muted">AppClient 就是使用 AI 的小程序、网站或服务</span></div><div className="actions"><select aria-label="选择社区" value={communityId} onChange={(event) => setCommunityId(Number(event.target.value))}>{communities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{isSuperAdmin && <button className="primary-button" disabled={!communityId || busy || loading} onClick={() => setClientSetup(true)}>添加 / 绑定小程序</button>}<button disabled={busy || loading} onClick={onReload}>刷新</button></div></div>
      {!communityId ? <Empty title="没有可管理的社区" /> : communityClients.length ? <div className="appclient-route-list">{communityClients.map((client) => <button key={clientId(client)} className={`appclient-route-card ${clientId(client) === clientId(selected) ? "selected" : ""}`} onClick={() => setSelectedId(clientId(client))}><strong>{clientName(client)}</strong><span>{pick(client, "appid", "appId", "app_id") || `#${clientId(client)}`}</span><em>{isExternalClient(client) ? pick(settingsOf(client), "defaultModel", "default_model") || "已接入" : "等待接入"}</em></button>)}</div> : <div className="empty-client-setup"><Empty title="该社区暂无 AppClient" detail={isSuperAdmin ? "点击“添加 / 绑定小程序”，把呆猫小程序绑定到当前社区。" : "请联系超级管理员绑定小程序。"} />{isSuperAdmin && <button className="primary-button" onClick={() => setClientSetup(true)}>添加 / 绑定小程序</button>}</div>}
    </section>
    {selected && <>
      <ConnectionCard title={clientName(selected)} description={communityName(communities, communityIdOf(selected))} settings={settings} account={account} connected={connected} loading={busy} onConnect={() => setConnect(true)} />
      {connected && <BillingFacts externalBilling={detail?.externalBilling} account={account} />}
      {detail?.externalBilling?.readError && <ReadError error={detail.externalBilling.readError} />}
      {connected && <CallUsage
        rows={callRows}
        page={usagePage}
        hasMore={hasMoreUsage}
        totalPages={providerRows.length ? providerPagination.totalPages : 0}
        loading={busy}
        source={providerRows.length ? "provider" : "audit"}
        onPageChange={changeUsagePage}
        onExportAll={exportAllUsage}
      />}
      {!connected && <div className="billing-migration-note dm-card"><strong>还没有接入中转站</strong><span>点击“立即接入”，通常只需填写模型 ID 和 API Key。</span></div>}
      {connect && <QuickConnectModal scope="community" appClient={selected} currentSettings={settings} currentAccount={account} onClose={() => setConnect(false)} onSaved={async () => { await onReload(); setUsagePage(1); await loadDetail(clientId(selected), 1); }} onError={onError} onToast={onToast} />}
    </>}
    {clientSetup && <AppClientSetupModal communityId={communityId} communityLabel={communityName(communities, communityId)} clients={clients} onClose={() => setClientSetup(false)} onSaved={async () => { setClientSetup(false); await onReload(); }} onError={onError} onToast={onToast} />}
  </>;
}

function AppClientSetupModal({ communityId, communityLabel, clients, onClose, onSaved, onError, onToast }) {
  const [form, setForm] = useState({ name: "呆猫小程序", appid: daimaoMiniProgramAppId });
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    const normalizedAppid = form.appid.trim();
    const existing = clients.find((item) => String(pick(item, "appid", "appId", "app_id") || "").trim() === normalizedAppid);
    const previousCommunityId = communityIdOf(existing);
    try {
      const result = await callAdmin("adminUpsertAppClient", {
        client: {
          ...(existing ? { id: clientId(existing) } : {}),
          appid: normalizedAppid,
          name: form.name.trim(),
          communityId,
          clientType: "wechat_miniprogram",
          status: "active",
        },
      });
      if (existing && previousCommunityId !== Number(communityId) && isExternalClient(existing)) {
        await callAdmin("adminUpdateAppClientBillingSettings", {
          appClientId: clientId(existing),
          settings: { billingEnabled: false, billingSource: "local", aiProviderAccountId: null, defaultModel: "", taskModels: {}, note: "AppClient 重新绑定社区后等待配置 AI 线路" },
        });
      }
      onToast({ type: "success", message: existing ? `小程序已绑定到 ${communityLabel}` : `小程序已添加到 ${communityLabel}` });
      await onSaved(result.appClient);
    } catch (error) { onError(error, "小程序绑定失败"); }
    finally { setSaving(false); }
  }

  return <Modal title={`添加 / 绑定小程序 · ${communityLabel}`} onClose={onClose}>
    <form className="quick-connect-form" onSubmit={submit}>
      <div className="quick-connect-intro"><strong>这里设置 AppClient</strong><span>保存后，这个小程序就会出现在当前社区的 AI 线路列表中。</span></div>
      <Field label="小程序名称" help="只用于后台识别，不影响小程序里显示的名称。"><input required autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：呆猫小程序" /></Field>
      <Field label="小程序 AppID" help="在微信公众平台或微信开发者工具的项目配置里查看。呆猫小程序的 AppID 已经默认填好。"><input required className="mono" value={form.appid} onChange={(event) => setForm({ ...form, appid: event.target.value.trim() })} placeholder="wx..." /></Field>
      <div className="provider-note"><strong>将绑定到：{communityLabel}</strong><span>如果这个 AppID 已绑定到其他社区，保存后会移动到当前社区；旧社区的 AI 线路会解除，避免跨社区共用 Key。</span></div>
      <button className="primary-button quick-connect-submit" disabled={saving}>{saving ? "正在保存…" : "保存小程序绑定"}</button>
    </form>
  </Modal>;
}

function ConnectionCard({ title, description, settings = {}, account, connected, loading, onConnect, onTest }) {
  const model = pick(settings, "defaultModel", "default_model");
  return <section className={`panel dm-card connection-card ${connected ? "is-connected" : "is-empty"}`}>
    <div className="panel-heading"><div><div className="connection-title"><span className={`connection-dot ${connected ? "online" : ""}`} /><h3>{title}</h3></div><span className="muted">{description}</span></div><div className="actions">{onTest && <button onClick={onTest} disabled={loading}>测试当前连接</button>}<button className="primary-button" onClick={onConnect} disabled={loading}>{connected ? "接入 / 更换线路" : "立即接入"}</button></div></div>
    {connected ? <div className="simple-connection-facts"><Info label="模型 ID" value={model || "-"} mono /><Info label="Base URL" value={pick(account, "baseUrl", "base_url") || "-"} mono /><Info label="API Key" value={`已安全保存 · 末四位 ${pick(account, "apiKeyLastFour", "api_key_last_four") || "----"}`} /><Info label="接口格式" value={account?.protocol === "anthropic_messages" ? "Anthropic Messages" : "OpenAI Chat"} /></div> : <div className="empty-connection"><strong>尚未连接</strong><span>默认使用超级中转站地址，你只需要准备模型 ID 和 API Key。</span></div>}
  </section>;
}

function QuickConnectModal({ scope, appClient, currentSettings = {}, currentAccount, onClose, onSaved, onError, onToast }) {
  const inferredPreset = inferPreset(currentAccount);
  const [form, setForm] = useState({
    providerPreset: inferredPreset,
    protocolPreference: currentAccount?.protocol || "auto",
    model: pick(currentSettings, "defaultModel", "default_model") || "",
    apiKey: "",
    baseUrl: pick(currentAccount, "baseUrl", "base_url") || providerPresets[inferredPreset].baseUrl,
  });
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const preset = providerPresets[form.providerPreset];
  const usesAnthropic = form.protocolPreference === "anthropic_messages"
    || (form.protocolPreference === "auto" && /^claude(?:[-_.]|$)/i.test(form.model));
  function changePreset(value) {
    setForm((next) => ({
      ...next,
      providerPreset: value,
      baseUrl: providerPresets[value].baseUrl,
      protocolPreference: "auto",
    }));
    setConnectionError(null);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setConnectionError(null);
    try {
      const result = await callAdmin("adminQuickConnectAi", { scope, ...(appClient ? { appClientId: clientId(appClient) } : {}), ...form });
      await onSaved();
      if (result.connection?.success === false) {
        setConnectionError(result.connection);
        return;
      }
      onToast({ type: "success", message: "AI 线路已连接并测试成功" });
      onClose();
    } catch (error) { onError(error, "AI 线路接入失败"); }
    finally { setSaving(false); }
  }
  return <Modal title={scope === "platform" ? "接入平台 AI" : `接入 ${clientName(appClient)}`} onClose={onClose}>
    <form className="quick-connect-form" onSubmit={submit}>
      <div className="quick-connect-intro"><strong>超级中转站通常只填两项</strong><span>填模型 ID 和 API Key 即可；接其他服务时再把 Base URL 换成对方提供的地址。</span></div>
      <Field label="1. 模型 ID" help="从供应商模型列表完整复制，大小写、日期和后缀必须完全一致。"><input required autoFocus value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="例如供应商控制台显示的模型名称" /></Field>
      <Field label="2. API Key" help="从供应商控制台复制完整 Key。只提交到服务端加密保存，以后不会显示完整内容。"><input required type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value.trim() })} placeholder="sk-... / sk-live-..." /></Field>
      <Field label="供应商" help={preset.hint}><select value={form.providerPreset} onChange={(event) => changePreset(event.target.value)}>{Object.entries(providerPresets).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
      <Field label={form.providerPreset === "super_relay" ? "Base URL（已默认填写）" : "Base URL"} help={usesAnthropic ? "当前按 Anthropic Messages 接入：这里只填到 /v1，系统会自动拼接 /messages。" : "当前按 OpenAI Chat 接入：只填到 /v1，不要填写 /chat/completions。"}><input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value.trim() })} placeholder="https://供应商域名/v1" /></Field>
      <details className="protocol-advanced">
        <summary>接口格式（通常不用改）</summary>
        <Field label="请求协议" help="自动判断会把 claude 开头的模型按 Anthropic Messages 接入，其余按 OpenAI Chat 接入；若供应商使用自定义模型别名，可在这里手动指定。">
          <select value={form.protocolPreference} onChange={(event) => setForm({ ...form, protocolPreference: event.target.value })}>
            <option value="auto">自动判断（推荐）</option>
            <option value="openai_chat">OpenAI Chat 兼容</option>
            <option value="anthropic_messages">Anthropic Messages</option>
          </select>
        </Field>
      </details>
      {form.providerPreset === "custom_auto" && <div className="provider-note"><strong>通用兼容范围</strong><span>支持 OpenAI Chat Completions 兼容接口和 Anthropic Messages 原生接口，不做协议互译。新域名还需要加入数据中心的安全白名单。</span></div>}
      {connectionError && <div className="connection-test-error"><strong>配置已保存，但测试没有通过</strong><span>{connectionError.code ? `${connectionError.code}: ` : ""}{connectionError.message}</span><em>请核对模型名、Key 分组、余额和 Base URL；修改后重新提交即可。</em></div>}
      <button className="primary-button quick-connect-submit" disabled={saving}>{saving ? "正在保存并测试…" : "保存并自动测试"}</button>
      <p className="quick-cost-note">会发送一次很短的真实请求，因此会产生少量上游费用。</p>
    </form>
  </Modal>;
}

function BillingFacts({ externalBilling = {}, account }) {
  const providerType = pick(account, "providerType", "provider_type");
  const data = externalBilling.account || {};
  if (providerType !== "relay") {
    const rechargeUrl = pick(account, "rechargeUrl", "recharge_url");
    return <div className="supplier-managed dm-card"><div><strong>余额由供应商管理</strong><span>该供应商未提供统一的余额读取接口，请在供应商控制台查看余额和账单。</span></div>{rechargeUrl && <a className="primary-button" href={rechargeUrl} target="_blank" rel="noreferrer">打开供应商控制台</a>}</div>;
  }
  const balance = pick(data, "balance", "totalBalance", "total_balance");
  const reserved = pick(data, "reserved", "reservedBalance", "reserved_balance");
  const available = pick(data, "available", "availableBalance", "available_balance");
  return <div className="metric-row billing-metrics provider-power-metrics"><Metric label="可用电力" value={available === undefined ? "暂不可读" : `${fmt.format(num(available))} 电力`} hint="实际可继续使用的额度" /><Metric label="总电力" value={balance === undefined ? "-" : `${fmt.format(num(balance))} 电力`} hint={reserved === undefined ? "中转站实时数据" : `其中预留 ${fmt.format(num(reserved))} 电力`} /><Metric label="计费归属" value="上游中转站" hint="本地钱包不会再扣款" /></div>;
}

function AdvancedAccounts({ title, accounts }) {
  return <details className="advanced-accounts dm-card"><summary>{title}（一般不用操作）</summary><p>重新接入时会自动创建一条独立连接，旧连接保留用于历史审计，不会显示完整 Key。</p><div className="billing-scroll"><table><thead><tr><th>名称</th><th>Base URL</th><th>Key</th><th>格式</th><th>状态</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={accountId(account)}><td>{String(account.name || `API 连接 #${accountId(account)}`).replace(/YYLX/gi, "API 服务")}</td><td className="mono url-cell">{pick(account, "baseUrl", "base_url")}</td><td className="mono">•••• {pick(account, "apiKeyLastFour", "api_key_last_four") || "----"}</td><td>{account.protocol === "anthropic_messages" ? "Anthropic" : "OpenAI"}</td><td>{account.status === "active" ? "启用" : "停用"}</td></tr>) : <tr><td colSpan="5">暂无历史连接</td></tr>}</tbody></table></div></details>;
}

function CallUsage({ rows, page, hasMore, totalPages, loading, source, onPageChange, onExportAll }) {
  const pageLabel = totalPages ? `第 ${page} / ${totalPages} 页` : `第 ${page} 页`;
  return <section className="panel dm-card call-usage-panel">
    <div className="panel-heading">
      <div><h3>调用消耗日志</h3><span className="muted">每页 {usagePageSize} 条；{source === "provider" ? "来自上游账单接口" : "来自数据中心逐次调用审计"}</span></div>
      <div className="actions"><button disabled={loading || !rows.length} onClick={onExportAll}>{loading ? "处理中…" : "导出全部 CSV"}</button></div>
    </div>
    <div className="billing-scroll"><table><thead><tr><th>时间</th><th>任务</th><th>模型</th><th>输入 Token</th><th>输出 Token</th><th>总 Token</th><th>消耗电力</th><th>状态</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => {
      const input = num(pick(row, "inputTokens", "input_tokens", "prompt_tokens"));
      const output = num(pick(row, "outputTokens", "output_tokens", "completion_tokens"));
      const total = num(pick(row, "totalTokens", "total_tokens")) || input + output;
      const charged = pick(row, "providerChargedPower", "provider_charged_power", "cost", "chargedPower", "charged_power", "amount", "used");
      return <tr key={pick(row, "requestId", "request_id", "id") || index}>
        <td>{displayDate(pick(row, "createdAt", "created_at", "occurredAt", "occurred_at", "timestamp", "time"))}</td>
        <td>{pick(row, "action", "taskType", "task_type") || "AI 请求"}</td>
        <td>{pick(row, "model", "providerModel", "provider_model", "modelName", "model_name", "type") || "-"}</td>
        <td>{fmt.format(input)}</td><td>{fmt.format(output)}</td><td>{fmt.format(total)}</td>
        <td>{charged === undefined || charged === null || charged === "" ? "供应商未返回" : `${fmt.format(num(charged))} 电力`}</td>
        <td>{pick(row, "providerStatus", "provider_status", "status", "billingStatus", "billing_status") || "成功"}</td>
      </tr>;
    }) : <tr><td colSpan="8">暂无调用记录</td></tr>}</tbody></table></div>
    <div className="record-pagination"><button disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button><span>{pageLabel}</span><button disabled={loading || !hasMore || (totalPages > 0 && page >= totalPages)} onClick={() => onPageChange(page + 1)}>下一页</button></div>
  </section>;
}

function LegacyPanel({ clients, payload, isSuperAdmin, onReload, onError, onToast }) {
  const [target, setTarget] = useState(null);
  const ledger = (payload?.walletLedger || []).filter((row) => clients.some((client) => clientId(client) === Number(pick(row, "appClientId", "app_client_id"))));
  async function adjust(form) { try { await callAdmin("adminAdjustAppClientBalance", form); onToast({ type: "success", message: "旧钱包余额已调整" }); setTarget(null); await onReload(); } catch (error) { onError(error, "旧钱包调整失败"); } }
  return <><div className="billing-migration-note dm-card"><strong>这里只保留迁移前的旧钱包</strong><span>已经接入中转站的应用不会在这里扣款，也不能在这里充值或调账。</span></div><section className="panel dm-card"><div className="panel-heading"><div><h3>旧钱包账户</h3><span className="muted">{clients.length} 个尚未迁移</span></div></div><div className="billing-scroll"><table><thead><tr><th>AppClient</th><th>本地余额</th>{isSuperAdmin && <th>操作</th>}</tr></thead><tbody>{clients.length ? clients.map((client) => <tr key={clientId(client)}><td>{clientName(client)}</td><td>{fmt.format(num(pick(walletOf(client), "balanceUnits", "balance_units", "balance")))} 电力</td>{isSuperAdmin && <td><button onClick={() => setTarget(client)}>调整旧余额</button></td>}</tr>) : <tr><td colSpan={isSuperAdmin ? "3" : "2"}>没有旧钱包账户</td></tr>}</tbody></table></div></section><LegacyLedger rows={ledger} clients={clients} />{target && <LegacyAdjustModal client={target} onClose={() => setTarget(null)} onSubmit={adjust} />}</>;
}

function LegacyAdjustModal({ client, onClose, onSubmit }) { const [form, setForm] = useState({ mode: "add", entryType: "adjustment", units: "", reason: "", idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }); return <Modal title={`调整旧钱包 · ${clientName(client)}`} onClose={onClose}><form className="billing-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, appClientId: clientId(client), units: num(form.units) }); }}><Field label="方式" help="只影响旧本地钱包。"><select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="add">增加</option><option value="subtract">扣减</option><option value="set">设定余额</option></select></Field><Field label="电力数量" help="请输入非负整数。"><input required min="0" type="number" value={form.units} onChange={(event) => setForm({ ...form, units: event.target.value })} /></Field><Field label="原因" help="用于历史审计。"><textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><button className="primary-button">确认调整</button></form></Modal>; }

function LegacyLedger({ rows, clients }) { return <details className="advanced-accounts dm-card"><summary>查看旧钱包历史流水</summary><div className="billing-scroll"><table><thead><tr><th>时间</th><th>AppClient</th><th>类型</th><th>变动</th><th>余额</th><th>原因</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => { const client = clients.find((item) => clientId(item) === Number(pick(row, "appClientId", "app_client_id"))); return <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at"))}</td><td>{clientName(client || row)}</td><td>{pick(row, "entryType", "entry_type") || "-"}</td><td>{fmt.format(num(pick(row, "unitsDelta", "delta_units", "units")))}</td><td>{fmt.format(num(pick(row, "balanceAfter", "balance_after")))}</td><td>{row.reason || "-"}</td></tr>; }) : <tr><td colSpan="6">暂无旧钱包流水</td></tr>}</tbody></table></div></details>; }

function inferPreset(account) {
  if (!account) return "super_relay";
  const base = pick(account, "baseUrl", "base_url") || "";
  return base.includes("s-api.aiarrival.cn") ? "super_relay" : "custom_auto";
}
function ReadError({ error }) { return <div className="external-read-error dm-card"><strong>暂时读不到中转站余额</strong><span>{typeof error === "string" ? error : `${error.code ? `${error.code}: ` : ""}${error.message || JSON.stringify(error)}`}</span><em>这不会改用旧钱包；请检查 Key、余额和网络后刷新。</em></div>; }
function Metric({ label, value, hint }) { return <div className="metric dm-card"><span>{label}</span><strong>{value}</strong><em>{hint}</em></div>; }
function Info({ label, value, mono }) { return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function Field({ label, help, children }) { return <label className="explained-field"><strong>{label}</strong>{children}<small>{help}</small></label>; }
function Empty({ title, detail }) { return <div className="empty-state"><strong>{title}</strong>{detail && <span>{detail}</span>}</div>; }
function Modal({ title, children, onClose }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card dm-card billing-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" onClick={onClose}>关闭</button></div>{children}</div></div>; }
