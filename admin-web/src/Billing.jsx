import React, { useEffect, useMemo, useState } from "react";
import { callAdmin } from "./api";

const fmt = new Intl.NumberFormat("zh-CN");
const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
const dateOnly = (date) => date.toISOString().slice(0, 10);
const initialDates = () => {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { start: dateOnly(start), end: dateOnly(end) };
};
const number = (value) => Number(value || 0);
const DETAIL_PAGE_SIZE = 15;
const pick = (item, ...keys) => keys.find((key) => item?.[key] !== undefined) ? item[keys.find((key) => item?.[key] !== undefined)] : undefined;
const uid = () => globalThis.crypto?.randomUUID?.() || `billing-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function clientId(client) { return pick(client, "id", "appClientId", "app_client_id"); }
function walletOf(client) { return client.wallet || client.appClientWallet || {}; }
function settingsOf(client) { return client.billingSettings || client.billing_settings || client.settings || {}; }
function balanceOf(client) { return number(pick(walletOf(client), "balanceUnits", "balance_units", "balance") ?? pick(client, "balanceUnits", "balance_units", "balance")); }
function thresholdOf(client) { return number(pick(settingsOf(client), "lowBalanceThreshold", "low_balance_threshold") ?? pick(client, "lowBalanceThreshold", "low_balance_threshold")); }
function walletStatus(client) { return pick(walletOf(client), "status", "walletStatus", "wallet_status") || pick(client, "walletStatus", "wallet_status") || "active"; }
function clientName(client) { return pick(client, "name", "clientName", "client_name") || `客户端 #${clientId(client)}`; }
function appidOf(client) { return pick(client, "appid", "appId", "app_id") || "-"; }
function communityOf(client) { return pick(client, "communityName", "community_name") || client.community?.name || (pick(client, "communityId", "community_id") ? `社区 #${pick(client, "communityId", "community_id")}` : "未绑定社区"); }
function clientSubtitle(client) { const company = pick(client, "companyName", "company_name"); return [company, communityOf(client)].filter(Boolean).join(" · "); }
function statusTone(status) { return status === "active" ? "green" : status === "frozen" ? "yellow" : "red"; }

export default function BillingPage({ onError, onToast }) {
  const [dates, setDates] = useState(initialDates);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [usagePage, setUsagePage] = useState(1);
  const [ledgerPage, setLedgerPage] = useState(1);

  async function load(nextPage = page, nextId = selectedId) {
    setLoading(true);
    try {
      const request = {
        ...(nextId ? { appClientId: Number(nextId) } : {}),
        startAt: `${dates.start} 00:00:00`,
        endAt: `${dates.end} 23:59:59`,
        page: 1,
        pageSize: 100,
      };
      const first = await callAdmin("adminGetAppClientBilling", request);
      const totalPages = Math.min(200, number(pick(first.pagination || {}, "totalPages", "total_pages")) || 1);
      const batches = [first];
      for (let current = 2; current <= totalPages; current += 1) {
        batches.push(await callAdmin("adminGetAppClientBilling", { ...request, page: current }));
      }
      setResult({
        ...first,
        usageEvents: batches.flatMap((item) => item.usageEvents || []),
        walletLedger: batches.flatMap((item) => item.walletLedger || []),
        rechargeOrders: batches.flatMap((item) => item.rechargeOrders || []),
      });
      setUsagePage(1);
      setLedgerPage(1);
    } catch (err) { onError(err, "计费数据加载失败"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(1); }, []);
  const clients = result?.clients || [];
  const summary = result?.usageSummary || {};
  const platform = result?.platformBillingSettings || {};
  const selected = clients.find((item) => String(clientId(item)) === String(selectedId));
  const usageEvents = result?.usageEvents || [];
  const walletLedger = result?.walletLedger || [];
  const totals = useMemo(() => ({
    balance: clients.reduce((sum, item) => sum + balanceOf(item), 0),
    low: clients.filter((item) => thresholdOf(item) > 0 && balanceOf(item) <= thresholdOf(item)).length,
    frozen: clients.filter((item) => walletStatus(item) !== "active").length,
  }), [clients]);

  async function mutate(action, payload, message) {
    setLoading(true);
    try {
      const response = await callAdmin(action, payload);
      setModal(null);
      await load(1);
      onToast({ type: "success", message });
      return response;
    } catch (err) { onError(err, message); return null; }
    finally { setLoading(false); }
  }

  async function rotateToken(client) {
    if (!confirm(`轮换 ${clientName(client)} 的只读令牌？旧令牌会立即失效。`)) return;
    setLoading(true);
    try {
      const response = await callAdmin("adminRotateAppClientBillingReadToken", { appClientId: clientId(client) });
      setModal({ type: "token", client, token: response.billingAccessToken || "" });
    } catch (err) { onError(err, "只读令牌轮换失败"); }
    finally { setLoading(false); }
  }

  function exportRows(type) {
    const rows = type === "usage" ? usageEvents : walletLedger;
    const headers = type === "usage"
      ? ["时间", "客户端", "AppID", "功能", "任务类型", "Token", "基准电力", "计费倍率", "定价标签", "实扣电力"]
      : ["时间", "客户端", "AppID", "账本类型", "变动前", "变动电力", "变动后", "原因", "凭证号", "幂等键"];
    const values = rows.map((row) => type === "usage" ? [
      pick(row, "createdAt", "created_at"), pick(row, "clientName", "client_name"), pick(row, "appid", "appId", "app_id"),
      pick(row, "action"), pick(row, "taskType", "task_type"), pick(row, "totalTokens", "total_tokens"),
      pick(row, "baseUnits", "base_units"), pick(row, "customerBillingFactor", "customer_billing_factor", "billingFactor", "billing_factor"),
      pick(row.pricingDisplay || {}, "label", "pricingLabel") || pick(row, "pricingLabel", "pricing_label"), pick(row, "chargedUnits", "charged_units"),
    ] : [
      pick(row, "createdAt", "created_at"), pick(row, "clientName", "client_name"), pick(row, "appid", "appId", "app_id"),
      ledgerLabel(pick(row, "entryType", "entry_type")), pick(row, "balanceBefore", "balance_before"), pick(row, "unitsDelta", "units_delta", "units"),
      pick(row, "balanceAfter", "balance_after"), pick(row, "reason"), pick(row, "receiptReference", "receipt_reference"), pick(row, "idempotencyKey", "idempotency_key"),
    ]);
    const csv = `\ufeff${[headers, ...values].map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `AI计费-${type === "usage" ? "用量明细" : "电力账本"}-${dates.start}-${dates.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onToast({ type: "success", message: `已导出 ${rows.length} 条${type === "usage" ? "用量" : "账本"}记录` });
  }

  return <section className="content-grid billing-page">
    <div className="billing-toolbar dm-card">
      <div><p className="eyebrow">AI POWER CENTER</p><h3>电力总览与账单</h3></div>
      <div className="billing-filters">
        <input type="date" value={dates.start} onChange={(e) => setDates({ ...dates, start: e.target.value })} />
        <span>至</span>
        <input type="date" value={dates.end} onChange={(e) => setDates({ ...dates, end: e.target.value })} />
        <button onClick={() => { setPage(1); load(1); }} disabled={loading}>查询</button>
        <button className="primary-button" onClick={() => setModal({ type: "client" })}>新建客户端</button>
        <button onClick={() => setModal({ type: "platform", platform })}>平台计费设置</button>
      </div>
    </div>

    <div className="metric-row billing-metrics">
      <Metric label="当前总余额" value={`${fmt.format(totals.balance)} 电力`} hint={`${clients.length} 个客户端`} />
      <Metric label="实际扣除" value={fmt.format(number(pick(summary, "chargedUnits", "charged_units")))} hint={`基准 ${fmt.format(number(pick(summary, "baseUnits", "base_units")))}`} />
      <Metric label="AI 用量" value={`${fmt.format(number(pick(summary, "totalTokens", "total_tokens")))} tokens`} hint={`${fmt.format(number(pick(summary, "requestCount", "request_count")))} 次请求`} />
      <Metric label="账户预警" value={totals.low + totals.frozen} hint={`${totals.low} 个低余额 · ${totals.frozen} 个受限`} />
    </div>

    <section className="panel dm-card">
      <div className="panel-heading"><h3>App Client</h3><span className="muted">充值比例：1 元 = {fmt.format(number(pick(platform, "powerPerCny", "power_per_cny") || 1000))} 电力</span></div>
      <table className="billing-clients"><thead><tr><th>社区 / 客户端</th><th>AppID</th><th>状态</th><th>余额</th><th>预警线</th><th>计费方式</th><th>操作</th></tr></thead>
        <tbody>{clients.length ? clients.map((client) => {
          const id = clientId(client); const settings = settingsOf(client); const status = walletStatus(client);
          return <tr key={id} className={String(id) === String(selectedId) ? "selected-row" : ""} onClick={() => setSelectedId(String(id))}>
            <td><div className="title-stack"><strong>{clientName(client)}</strong><span>{clientSubtitle(client)}</span></div></td>
            <td className="mono">{appidOf(client)}</td>
            <td><span className={`badge badge-${statusTone(status)}`}>{status === "active" ? "正常" : status === "frozen" ? "已冻结" : "已停用"}</span></td>
            <td><strong>{fmt.format(balanceOf(client))}</strong>{thresholdOf(client) > 0 && balanceOf(client) <= thresholdOf(client) && <span className="billing-warning">低余额</span>}</td>
            <td>{fmt.format(thresholdOf(client))}</td>
            <td>{pick(settings, "chargingMode", "charging_mode") === "free" ? "免费" : "预付费"}</td>
            <td><div className="actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setModal({ type: "adjust", client, mode: "add" })}>增加</button>
              <button onClick={() => setModal({ type: "adjust", client, mode: "subtract" })}>扣减</button>
              <button onClick={() => setModal({ type: "settings", client })}>设置</button>
              <button onClick={() => setModal({ type: "client", client })}>编辑资料</button>
              <button onClick={() => setModal({ type: "wallet", client })}>{status === "active" ? "冻结" : "恢复"}</button>
              <button onClick={() => rotateToken(client)}>只读令牌</button>
            </div></td>
          </tr>;
        }) : <tr><td colSpan="7"><div className="empty-state"><strong>暂无 App Client</strong><span>新建客户端后会自动创建钱包和计费设置。</span></div></td></tr>}</tbody>
      </table>
    </section>

    <div className="billing-detail-grid">
      <BillingTable title="AI 用量明细" rows={usageEvents} type="usage" page={usagePage} onPage={setUsagePage} onExport={() => exportRows("usage")} />
      <BillingTable title="电力账本" rows={walletLedger} type="ledger" page={ledgerPage} onPage={setLedgerPage} onExport={() => exportRows("ledger")} />
    </div>
    {modal && <BillingModal state={modal} platform={platform} loading={loading} onClose={() => setModal(null)} onSubmit={mutate} />}
  </section>;
}

function Metric({ label, value, hint }) { return <div className="metric dm-card"><span>{label}</span><strong>{value}</strong><em>{hint}</em></div>; }

function BillingTable({ title, rows, type, page, onPage, onExport }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / DETAIL_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice((safePage - 1) * DETAIL_PAGE_SIZE, safePage * DETAIL_PAGE_SIZE);
  return <section className="panel dm-card billing-record-panel"><div className="panel-heading"><div><h3>{title}</h3><span className="muted">共 {fmt.format(rows.length)} 条</span></div><button type="button" onClick={onExport} disabled={!rows.length}>导出 CSV</button></div><div className="billing-scroll"><table><thead><tr>{type === "usage" ? <><th>时间 / 功能</th><th>Token</th><th>基准</th><th>定价</th><th>实扣</th></> : <><th>时间 / 类型</th><th>变动前</th><th>变动</th><th>变动后</th><th>原因</th></>}</tr></thead><tbody>
    {visibleRows.length ? visibleRows.map((row, index) => type === "usage" ? <tr key={row.id || index}><td><div className="title-stack"><strong>{pick(row, "action", "taskType", "task_type") || "AI 请求"}</strong><span>{pick(row, "createdAt", "created_at") || "-"}</span></div></td><td>{fmt.format(number(pick(row, "totalTokens", "total_tokens")))}</td><td>{fmt.format(number(pick(row, "baseUnits", "base_units")))}</td><td>{pick(row.pricingDisplay || {}, "label", "pricingLabel") || pick(row, "pricingLabel", "pricing_label") || "-"} ×{pick(row, "customerBillingFactor", "customer_billing_factor", "billingFactor", "billing_factor") || 1}</td><td><strong>{fmt.format(number(pick(row, "chargedUnits", "charged_units")))}</strong></td></tr>
      : <tr key={row.id || index}><td><div className="title-stack"><strong>{ledgerLabel(pick(row, "entryType", "entry_type"))}</strong><span>{pick(row, "createdAt", "created_at") || "-"}</span></div></td><td>{fmt.format(number(pick(row, "balanceBefore", "balance_before")))}</td><td className={number(pick(row, "unitsDelta", "units_delta", "units")) >= 0 ? "positive" : "negative"}>{number(pick(row, "unitsDelta", "units_delta", "units")) > 0 ? "+" : ""}{fmt.format(number(pick(row, "unitsDelta", "units_delta", "units")))}</td><td>{fmt.format(number(pick(row, "balanceAfter", "balance_after")))}</td><td>{pick(row, "reason", "receiptReference", "receipt_reference") || "-"}</td></tr>) : <tr><td colSpan="5"><div className="empty-state"><strong>暂无记录</strong></div></td></tr>}
  </tbody></table></div><div className="record-pagination"><button disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>上一页</button><span>第 {safePage} / {totalPages} 页 · 每页 {DETAIL_PAGE_SIZE} 条</span><button disabled={safePage >= totalPages} onClick={() => onPage(safePage + 1)}>下一页</button></div></section>;
}
function ledgerLabel(type) { return ({ recharge: "充值", grant: "赠送", refund: "退款", adjustment: "调整", hold: "预占", release: "释放", settlement: "结算" })[type] || type || "-"; }
function csvCell(value) { const text = value === undefined || value === null ? "" : String(value); return `"${text.replaceAll('"', '""')}"`; }

function BillingModal({ state, platform, loading, onClose, onSubmit }) {
  const client = state.client || {}; const id = clientId(client);
  const [form, setForm] = useState(() => {
    if (state.type === "adjust") return { mode: state.mode, entryType: state.mode === "add" ? "recharge" : "adjustment", units: "", amountYuan: "", reason: "", receiptReference: "", idempotencyKey: uid() };
    if (state.type === "settings") { const s = settingsOf(client); return { billingEnabled: pick(s, "billingEnabled", "billing_enabled") !== false, chargingMode: pick(s, "chargingMode", "charging_mode") || "prepaid", reserveUnits: pick(s, "reserveUnits", "reserve_units") ?? 1000, lowBalanceThreshold: pick(s, "lowBalanceThreshold", "low_balance_threshold") ?? 10000, customerBillingFactor: pick(s, "customerBillingFactor", "customer_billing_factor") ?? "", note: pick(s, "note") || "" }; }
    if (state.type === "platform") return { powerPerCny: pick(platform, "powerPerCny", "power_per_cny") ?? 1000, usdCnyRate: pick(platform, "usdCnyRate", "usd_cny_rate") ?? 7.2, officialInputUsdPerMillion: pick(platform, "officialInputUsdPerMillion", "official_input_usd_per_million") ?? 5, officialOutputUsdPerMillion: pick(platform, "officialOutputUsdPerMillion", "official_output_usd_per_million") ?? 25, customerBillingFactor: pick(platform, "customerBillingFactor", "customer_billing_factor") ?? 0.8, pricingLabel: pick(platform, "pricingLabel", "pricing_label") || "优惠期", note: pick(platform, "note") || "" };
    if (state.type === "client") return { appid: appidOf(client) === "-" ? "" : appidOf(client), name: pick(client, "name", "clientName", "client_name") || "", companyName: pick(client, "companyName", "company_name") || "", communityId: pick(client, "communityId", "community_id") || "", clientType: pick(client, "clientType", "client_type") || "wechat_miniprogram", status: pick(client, "status") || "active", allowedActions: (pick(client, "allowedActions", "allowed_actions") || ["runAiTask", "startSecretaryChat"]).join?.(" ") || "" };
    return { status: walletStatus(client) === "active" ? "frozen" : "active", reason: "" };
  });
  const set = (key, value) => setForm((next) => ({ ...next, [key]: value }));
  function submit(e) {
    e.preventDefault();
    if (state.type === "adjust") { const recharge = form.mode === "add" && form.entryType === "recharge"; return onSubmit("adminAdjustAppClientBalance", { appClientId: id, mode: form.mode, entryType: form.entryType, reason: form.reason, receiptReference: form.receiptReference || undefined, ...(recharge ? { amountCents: Math.round(number(form.amountYuan) * 100), currency: "CNY" } : { units: number(form.units) }), idempotencyKey: form.idempotencyKey }, "余额调整成功"); }
    if (state.type === "settings") return onSubmit("adminUpdateAppClientBillingSettings", { appClientId: id, settings: { ...form, reserveUnits: number(form.reserveUnits), lowBalanceThreshold: number(form.lowBalanceThreshold), customerBillingFactor: form.customerBillingFactor === "" ? null : number(form.customerBillingFactor) } }, "客户端计费设置已保存");
    if (state.type === "platform") { if (!confirm("平台计费设置会影响所有后续充值和 AI 请求，确认保存吗？")) return; return onSubmit("adminUpdatePlatformBillingSettings", { settings: Object.fromEntries(Object.entries(form).map(([k,v]) => [k, ["pricingLabel","note"].includes(k) ? v : number(v)])) }, "平台计费设置已保存"); }
    if (state.type === "client") { const clientPatch = { ...form, communityId: form.communityId ? number(form.communityId) : null, allowedActions: form.allowedActions.split(/[\s,，]+/).filter(Boolean) }; if (id) delete clientPatch.appid; return onSubmit("adminUpsertAppClient", { ...(id ? { appClientId: id } : {}), client: clientPatch }, id ? "客户端资料已保存" : "App Client 已创建"); }
    return onSubmit("adminSetAppClientWalletStatus", { appClientId: id, status: form.status, reason: form.reason }, form.status === "active" ? "钱包已恢复" : "钱包已冻结");
  }
  const title = state.type === "adjust" ? `${form.mode === "add" ? "增加" : "扣减"}电力 · ${clientName(client)}` : state.type === "settings" ? `计费设置 · ${clientName(client)}` : state.type === "platform" ? "平台统一计费设置" : state.type === "client" ? (id ? `编辑客户端资料 · ${clientName(client)}` : "新建 App Client") : state.type === "token" ? `计费只读令牌 · ${clientName(client)}` : `钱包状态 · ${clientName(client)}`;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal-card dm-card billing-modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button type="button" onClick={onClose}>关闭</button></div><form className="billing-form" onSubmit={submit}>
    {state.type === "token" && <div className="billing-token"><p>令牌只显示这一次。请保存到对应社区后台的服务器环境变量中，不要放入浏览器或小程序。</p><textarea readOnly value={state.token || "服务端未返回令牌"} /><button type="button" onClick={() => navigator.clipboard?.writeText(state.token || "")}>复制令牌</button></div>}
    {state.type === "adjust" && <><label>方式<select value={form.mode} onChange={(e) => set("mode", e.target.value)}><option value="add">增加</option><option value="subtract">扣减</option><option value="set">设定余额</option></select></label><label>账本类型<select value={form.entryType} onChange={(e) => set("entryType", e.target.value)}><option value="recharge">已收款充值</option><option value="grant">赠送</option><option value="refund">退款/补偿</option><option value="adjustment">人工调整</option></select></label>{form.mode === "add" && form.entryType === "recharge" ? <label>实收人民币（元）<input type="number" min="0.01" step="0.01" required value={form.amountYuan} onChange={(e) => set("amountYuan", e.target.value)} /><small>预计到账 {fmt.format(number(form.amountYuan) * number(pick(platform,"powerPerCny","power_per_cny") || 1000))} 电力</small></label> : <label>电力数量<input type="number" min="0" required value={form.units} onChange={(e) => set("units", e.target.value)} /></label>}<label>原因<textarea required value={form.reason} onChange={(e) => set("reason", e.target.value)} /></label>{form.entryType === "recharge" && <label>收款凭证号<input value={form.receiptReference} onChange={(e) => set("receiptReference", e.target.value)} /></label>}</>}
    {state.type === "settings" && <><label className="check-row"><input type="checkbox" checked={form.billingEnabled} onChange={(e) => set("billingEnabled", e.target.checked)} />启用 AI 供应</label><label>计费方式<select value={form.chargingMode} onChange={(e) => set("chargingMode",e.target.value)}><option value="prepaid">预付费</option><option value="free">免费（仍记录用量）</option></select></label><label>单次预占电力<input type="number" value={form.reserveUnits} onChange={(e) => set("reserveUnits",e.target.value)} /></label><label>低余额预警线<input type="number" value={form.lowBalanceThreshold} onChange={(e) => set("lowBalanceThreshold",e.target.value)} /></label><label>独立倍率（留空跟随平台）<input type="number" step="0.01" value={form.customerBillingFactor} onChange={(e) => set("customerBillingFactor",e.target.value)} /></label><label>备注<textarea value={form.note} onChange={(e) => set("note",e.target.value)} /></label></>}
    {state.type === "platform" && <>{[["powerPerCny","每元兑换电力"],["usdCnyRate","美元兑人民币"],["officialInputUsdPerMillion","官方输入价 / 百万 token（美元）"],["officialOutputUsdPerMillion","官方输出价 / 百万 token（美元）"],["customerBillingFactor","平台计费倍率"]].map(([key,label]) => <label key={key}>{label}<input type="number" step="0.01" value={form[key]} onChange={(e) => set(key,e.target.value)} /></label>)}<label>定价标签<input value={form.pricingLabel} onChange={(e) => set("pricingLabel",e.target.value)} /></label><label>备注<textarea value={form.note} onChange={(e) => set("note",e.target.value)} /></label></>}
    {state.type === "client" && <>{[["appid","AppID"],["name","后台显示名称 / 备注名"],["companyName","公司或主体名称"],["communityId","绑定社区 ID"]].map(([key,label]) => <label key={key}>{label}<input disabled={key === "appid" && !!id} required={key === "appid" || key === "name"} value={form[key]} onChange={(e) => set(key,e.target.value)} /></label>)}<label>客户端类型<select value={form.clientType} onChange={(e) => set("clientType",e.target.value)}><option value="wechat_miniprogram">微信小程序</option><option value="web">Web</option><option value="server">服务端</option></select></label><label>状态<select value={form.status} onChange={(e) => set("status",e.target.value)}><option value="active">启用</option><option value="disabled">停用</option></select></label><label>允许的 actions<textarea value={form.allowedActions} onChange={(e) => set("allowedActions",e.target.value)} /></label></>}
    {state.type === "wallet" && <><label>目标状态<select value={form.status} onChange={(e) => set("status",e.target.value)}><option value="active">正常</option><option value="frozen">冻结</option><option value="disabled">停用</option></select></label><label>原因<textarea required value={form.reason} onChange={(e) => set("reason",e.target.value)} /></label></>}
    {state.type !== "token" && <button className="primary-button" disabled={loading} type="submit">{loading ? "提交中..." : "确认提交"}</button>}
  </form></div></div>;
}
