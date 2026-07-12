import React, { useEffect, useMemo, useState } from "react";
import { callAdmin } from "./api";

const FIXED_INPUT_PRICE = 35;
const FIXED_OUTPUT_PRICE = 210;
const EMPTY_FORM = { customerInputCnyPerMillion: "", customerOutputCnyPerMillion: "", pricingLabel: "", note: "" };

const valueOf = (item, camel, snake) => item?.[camel] ?? item?.[snake];
const asNumber = (value) => Number(value);
const priceText = (value) => Number(value).toFixed(2);
const factorText = (value) => `×${Number(value).toFixed(2)}`;

function pricingPreview(input, output) {
  const inputFactor = asNumber(input) / FIXED_INPUT_PRICE;
  const outputFactor = asNumber(output) / FIXED_OUTPUT_PRICE;
  const displayFactor = Math.round((Math.max(inputFactor, outputFactor) + Number.EPSILON) * 100) / 100;
  return { inputFactor, outputFactor, displayFactor };
}

function formFromSettings(settings) {
  return {
    customerInputCnyPerMillion: String(valueOf(settings, "customerInputCnyPerMillion", "customer_input_cny_per_million") ?? ""),
    customerOutputCnyPerMillion: String(valueOf(settings, "customerOutputCnyPerMillion", "customer_output_cny_per_million") ?? ""),
    pricingLabel: String(valueOf(settings, "pricingLabel", "pricing_label") ?? ""),
    note: "",
  };
}

function normalizeSettings(response) {
  return response?.platformBillingSettings || response?.platform_billing_settings || null;
}

function formatEffectiveAt(value) {
  if (!value) return "-";
  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function validate(form) {
  const input = String(form.customerInputCnyPerMillion).trim();
  const output = String(form.customerOutputCnyPerMillion).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(input) || asNumber(input) <= 0) return "客户输入价必须大于 0，且最多保留四位小数";
  if (!/^\d+(\.\d{1,4})?$/.test(output) || asNumber(output) <= 0) return "客户输出价必须大于 0，且最多保留四位小数";
  if (!form.pricingLabel.trim()) return "请填写计价标签";
  if (form.pricingLabel.trim().length > 60) return "计价标签不能超过 60 个字";
  if (form.note.length > 500) return "修改说明不能超过 500 个字";
  return "";
}

export default function BillingPage({ onError, onToast }) {
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [modal, setModal] = useState("");

  async function loadCurrent({ resetForm = true } = {}) {
    setLoading(true);
    setLoadError("");
    try {
      const response = await callAdmin("adminGetPlatformBillingSettings");
      const settings = normalizeSettings(response);
      if (!settings) throw new Error("数据中心未返回当前计价方案");
      setCurrent(settings);
      if (resetForm) setForm(formFromSettings(settings));
    } catch (error) {
      setLoadError(error.message || "当前计价方案读取失败");
      onError(error, "当前计价方案读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCurrent(); }, []);

  const preview = useMemo(() => pricingPreview(form.customerInputCnyPerMillion, form.customerOutputCnyPerMillion), [form.customerInputCnyPerMillion, form.customerOutputCnyPerMillion]);
  const savedForm = current ? formFromSettings(current) : EMPTY_FORM;
  const dirty = current ? Object.keys(EMPTY_FORM).some((key) => form[key] !== savedForm[key]) : false;
  const currentFactor = asNumber(valueOf(current, "customerBillingFactor", "customer_billing_factor") ?? valueOf(current, "displayFactor", "display_factor") ?? 0);
  const validPreview = Number.isFinite(preview.displayFactor) && preview.displayFactor > 0;
  const unequal = validPreview && Math.abs(preview.inputFactor - preview.outputFactor) > 0.000001;

  function set(key, value) {
    setForm((old) => ({ ...old, [key]: value }));
    setFormError("");
  }

  function restore() {
    if (!current) return;
    setForm(formFromSettings(current));
    setFormError("");
  }

  function openModal(type) {
    const error = validate(form);
    if (error) return setFormError(error);
    setModal(type);
  }

  async function publish() {
    if (publishing) return;
    const error = validate(form);
    if (error) { setModal(""); setFormError(error); return; }
    setPublishing(true);
    try {
      const response = await callAdmin("adminUpdatePlatformBillingSettings", {
        settings: {
          customerInputCnyPerMillion: asNumber(form.customerInputCnyPerMillion),
          customerOutputCnyPerMillion: asNumber(form.customerOutputCnyPerMillion),
          pricingLabel: form.pricingLabel.trim(),
          note: form.note.trim(),
        },
      });
      let settings = normalizeSettings(response);
      if (!settings) {
        const confirmed = await callAdmin("adminGetPlatformBillingSettings");
        settings = normalizeSettings(confirmed);
      }
      if (!settings) throw new Error("发布成功，但数据中心未返回生效方案，请刷新后确认");
      setCurrent(settings);
      setForm(formFromSettings(settings));
      setModal("");
      const serverFactor = valueOf(settings, "customerBillingFactor", "customer_billing_factor") ?? valueOf(settings, "displayFactor", "display_factor");
      onToast({ type: "success", message: `计价方案已发布，后续 AI 请求将使用 ${factorText(serverFactor)} 结算` });
    } catch (error) {
      onError(error, "计价方案发布失败");
    } finally {
      setPublishing(false);
    }
  }

  if (loading && !current) return <div className="pricing-status dm-card"><strong>正在读取当前计价方案…</strong><span>页面不会使用前端默认值覆盖数据中心配置。</span></div>;
  if (!current) return <div className="pricing-status pricing-status-error dm-card"><strong>当前计价方案读取失败</strong><span>{loadError}</span><button onClick={() => loadCurrent()}>重新读取</button></div>;

  const currentInput = valueOf(current, "customerInputCnyPerMillion", "customer_input_cny_per_million");
  const currentOutput = valueOf(current, "customerOutputCnyPerMillion", "customer_output_cny_per_million");
  const label = valueOf(current, "pricingLabel", "pricing_label") || "未命名方案";
  const version = valueOf(current, "pricingVersion", "pricing_version");
  const effectiveAt = valueOf(current, "pricingEffectiveAt", "pricing_effective_at");
  const tone = currentFactor < 1 ? "discount" : currentFactor > 1 ? "premium" : "standard";
  const disabled = publishing;

  return <section className="pricing-page">
    <header className="pricing-heading"><div><p className="eyebrow">AI POWER PRICING</p><h2>AI 电力计价</h2><p>设置面向客户的结算价格。倍率由数据中心根据固定基准计算并发布。</p></div><button onClick={() => loadCurrent()} disabled={loading || publishing}>刷新当前方案</button></header>

    <section className={`current-pricing dm-card pricing-tone-${tone}`}>
      <div className="pricing-section-title"><div><span>当前生效方案</span><h3>{label}</h3></div><span className="pricing-version">V{version ?? "-"}</span></div>
      <div className="pricing-current-grid">
        <PricingValue label="客户输入价" value={`${priceText(currentInput)} 元`} hint="/ 1M tokens" />
        <PricingValue label="客户输出价" value={`${priceText(currentOutput)} 元`} hint="/ 1M tokens" />
        <PricingValue label="当前消耗倍率" value={factorText(currentFactor)} hint={currentFactor < 1 ? "优惠倍率" : currentFactor > 1 ? "保障倍率" : "标准倍率"} accent />
        <PricingValue label="生效时间" value={formatEffectiveAt(effectiveAt)} hint="数据中心时间" />
      </div>
    </section>

    <div className="pricing-columns">
      <section className="pricing-baseline dm-card">
        <div className="pricing-section-title"><div><span>固定计价基准</span><h3>平台统一基准</h3></div><span className="readonly-badge">只读</span></div>
        <div className="baseline-row"><span>输入</span><strong>35.00 元</strong><small>/ 1M tokens</small></div>
        <div className="baseline-row"><span>输出</span><strong>210.00 元</strong><small>/ 1M tokens</small></div>
        <p className="pricing-help">当前消耗倍率均相对这一固定基准计算。充值比例固定为 1 元 = 1000 电力。</p>
      </section>

      <section className="pricing-editor dm-card">
        <div className="pricing-section-title"><div><span>编辑客户结算价</span><h3>准备发布的新方案</h3></div>{dirty && <span className="draft-badge">草稿未发布</span>}</div>
        <fieldset disabled={disabled}>
          <div className="price-input-grid">
            <label>客户输入价<div className="input-with-unit"><input inputMode="decimal" placeholder="例如 28" value={form.customerInputCnyPerMillion} onChange={(e) => set("customerInputCnyPerMillion", e.target.value)} /><span>元 / 1M tokens</span></div></label>
            <label>客户输出价<div className="input-with-unit"><input inputMode="decimal" placeholder="例如 168" value={form.customerOutputCnyPerMillion} onChange={(e) => set("customerOutputCnyPerMillion", e.target.value)} /><span>元 / 1M tokens</span></div></label>
          </div>
          <label>计价标签<input maxLength="60" value={form.pricingLabel} onChange={(e) => set("pricingLabel", e.target.value)} /></label>
          <div className="label-presets">{["优惠价", "标准价", "保障价"].map((item) => <button type="button" key={item} className={form.pricingLabel === item ? "active" : ""} onClick={() => set("pricingLabel", item)}>{item}</button>)}<button type="button" onClick={() => set("pricingLabel", "")}>自定义</button></div>
          <label>修改说明 <small>选填，仅供超管审计</small><textarea maxLength="500" value={form.note} onChange={(e) => set("note", e.target.value)} /><span className="field-count">{form.note.length}/500</span></label>
        </fieldset>
        {formError && <div className="pricing-inline-error">{formError}</div>}
      </section>
    </div>

    <section className="pricing-preview dm-card">
      <div className="pricing-section-title"><div><span>发布预览</span><h3>倍率与客户展示</h3></div><strong className="preview-factor">{validPreview ? factorText(preview.displayFactor) : "—"}</strong></div>
      <div className="factor-formula-grid">
        <div><span>输入倍率</span><strong>{validPreview ? `${form.customerInputCnyPerMillion} ÷ 35 = ${preview.inputFactor.toFixed(2)}` : "等待有效价格"}</strong></div>
        <div><span>输出倍率</span><strong>{validPreview ? `${form.customerOutputCnyPerMillion} ÷ 210 = ${preview.outputFactor.toFixed(2)}` : "等待有效价格"}</strong></div>
        <div><span>发布后消耗倍率</span><strong>{validPreview ? factorText(preview.displayFactor) : "—"}</strong></div>
      </div>
      {unequal && <div className="pricing-warning">输入输出价格不是等比设置。系统将取较高值，整笔用量按 {factorText(preview.displayFactor)} 结算。</div>}
      {validPreview && preview.displayFactor !== currentFactor && <div className="pricing-change">发布后，客户后续 AI 请求的电力消耗将由 {factorText(currentFactor)} 调整为 {factorText(preview.displayFactor)}。</div>}
      <div className="customer-price-card">
        <span>客户后台展示预览</span><div><strong>客户输入价 {validPreview ? priceText(form.customerInputCnyPerMillion) : "—"} 元</strong><small>/ 1M tokens</small></div><div><strong>客户输出价 {validPreview ? priceText(form.customerOutputCnyPerMillion) : "—"} 元</strong><small>/ 1M tokens</small></div><div><strong>当前消耗比例 {validPreview ? factorText(preview.displayFactor) : "—"}</strong></div>
      </div>
      <div className="pricing-actions"><button onClick={restore} disabled={!dirty || disabled}>恢复当前方案</button><button onClick={() => openModal("preview")} disabled={disabled}>预览客户展示</button><button className="primary-button" onClick={() => openModal("confirm")} disabled={!dirty || disabled}>{publishing ? "发布中…" : "发布计价方案"}</button></div>
    </section>

    {modal === "preview" && <PricingDialog title="客户展示预览" onClose={() => setModal("")} disabled={publishing}><div className="community-preview"><p>当前客户输入价：<strong>{priceText(form.customerInputCnyPerMillion)} 元 / 1M tokens</strong></p><p>当前客户输出价：<strong>{priceText(form.customerOutputCnyPerMillion)} 元 / 1M tokens</strong></p><p>当前消耗比例：<strong>{factorText(preview.displayFactor)}</strong></p><div className="mock-bill"><span>模拟账单</span><strong>基准 100 电力</strong><strong>{form.pricingLabel} {factorText(preview.displayFactor)}</strong><strong>实扣 {Math.round(100 * preview.displayFactor)} 电力</strong></div></div></PricingDialog>}
    {modal === "confirm" && <PricingDialog title="确认发布新的 AI 电力计价方案？" onClose={() => !publishing && setModal("")} disabled={publishing}><div className="confirm-pricing"><p>客户输入价：<strong>{priceText(form.customerInputCnyPerMillion)} 元 / 1M tokens</strong></p><p>客户输出价：<strong>{priceText(form.customerOutputCnyPerMillion)} 元 / 1M tokens</strong></p><p>当前倍率：<strong>{factorText(currentFactor)}</strong></p><p>发布后倍率：<strong>{factorText(preview.displayFactor)}</strong></p><div className="pricing-warning neutral">新价格只影响发布后开始的 AI 请求，历史账单不会改变。</div><div className="dialog-actions"><button onClick={() => setModal("")} disabled={publishing}>取消</button><button className="primary-button" onClick={publish} disabled={publishing}>{publishing ? "发布中…" : "确认发布"}</button></div></div></PricingDialog>}
  </section>;
}

function PricingValue({ label, value, hint, accent }) {
  return <div className={`pricing-value ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function PricingDialog({ title, children, onClose, disabled }) {
  return <div className="modal-backdrop" onMouseDown={() => !disabled && onClose()}><div className="modal-card dm-card pricing-dialog" onMouseDown={(e) => e.stopPropagation()}><div className="modal-header"><h3>{title}</h3><button onClick={onClose} disabled={disabled}>关闭</button></div>{children}</div></div>;
}
