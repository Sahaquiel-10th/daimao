import React, { useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { callAdmin } from "./api";

const fulfillmentLabels = {
  pending: "待制作",
  preparing: "制作中",
  shipped: "已发货",
  delivered: "已完成",
  cancelled: "已取消",
  exception: "异常",
};

const leadStatusLabels = {
  new: "新线索",
  contacting: "联系中",
  qualified: "需求明确",
  quoted: "已报价",
  won: "已成交",
  lost: "未成交",
  invalid: "无效",
};

const customizationLabels = {
  logo_keychain: "Logo 名片挂件",
  mini_program: "整套小程序",
  both: "名片挂件 + 小程序",
};

const entrySourceLabels = {
  nfc_card: "碰一碰名片",
  shared_card: "分享名片",
  my_card: "我的名片",
  me: "我的页面",
  bind_success: "绑定成功",
  quantity_50: "50 个定制提示",
  other: "其他",
};

function formatDate(value) {
  if (!value) return "-";
  const raw = String(value).trim();
  const sqlMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  const date = new Date(sqlMatch
    ? `${sqlMatch[1]}-${sqlMatch[2]}-${sqlMatch[3]}T${sqlMatch[4]}:${sqlMatch[5]}:${sqlMatch[6]}+08:00`
    : value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatCents(value) {
  return `¥${(Number(value || 0) / 100).toFixed(2)}`;
}

function orderItemsLabel(order) {
  return (order.items || []).map((item) => `${item.name || item.zodiac}×${item.quantity}`).join("、") || "-";
}

function orderAddressLabel(order) {
  return [order.province, order.city, order.district, order.detail_address].filter(Boolean).join(" ");
}

function escapeCsv(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, columns, rows) {
  const content = [
    columns.map((column) => escapeCsv(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsv(column.value(row))).join(",")),
  ].join("\n");
  const blob = new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Badge({ tone = "default", children }) {
  return <span className={`commerce-badge ${tone}`}>{children}</span>;
}

function Field({ label, children }) {
  return <label className="commerce-field"><span>{label}</span>{children}</label>;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="commerce-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="commerce-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header><h3>{title}</h3><button type="button" className="commerce-close" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        {children}
      </section>
    </div>
  );
}

function Empty({ title, children }) {
  return <div className="commerce-empty"><strong>{title}</strong><span>{children}</span></div>;
}

function Toolbar({ query, setQuery, status, setStatus, options, onDownload }) {
  return (
    <div className="commerce-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订单号、姓名、电话或公司" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}>
        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" onClick={onDownload}><Download size={15} />导出 CSV</button>
    </div>
  );
}

export function StickerOrdersPage({ orders = [], onChanged, notify }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter((order) => {
      if (status === "active" && ["delivered", "cancelled"].includes(order.fulfillment_status)) return false;
      if (!["all", "active"].includes(status) && order.fulfillment_status !== status) return false;
      if (!keyword) return true;
      return [
        order.order_no,
        order.recipient_name,
        order.recipient_phone,
        orderAddressLabel(order),
        order.shipping_carrier,
        order.tracking_no,
        orderItemsLabel(order),
      ].some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [orders, query, status]);

  function open(order) {
    setDraft({
      ...order,
      fulfillmentStatus: order.fulfillment_status,
      paymentStatus: order.payment_status,
      shippingCarrier: order.shipping_carrier || "",
      trackingNo: order.tracking_no || "",
      internalNote: order.internal_note || "",
    });
  }

  async function save() {
    setSaving(true);
    try {
      await callAdmin("adminUpdateStickerOrder", {
        orderId: draft.id,
        patch: {
          fulfillmentStatus: draft.fulfillmentStatus,
          paymentStatus: draft.paymentStatus,
          shippingCarrier: draft.shippingCarrier,
          trackingNo: draft.trackingNo,
          internalNote: draft.internalNote,
        },
      });
      setDraft(null);
      await onChanged();
      notify?.({ type: "success", message: "订单状态已保存" });
    } catch (error) {
      notify?.({ type: "error", message: error.message || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="content-grid">
      <section className="panel dm-card">
        <div className="commerce-heading">
          <div><h3>呆猫碰碰订单</h3><p>只有微信支付成功的订单会进入这里；待付款记录不会进入发货队列。</p></div>
          <div className="commerce-count"><strong>{filtered.length}</strong><span>笔订单</span></div>
        </div>
        <Toolbar
          query={query}
          setQuery={setQuery}
          status={status}
          setStatus={setStatus}
          options={[
            ["active", "待履约"],
            ["pending", "待制作"],
            ["preparing", "制作中"],
            ["shipped", "已发货"],
            ["exception", "异常"],
            ["delivered", "已完成"],
            ["cancelled", "已取消"],
            ["all", "全部已付款"],
          ]}
          onDownload={() => downloadCsv(`呆猫碰碰已付款订单-${new Date().toISOString().slice(0, 10)}.csv`, [
            { label: "订单号", value: (item) => item.order_no },
            { label: "付款时间", value: (item) => formatDate(item.paid_at) },
            { label: "生肖明细", value: orderItemsLabel },
            { label: "数量", value: (item) => item.item_count },
            { label: "实付金额", value: (item) => formatCents(item.pay_amount_cents) },
            { label: "收货人", value: (item) => item.recipient_name },
            { label: "手机号", value: (item) => item.recipient_phone },
            { label: "收货地址", value: orderAddressLabel },
            { label: "买家备注", value: (item) => item.buyer_note },
            { label: "履约状态", value: (item) => fulfillmentLabels[item.fulfillment_status] || item.fulfillment_status },
            { label: "物流公司", value: (item) => item.shipping_carrier },
            { label: "物流单号", value: (item) => item.tracking_no },
            { label: "来源", value: (item) => entrySourceLabels[item.entry_source] || item.entry_source },
            { label: "内部备注", value: (item) => item.internal_note },
          ], filtered)}
        />
        <div className="commerce-table-wrap">
          {filtered.length ? <table>
            <thead><tr><th>订单</th><th>生肖 / 数量</th><th>实付</th><th>收货信息</th><th>履约</th><th>物流</th><th>来源</th><th>操作</th></tr></thead>
            <tbody>{filtered.map((order) => <tr key={order.id}>
              <td><div className="commerce-stack"><strong>{order.order_no}</strong><span>{formatDate(order.paid_at)}</span></div></td>
              <td><div className="commerce-stack"><strong>{orderItemsLabel(order)}</strong><span>共 {order.item_count} 个</span></div></td>
              <td><strong>{formatCents(order.pay_amount_cents)}</strong></td>
              <td><div className="commerce-stack"><strong>{order.recipient_name} · {order.recipient_phone}</strong><span>{orderAddressLabel(order)}</span></div></td>
              <td><Badge tone={order.fulfillment_status === "exception" ? "red" : order.fulfillment_status === "delivered" ? "green" : "yellow"}>{fulfillmentLabels[order.fulfillment_status] || order.fulfillment_status}</Badge></td>
              <td>{order.tracking_no ? <div className="commerce-stack"><strong>{order.shipping_carrier || "快递"}</strong><span>{order.tracking_no}</span></div> : "-"}</td>
              <td>{entrySourceLabels[order.entry_source] || order.entry_source}</td>
              <td><button type="button" onClick={() => open(order)}>处理</button></td>
            </tr>)}</tbody>
          </table> : <Empty title="当前没有订单">支付成功的订单会出现在这里。</Empty>}
        </div>
      </section>
      {draft && <Modal title={`订单 ${draft.order_no}`} onClose={() => !saving && setDraft(null)}>
        <div className="commerce-summary">
          <div><span>付款</span><strong>{formatCents(draft.pay_amount_cents)}</strong></div>
          <div><span>数量</span><strong>{draft.item_count} 个</strong></div>
          <div><span>支付时间</span><strong>{formatDate(draft.paid_at)}</strong></div>
        </div>
        <Field label="生肖明细"><textarea value={orderItemsLabel(draft)} disabled /></Field>
        <Field label="收货人"><input value={`${draft.recipient_name} · ${draft.recipient_phone}`} disabled /></Field>
        <Field label="完整收货地址"><textarea value={orderAddressLabel(draft)} disabled /></Field>
        <Field label="买家备注"><textarea value={draft.buyer_note || "无"} disabled /></Field>
        <Field label="履约状态"><select value={draft.fulfillmentStatus} onChange={(event) => setDraft({ ...draft, fulfillmentStatus: event.target.value })}>
          {Object.entries(fulfillmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>
        <div className="commerce-two-column">
          <Field label="物流公司"><input value={draft.shippingCarrier} onChange={(event) => setDraft({ ...draft, shippingCarrier: event.target.value })} placeholder="例如：中通" /></Field>
          <Field label="物流单号"><input value={draft.trackingNo} onChange={(event) => setDraft({ ...draft, trackingNo: event.target.value })} /></Field>
        </div>
        <Field label="支付状态（仅记录已在商户平台处理的退款）"><select value={draft.paymentStatus} onChange={(event) => setDraft({ ...draft, paymentStatus: event.target.value })}>
          <option value="paid">已付款</option><option value="refunding">退款中</option><option value="refunded">已退款</option>
        </select></Field>
        <Field label="内部备注"><textarea value={draft.internalNote} onChange={(event) => setDraft({ ...draft, internalNote: event.target.value })} placeholder="制作异常、联系记录、补寄说明等" /></Field>
        <button type="button" className="commerce-save" disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存订单处理结果"}</button>
      </Modal>}
    </section>
  );
}

export function EnterpriseLeadsPage({ leads = [], onChanged, notify }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => {
    const activeStatuses = ["new", "contacting", "qualified", "quoted"];
    const keyword = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (status === "active" && !activeStatuses.includes(lead.lead_status)) return false;
      if (!["all", "active"].includes(status) && lead.lead_status !== status) return false;
      if (!keyword) return true;
      return [lead.lead_no, lead.company_name, lead.contact_name, lead.mobile, lead.wechat, lead.customization_type, lead.assigned_to]
        .some((value) => String(value || "").toLowerCase().includes(keyword));
    });
  }, [leads, query, status]);

  function open(lead) {
    setDraft({
      ...lead,
      leadStatus: lead.lead_status,
      assignedTo: lead.assigned_to || "",
      nextFollowUpAt: dateInputValue(lead.next_follow_up_at),
      internalNote: lead.internal_note || "",
    });
  }

  async function save() {
    setSaving(true);
    try {
      await callAdmin("adminUpdateEnterpriseCustomizationLead", {
        leadId: draft.id,
        patch: {
          leadStatus: draft.leadStatus,
          assignedTo: draft.assignedTo,
          nextFollowUpAt: draft.nextFollowUpAt || null,
          internalNote: draft.internalNote,
        },
      });
      setDraft(null);
      await onChanged();
      notify?.({ type: "success", message: "企业线索已保存" });
    } catch (error) {
      notify?.({ type: "error", message: error.message || "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="content-grid">
      <section className="panel dm-card">
        <div className="commerce-heading">
          <div><h3>企业定制线索</h3><p>Logo 钥匙扣、整套小程序和组合方案单独跟进，不与个人发货订单混在一起。</p></div>
          <div className="commerce-count"><strong>{filtered.length}</strong><span>条线索</span></div>
        </div>
        <Toolbar
          query={query}
          setQuery={setQuery}
          status={status}
          setStatus={setStatus}
          options={[["active", "待跟进"], ...Object.entries(leadStatusLabels), ["all", "全部"]]}
          onDownload={() => downloadCsv(`呆猫企业定制线索-${new Date().toISOString().slice(0, 10)}.csv`, [
            { label: "咨询编号", value: (item) => item.lead_no },
            { label: "提交时间", value: (item) => formatDate(item.created_at) },
            { label: "公司/品牌", value: (item) => item.company_name },
            { label: "联系人", value: (item) => item.contact_name },
            { label: "手机号", value: (item) => item.mobile },
            { label: "微信号", value: (item) => item.wechat },
            { label: "定制类型", value: (item) => customizationLabels[item.customization_type] || item.customization_type },
            { label: "预计数量", value: (item) => item.estimated_quantity },
            { label: "期望时间", value: (item) => item.expected_timeline },
            { label: "状态", value: (item) => leadStatusLabels[item.lead_status] || item.lead_status },
            { label: "负责人", value: (item) => item.assigned_to },
            { label: "下次跟进", value: (item) => formatDate(item.next_follow_up_at) },
            { label: "来源", value: (item) => entrySourceLabels[item.entry_source] || item.entry_source },
            { label: "内部备注", value: (item) => item.internal_note },
          ], filtered)}
        />
        <div className="commerce-table-wrap">
          {filtered.length ? <table>
            <thead><tr><th>咨询</th><th>公司 / 联系人</th><th>定制方式</th><th>数量 / 时间</th><th>联系方式</th><th>状态</th><th>负责人 / 跟进</th><th>操作</th></tr></thead>
            <tbody>{filtered.map((lead) => <tr key={lead.id}>
              <td><div className="commerce-stack"><strong>{lead.lead_no}</strong><span>{formatDate(lead.created_at)}</span></div></td>
              <td><div className="commerce-stack"><strong>{lead.company_name}</strong><span>{lead.contact_name}</span></div></td>
              <td><Badge tone={lead.customization_type === "mini_program" ? "yellow" : "green"}>{customizationLabels[lead.customization_type] || lead.customization_type}</Badge></td>
              <td><div className="commerce-stack"><strong>{lead.estimated_quantity || "-"}</strong><span>{lead.expected_timeline || "未填写到货时间"}</span></div></td>
              <td><div className="commerce-stack"><strong>{lead.mobile || "-"}</strong><span>{lead.wechat || "-"}</span></div></td>
              <td><Badge tone={lead.lead_status === "new" ? "yellow" : lead.lead_status === "won" ? "green" : "default"}>{leadStatusLabels[lead.lead_status] || lead.lead_status}</Badge></td>
              <td><div className="commerce-stack"><strong>{lead.assigned_to || "未分配"}</strong><span>{lead.next_follow_up_at ? formatDate(lead.next_follow_up_at) : "未设跟进时间"}</span></div></td>
              <td><button type="button" onClick={() => open(lead)}>跟进</button></td>
            </tr>)}</tbody>
          </table> : <Empty title="当前没有线索">企业提交定制需求后会出现在这里。</Empty>}
        </div>
      </section>
      {draft && <Modal title={`企业咨询 ${draft.lead_no}`} onClose={() => !saving && setDraft(null)}>
        <div className="commerce-summary">
          <div><span>类型</span><strong>{customizationLabels[draft.customization_type] || draft.customization_type}</strong></div>
          <div><span>预计数量</span><strong>{draft.estimated_quantity || "-"}</strong></div>
          <div><span>来源</span><strong>{entrySourceLabels[draft.entry_source] || draft.entry_source}</strong></div>
        </div>
        <Field label="公司 / 联系人"><input value={`${draft.company_name} · ${draft.contact_name}`} disabled /></Field>
        <div className="commerce-two-column">
          <Field label="手机号"><input value={draft.mobile || ""} disabled /></Field>
          <Field label="微信号"><input value={draft.wechat || ""} disabled /></Field>
        </div>
        <Field label="期望时间"><input value={draft.expected_timeline || "-"} disabled /></Field>
        <Field label="跟进状态"><select value={draft.leadStatus} onChange={(event) => setDraft({ ...draft, leadStatus: event.target.value })}>
          {Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>
        <div className="commerce-two-column">
          <Field label="负责人"><input value={draft.assignedTo} onChange={(event) => setDraft({ ...draft, assignedTo: event.target.value })} placeholder="例如：小马" /></Field>
          <Field label="下次跟进时间"><input type="datetime-local" value={draft.nextFollowUpAt} onChange={(event) => setDraft({ ...draft, nextFollowUpAt: event.target.value })} /></Field>
        </div>
        <Field label="内部跟进记录"><textarea value={draft.internalNote} onChange={(event) => setDraft({ ...draft, internalNote: event.target.value })} placeholder="沟通摘要、报价、风险和下一步" /></Field>
        <button type="button" className="commerce-save" disabled={saving} onClick={save}>{saving ? "正在保存…" : "保存跟进记录"}</button>
      </Modal>}
    </section>
  );
}
