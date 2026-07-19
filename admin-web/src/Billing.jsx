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

const providerPresets = {
  daimao: { label: "我的呆猫中转站（推荐）", baseUrl: "https://s-api.aiarrival.cn/v1", hint: "默认选择。Claude 模型自动走 Anthropic，其余模型走 OpenAI；支持读取真实电力余额和用量。" },
  yylx_openai: { label: "YYLX · OpenAI 兼容", baseUrl: "https://app.yylx.io/v1", hint: "适合支持 OpenAI Chat 接口的 YYLX Key。" },
  yylx_anthropic: { label: "YYLX · Anthropic", baseUrl: "https://app.yylx.io/v1", hint: "适合 Claude/Anthropic Key；系统会自动请求 /v1/messages。" },
  custom_openai: { label: "其他 OpenAI 兼容服务", baseUrl: "", hint: "填写供应商给出的 /v1 Base URL，不要填 /chat/completions。" },
  custom_anthropic: { label: "其他 Anthropic 服务", baseUrl: "", hint: "填写 messages 端点之前的 Base URL，系统会自动拼接 /messages。" },
};

function communityName(communities, id) {
  return communities.find((item) => Number(item.id) === Number(id))?.name || `社区 #${id || "-"}`;
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

  async function load() {
    setLoading(true);
    try {
      const [settingsResult, accountsResult] = await Promise.all([
        callAdmin("adminGetPlatformAiSettings", { page: 1, pageSize: 10 }),
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
    {!!usageRows(payload?.externalBilling).length && <ProviderUsage rows={usageRows(payload.externalBilling)} />}
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
  const communityClients = useMemo(() => clients.filter((item) => communityIdOf(item) === communityId), [clients, communityId]);
  const selected = communityClients.find((item) => clientId(item) === selectedId) || communityClients[0];

  async function loadDetail(id) {
    if (!id) return setDetail(null);
    setBusy(true);
    try { setDetail(await callAdmin("adminGetAppClientBilling", { appClientId: id, page: 1, pageSize: 10 })); }
    catch (error) { onError(error, "社区 AI 线路加载失败"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const next = clientId(communityClients[0]);
    setSelectedId(next);
    loadDetail(next);
  }, [communityId, clients.length]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId]);

  const effectiveClient = (detail?.clients || []).find((item) => clientId(item) === clientId(selected)) || selected;
  const settings = settingsOf(effectiveClient);
  const account = detail?.externalBilling?.providerAccount;
  const connected = effectiveClient && isExternalClient(effectiveClient) && account;

  return <>
    <section className="panel dm-card simple-client-picker">
      <div className="panel-heading"><div><h3>选择要接入的应用</h3><span className="muted">每个 AppClient 独立选择模型和 Key</span></div><div className="actions"><select aria-label="选择社区" value={communityId} onChange={(event) => setCommunityId(Number(event.target.value))}>{communities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy || loading} onClick={onReload}>刷新</button></div></div>
      {!communityId ? <Empty title="没有可管理的社区" /> : communityClients.length ? <div className="appclient-route-list">{communityClients.map((client) => <button key={clientId(client)} className={`appclient-route-card ${clientId(client) === clientId(selected) ? "selected" : ""}`} onClick={() => setSelectedId(clientId(client))}><strong>{clientName(client)}</strong><span>{pick(client, "appid", "appId", "app_id") || `#${clientId(client)}`}</span><em>{isExternalClient(client) ? pick(settingsOf(client), "defaultModel", "default_model") || "已接入" : "等待接入"}</em></button>)}</div> : <Empty title="该社区暂无 AppClient" detail={isSuperAdmin ? "请先创建社区 AppClient。" : "请联系超级管理员创建 AppClient。"} />}
    </section>
    {selected && <>
      <ConnectionCard title={clientName(selected)} description={communityName(communities, communityIdOf(selected))} settings={settings} account={account} connected={connected} loading={busy} onConnect={() => setConnect(true)} />
      {connected && <BillingFacts externalBilling={detail?.externalBilling} account={account} />}
      {detail?.externalBilling?.readError && <ReadError error={detail.externalBilling.readError} />}
      {!!usageRows(detail?.externalBilling).length && <ProviderUsage rows={usageRows(detail.externalBilling)} />}
      {connected && <AuditUsage rows={detail?.usageEvents || []} />}
      {!connected && <div className="billing-migration-note dm-card"><strong>还没有接入中转站</strong><span>点击“立即接入”，通常只需填写模型 ID 和 API Key。</span></div>}
      {connect && <QuickConnectModal scope="community" appClient={selected} currentSettings={settings} currentAccount={account} onClose={() => setConnect(false)} onSaved={async () => { await onReload(); await loadDetail(clientId(selected)); }} onError={onError} onToast={onToast} />}
    </>}
  </>;
}

function ConnectionCard({ title, description, settings = {}, account, connected, loading, onConnect, onTest }) {
  const model = pick(settings, "defaultModel", "default_model");
  return <section className={`panel dm-card connection-card ${connected ? "is-connected" : "is-empty"}`}>
    <div className="panel-heading"><div><div className="connection-title"><span className={`connection-dot ${connected ? "online" : ""}`} /><h3>{title}</h3></div><span className="muted">{description}</span></div><div className="actions">{onTest && <button onClick={onTest} disabled={loading}>测试当前连接</button>}<button className="primary-button" onClick={onConnect} disabled={loading}>{connected ? "接入 / 更换线路" : "立即接入"}</button></div></div>
    {connected ? <div className="simple-connection-facts"><Info label="模型 ID" value={model || "-"} mono /><Info label="Base URL" value={pick(account, "baseUrl", "base_url") || "-"} mono /><Info label="API Key" value={`已安全保存 · 末四位 ${pick(account, "apiKeyLastFour", "api_key_last_four") || "----"}`} /><Info label="接口格式" value={account?.protocol === "anthropic_messages" ? "Anthropic Messages" : "OpenAI Chat"} /></div> : <div className="empty-connection"><strong>尚未连接</strong><span>默认使用呆猫中转站地址，你只需要准备模型 ID 和 API Key。</span></div>}
  </section>;
}

function QuickConnectModal({ scope, appClient, currentSettings = {}, currentAccount, onClose, onSaved, onError, onToast }) {
  const inferredPreset = inferPreset(currentAccount);
  const [form, setForm] = useState({ providerPreset: inferredPreset, model: pick(currentSettings, "defaultModel", "default_model") || "", apiKey: "", baseUrl: pick(currentAccount, "baseUrl", "base_url") || providerPresets[inferredPreset].baseUrl });
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const preset = providerPresets[form.providerPreset];
  const usesAnthropic = form.providerPreset.includes("anthropic") || (form.providerPreset === "daimao" && /^claude(?:[-_.]|$)/i.test(form.model));
  function changePreset(value) { setForm((next) => ({ ...next, providerPreset: value, baseUrl: providerPresets[value].baseUrl })); setConnectionError(null); }
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
      <div className="quick-connect-intro"><strong>通常只填下面两项</strong><span>模型 ID 和 API Key。Base URL 已按供应商自动填写。</span></div>
      <Field label="1. 模型 ID" help="从供应商模型列表完整复制，大小写、日期和后缀必须完全一致。"><input required autoFocus value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="例如供应商控制台显示的模型名称" /></Field>
      <Field label="2. API Key" help="从供应商控制台复制完整 Key。只提交到服务端加密保存，以后不会显示完整内容。"><input required type="password" autoComplete="new-password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value.trim() })} placeholder="sk-... / sk-live-..." /></Field>
      <Field label="供应商" help={preset.hint}><select value={form.providerPreset} onChange={(event) => changePreset(event.target.value)}>{Object.entries(providerPresets).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
      <Field label="Base URL（已默认填写）" help={usesAnthropic ? "当前模型按 Anthropic 接入：这里只填到 /v1，系统会自动拼接 /messages。" : "当前模型按 OpenAI 接入：只填到 /v1，不要填写 /chat/completions 或 /responses。"}><input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://供应商域名/v1" /></Field>
      {form.providerPreset.startsWith("yylx") && <div className="provider-note"><strong>YYLX 提醒</strong><span>Key 的分组必须支持所选协议和模型；数据中心还需允许域名 <code>app.yylx.io</code>。</span></div>}
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
  return <details className="advanced-accounts dm-card"><summary>{title}（一般不用操作）</summary><p>重新接入时会自动创建一条独立连接，旧连接保留用于历史审计，不会显示完整 Key。</p><div className="billing-scroll"><table><thead><tr><th>名称</th><th>Base URL</th><th>Key</th><th>格式</th><th>状态</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={accountId(account)}><td>{account.name}</td><td className="mono url-cell">{pick(account, "baseUrl", "base_url")}</td><td className="mono">•••• {pick(account, "apiKeyLastFour", "api_key_last_four") || "----"}</td><td>{account.protocol === "anthropic_messages" ? "Anthropic" : "OpenAI"}</td><td>{account.status === "active" ? "启用" : "停用"}</td></tr>) : <tr><td colSpan="5">暂无历史连接</td></tr>}</tbody></table></div></details>;
}

function ProviderUsage({ rows }) { return <section className="panel dm-card"><div className="panel-heading"><div><h3>中转站用量</h3><span className="muted">供应商返回的最近 {rows.length} 条记录</span></div></div><div className="billing-scroll"><table><thead><tr><th>时间</th><th>模型</th><th>输入 Token</th><th>输出 Token</th><th>上游实扣</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at", "timestamp", "time"))}</td><td>{pick(row, "model", "modelName", "model_name", "type") || "-"}</td><td>{fmt.format(num(pick(row, "inputTokens", "input_tokens", "prompt_tokens")))}</td><td>{fmt.format(num(pick(row, "outputTokens", "output_tokens", "completion_tokens")))}</td><td>{fmt.format(num(pick(row, "cost", "chargedPower", "charged_power", "amount", "used")))}</td></tr>)}</tbody></table></div></section>; }

function AuditUsage({ rows }) { return <details className="advanced-accounts dm-card"><summary>查看数据中心审计记录（不作为余额依据）</summary><div className="billing-scroll"><table><thead><tr><th>时间</th><th>任务</th><th>模型</th><th>Token</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at"))}</td><td>{pick(row, "action", "taskType", "task_type") || "AI 请求"}</td><td>{row.model || "-"}</td><td>{fmt.format(num(pick(row, "totalTokens", "total_tokens")))}</td></tr>) : <tr><td colSpan="4">暂无审计记录</td></tr>}</tbody></table></div></details>; }

function LegacyPanel({ clients, payload, isSuperAdmin, onReload, onError, onToast }) {
  const [target, setTarget] = useState(null);
  const ledger = (payload?.walletLedger || []).filter((row) => clients.some((client) => clientId(client) === Number(pick(row, "appClientId", "app_client_id"))));
  async function adjust(form) { try { await callAdmin("adminAdjustAppClientBalance", form); onToast({ type: "success", message: "旧钱包余额已调整" }); setTarget(null); await onReload(); } catch (error) { onError(error, "旧钱包调整失败"); } }
  return <><div className="billing-migration-note dm-card"><strong>这里只保留迁移前的旧钱包</strong><span>已经接入中转站的应用不会在这里扣款，也不能在这里充值或调账。</span></div><section className="panel dm-card"><div className="panel-heading"><div><h3>旧钱包账户</h3><span className="muted">{clients.length} 个尚未迁移</span></div></div><div className="billing-scroll"><table><thead><tr><th>AppClient</th><th>本地余额</th>{isSuperAdmin && <th>操作</th>}</tr></thead><tbody>{clients.length ? clients.map((client) => <tr key={clientId(client)}><td>{clientName(client)}</td><td>{fmt.format(num(pick(walletOf(client), "balanceUnits", "balance_units", "balance")))} 电力</td>{isSuperAdmin && <td><button onClick={() => setTarget(client)}>调整旧余额</button></td>}</tr>) : <tr><td colSpan={isSuperAdmin ? "3" : "2"}>没有旧钱包账户</td></tr>}</tbody></table></div></section><LegacyLedger rows={ledger} clients={clients} />{target && <LegacyAdjustModal client={target} onClose={() => setTarget(null)} onSubmit={adjust} />}</>;
}

function LegacyAdjustModal({ client, onClose, onSubmit }) { const [form, setForm] = useState({ mode: "add", entryType: "adjustment", units: "", reason: "", idempotencyKey: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }); return <Modal title={`调整旧钱包 · ${clientName(client)}`} onClose={onClose}><form className="billing-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, appClientId: clientId(client), units: num(form.units) }); }}><Field label="方式" help="只影响旧本地钱包。"><select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}><option value="add">增加</option><option value="subtract">扣减</option><option value="set">设定余额</option></select></Field><Field label="电力数量" help="请输入非负整数。"><input required min="0" type="number" value={form.units} onChange={(event) => setForm({ ...form, units: event.target.value })} /></Field><Field label="原因" help="用于历史审计。"><textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field><button className="primary-button">确认调整</button></form></Modal>; }

function LegacyLedger({ rows, clients }) { return <details className="advanced-accounts dm-card"><summary>查看旧钱包历史流水</summary><div className="billing-scroll"><table><thead><tr><th>时间</th><th>AppClient</th><th>类型</th><th>变动</th><th>余额</th><th>原因</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => { const client = clients.find((item) => clientId(item) === Number(pick(row, "appClientId", "app_client_id"))); return <tr key={row.id || index}><td>{displayDate(pick(row, "createdAt", "created_at"))}</td><td>{clientName(client || row)}</td><td>{pick(row, "entryType", "entry_type") || "-"}</td><td>{fmt.format(num(pick(row, "unitsDelta", "delta_units", "units")))}</td><td>{fmt.format(num(pick(row, "balanceAfter", "balance_after")))}</td><td>{row.reason || "-"}</td></tr>; }) : <tr><td colSpan="6">暂无旧钱包流水</td></tr>}</tbody></table></div></details>; }

function inferPreset(account) { if (!account) return "daimao"; const base = pick(account, "baseUrl", "base_url") || ""; if (base.includes("app.yylx.io")) return account?.protocol === "anthropic_messages" ? "yylx_anthropic" : "yylx_openai"; if (base.includes("s-api.aiarrival.cn")) return "daimao"; return account?.protocol === "anthropic_messages" ? "custom_anthropic" : "custom_openai"; }
function ReadError({ error }) { return <div className="external-read-error dm-card"><strong>暂时读不到中转站余额</strong><span>{typeof error === "string" ? error : `${error.code ? `${error.code}: ` : ""}${error.message || JSON.stringify(error)}`}</span><em>这不会改用旧钱包；请检查 Key、余额和网络后刷新。</em></div>; }
function Metric({ label, value, hint }) { return <div className="metric dm-card"><span>{label}</span><strong>{value}</strong><em>{hint}</em></div>; }
function Info({ label, value, mono }) { return <div><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function Field({ label, help, children }) { return <label className="explained-field"><strong>{label}</strong>{children}<small>{help}</small></label>; }
function Empty({ title, detail }) { return <div className="empty-state"><strong>{title}</strong>{detail && <span>{detail}</span>}</div>; }
function Modal({ title, children, onClose }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card dm-card billing-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" onClick={onClose}>关闭</button></div>{children}</div></div>; }
