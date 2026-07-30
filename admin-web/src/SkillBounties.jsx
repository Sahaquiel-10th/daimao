import React, { useEffect, useMemo, useState } from "react";
import { callAdmin, uploadAsset } from "./api";

const availabilityOptions = [
  ["available", "可接单"],
  ["idle", "空闲中"],
  ["busy", "爆单啦"],
  ["resting", "休息中"],
];

const publishOptions = [
  ["draft", "草稿"],
  ["published", "已上架"],
  ["hidden", "已隐藏"],
  ["archived", "已归档"],
];

const applicationStatusOptions = [
  ["submitted", "待处理"],
  ["contacting", "联系中"],
  ["matched", "已匹配"],
  ["assigned", "已派单"],
  ["completed", "已完成"],
  ["rejected", "已拒绝"],
  ["cancelled", "已取消"],
];

const activeApplicationStatuses = new Set(["submitted", "contacting", "matched", "assigned"]);

function emptyDraft() {
  return {
    id: null,
    providerUserId: "",
    displayName: "",
    avatarUrl: "",
    avatarDisplayUrl: "",
    skillName: "",
    specialtiesText: "",
    serviceScopesText: "",
    shortIntro: "",
    pastReview: "",
    availabilityStatus: "available",
    catCount: 0,
    publishStatus: "draft",
    sortWeight: 0,
  };
}

function draftFrom(item) {
  return {
    id: item.id,
    providerUserId: item.provider_user_id || "",
    displayName: item.display_name || "",
    avatarUrl: item.avatar_url || "",
    avatarDisplayUrl: item.avatar_display_url || "",
    skillName: item.skill_name || "",
    specialtiesText: (item.specialties || []).join("、"),
    serviceScopesText: (item.service_scopes || []).join("\n"),
    shortIntro: item.short_intro || "",
    pastReview: item.past_review || "",
    availabilityStatus: item.availability_status || "available",
    catCount: Number(item.cat_count || 0),
    publishStatus: item.publish_status || "draft",
    sortWeight: Number(item.sort_weight || 0),
  };
}

function splitItems(value) {
  return [...new Set(String(value || "").split(/[\n,，、]+/).map((item) => item.trim()).filter(Boolean))];
}

function labelOf(options, value) {
  return options.find(([key]) => key === value)?.[1] || value || "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function userLabel(user) {
  return user.profile?.name || user.display_name || user.public_user_code || `用户 #${user.id}`;
}

function contactValue(item) {
  return item.contact_method || item.applicant?.wechat || "";
}

export default function SkillBountyPage({ users = [] }) {
  const [bounties, setBounties] = useState([]);
  const [applications, setApplications] = useState([]);
  const [draft, setDraft] = useState(null);
  const [applicationDraft, setApplicationDraft] = useState(null);
  const [queueStatus, setQueueStatus] = useState("active");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [bountyResult, applicationResult] = await Promise.all([
        callAdmin("adminListSkillBounties", { limit: 500 }),
        callAdmin("adminListSkillBountyApplications", { limit: 500 }),
      ]);
      setBounties(bountyResult.skillBounties || []);
      setApplications(applicationResult.applications || []);
    } catch (err) {
      setError(err.message || "技能悬赏数据加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ silent: true }), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredApplications = useMemo(() => {
    if (queueStatus === "all") return applications;
    if (queueStatus === "active") return applications.filter((item) => activeApplicationStatuses.has(item.status));
    return applications.filter((item) => item.status === queueStatus);
  }, [applications, queueStatus]);

  async function saveBounty(event) {
    event.preventDefault();
    if (!draft.displayName.trim() || !draft.skillName.trim()) {
      setError("请填写展示姓名和技能名称");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await callAdmin("adminUpsertSkillBounty", {
        skillBountyId: draft.id,
        skillBounty: {
          providerUserId: draft.providerUserId || null,
          displayName: draft.displayName.trim(),
          avatarUrl: draft.avatarUrl,
          skillName: draft.skillName.trim(),
          specialties: splitItems(draft.specialtiesText),
          serviceScopes: splitItems(draft.serviceScopesText),
          shortIntro: draft.shortIntro.trim(),
          pastReview: draft.pastReview.trim(),
          availabilityStatus: draft.availabilityStatus,
          catCount: Math.max(Number(draft.catCount || 0), 0),
          publishStatus: draft.publishStatus,
          sortWeight: Number(draft.sortWeight || 0),
        },
      });
      setDraft(null);
      setMessage(draft.id ? "技能人才已保存" : "技能人才已创建");
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const result = await uploadAsset("skill-avatar", file);
      setDraft((current) => ({
        ...current,
        avatarUrl: result.fileID,
        avatarDisplayUrl: result.tempFileURL || result.displayUrl || "",
      }));
      setMessage("头像已上传，保存表单后生效");
    } catch (err) {
      setError(err.message || "头像上传失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveApplication(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await callAdmin("adminUpdateSkillBountyApplication", {
        applicationId: applicationDraft.id,
        application: {
          status: applicationDraft.status,
          adminNote: applicationDraft.adminNote || "",
          assignedProviderUserId: applicationDraft.assignedProviderUserId || null,
        },
      });
      setApplicationDraft(null);
      setMessage("邀约处理状态已保存");
      await load({ silent: true });
    } catch (err) {
      setError(err.message || "邀约保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyContact(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage("联系方式已复制");
    } catch {
      setMessage(`联系方式：${value}`);
    }
  }

  return (
    <section className="content-grid skill-admin-page">
      {(message || error) && (
        <div className={error ? "notice skill-message" : "skill-success-message"}>
          {error || message}
        </div>
      )}

      <section className="panel dm-card">
        <div className="panel-title-row">
          <div>
            <h3>技能悬赏内容</h3>
            <p className="muted">人才资料由平台审核并维护，只有“已上架”的内容会出现在小程序。</p>
          </div>
          <div className="inline-actions">
            <button type="button" className="button-secondary" onClick={() => load()} disabled={loading}>刷新</button>
            <button type="button" onClick={() => setDraft(emptyDraft())}>新增技能人才</button>
          </div>
        </div>

        <div className="skill-summary-grid">
          <div><span>人才条目</span><strong>{bounties.length}</strong></div>
          <div><span>小程序已上架</span><strong>{bounties.filter((item) => item.publish_status === "published").length}</strong></div>
          <div><span>待处理邀约</span><strong>{applications.filter((item) => item.status === "submitted").length}</strong></div>
          <div><span>进行中任务</span><strong>{applications.filter((item) => ["contacting", "matched", "assigned"].includes(item.status)).length}</strong></div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>人才</th>
                <th>技能与领域</th>
                <th>当前状态</th>
                <th>上架状态</th>
                <th>猫猫数</th>
                <th>排序</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {bounties.length ? bounties.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="skill-person-cell">
                      {item.avatar_display_url || item.avatar_url
                        ? <img src={item.avatar_display_url || item.avatar_url} alt="" />
                        : <span>🐱</span>}
                      <div><strong>{item.display_name}</strong><small>{item.provider_user_id ? `关联用户 #${item.provider_user_id}` : "未关联用户"}</small></div>
                    </div>
                  </td>
                  <td><strong>{item.skill_name}</strong><small className="skill-cell-note">{(item.specialties || []).join(" · ") || "-"}</small></td>
                  <td><span className={`skill-status skill-status-${item.availability_status}`}>{labelOf(availabilityOptions, item.availability_status)}</span></td>
                  <td>{labelOf(publishOptions, item.publish_status)}</td>
                  <td>🐱 × {item.cat_count || 0}</td>
                  <td>{item.sort_weight || 0}</td>
                  <td>{formatDate(item.updated_at)}</td>
                  <td><button type="button" onClick={() => setDraft(draftFrom(item))}>编辑</button></td>
                </tr>
              )) : (
                <tr><td colSpan="8"><div className="empty-state"><strong>还没有技能人才</strong><span>点击“新增技能人才”创建第一条内容。</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel dm-card">
        <div className="panel-title-row">
          <div>
            <h3>邀约收件箱</h3>
            <p className="muted">先确认需求、预算和档期，再添加微信并分派工作。联系方式仅超级管理员可见。</p>
          </div>
          <label className="skill-filter">
            <span>队列</span>
            <select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}>
              <option value="active">待跟进与进行中</option>
              {applicationStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="all">全部状态</option>
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>邀约编号</th>
                <th>邀约对象</th>
                <th>需求方</th>
                <th>需求摘要</th>
                <th>联系方式</th>
                <th>状态</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredApplications.length ? filteredApplications.map((item) => (
                <tr key={item.id} className={item.status === "submitted" ? "skill-row-new" : ""}>
                  <td><code>{item.request_no}</code></td>
                  <td><strong>{item.skillBounty?.display_name || `技能 #${item.skill_bounty_id}`}</strong><small className="skill-cell-note">{item.skillBounty?.skill_name || ""}</small></td>
                  <td>{item.contact_name || item.applicant?.display_name || `用户 #${item.applicant_user_id}`}</td>
                  <td><span className="skill-summary-text">{item.task_summary}</span></td>
                  <td>
                    <div className="skill-contact-cell">
                      <code>{contactValue(item) || "-"}</code>
                      {contactValue(item) && <button type="button" className="button-secondary" onClick={() => copyContact(contactValue(item))}>复制</button>}
                    </div>
                  </td>
                  <td>{labelOf(applicationStatusOptions, item.status)}</td>
                  <td>{formatDate(item.created_at)}</td>
                  <td><button type="button" onClick={() => setApplicationDraft({
                    ...item,
                    adminNote: item.admin_note || "",
                    assignedProviderUserId: item.assigned_provider_user_id || "",
                  })}>处理</button></td>
                </tr>
              )) : (
                <tr><td colSpan="8"><div className="empty-state"><strong>当前队列没有邀约</strong><span>新的小程序邀约提交后会自动出现在这里。</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDraft(null)}>
          <section className="modal-panel modal-panel-wide dm-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title"><h3>{draft.id ? "编辑技能人才" : "新增技能人才"}</h3><button type="button" className="icon-button" onClick={() => setDraft(null)}>×</button></div>
            <form className="skill-form" onSubmit={saveBounty}>
              <div className="skill-form-grid">
                <label><span>展示姓名 *</span><input value={draft.displayName} maxLength="80" onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
                <label><span>主技能 *</span><input value={draft.skillName} maxLength="160" onChange={(event) => setDraft({ ...draft, skillName: event.target.value })} /></label>
                <label><span>关联数据中心用户（选填）</span><select value={draft.providerUserId} onChange={(event) => setDraft({ ...draft, providerUserId: event.target.value })}><option value="">不关联</option>{users.map((user) => <option key={user.id} value={user.id}>{userLabel(user)} · {user.public_user_code || user.id}</option>)}</select></label>
                <label><span>当前状态</span><select value={draft.availabilityStatus} onChange={(event) => setDraft({ ...draft, availabilityStatus: event.target.value })}>{availabilityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>上架状态</span><select value={draft.publishStatus} onChange={(event) => setDraft({ ...draft, publishStatus: event.target.value })}>{publishOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>猫猫数</span><input type="number" min="0" value={draft.catCount} onChange={(event) => setDraft({ ...draft, catCount: event.target.value })} /></label>
                <label><span>排序权重</span><input type="number" value={draft.sortWeight} onChange={(event) => setDraft({ ...draft, sortWeight: event.target.value })} /></label>
                <label className="skill-avatar-upload"><span>头像</span><div>{draft.avatarDisplayUrl || draft.avatarUrl ? <img src={draft.avatarDisplayUrl || draft.avatarUrl} alt="" /> : <b>🐱</b>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadAvatar(event.target.files?.[0])} /></div></label>
                <label className="skill-form-wide"><span>擅长领域（用逗号或顿号分隔）</span><input value={draft.specialtiesText} onChange={(event) => setDraft({ ...draft, specialtiesText: event.target.value })} placeholder="品牌设计、活动视觉、小程序 UI" /></label>
                <label className="skill-form-wide"><span>可承接范围（每行一项）</span><textarea rows="3" value={draft.serviceScopesText} onChange={(event) => setDraft({ ...draft, serviceScopesText: event.target.value })} /></label>
                <label className="skill-form-wide"><span>简介</span><textarea rows="3" maxLength="500" value={draft.shortIntro} onChange={(event) => setDraft({ ...draft, shortIntro: event.target.value })} /></label>
                <label className="skill-form-wide"><span>过往评价（平台填写）</span><textarea rows="5" value={draft.pastReview} onChange={(event) => setDraft({ ...draft, pastReview: event.target.value })} /></label>
              </div>
              <div className="inline-actions skill-form-actions"><button type="button" className="button-secondary" onClick={() => setDraft(null)}>取消</button><button type="submit" disabled={loading}>保存</button></div>
            </form>
          </section>
        </div>
      )}

      {applicationDraft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setApplicationDraft(null)}>
          <section className="modal-panel modal-panel-wide dm-card" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title"><h3>处理邀约 {applicationDraft.request_no}</h3><button type="button" className="icon-button" onClick={() => setApplicationDraft(null)}>×</button></div>
            <form className="skill-form" onSubmit={saveApplication}>
              <div className="skill-application-detail">
                <div><span>邀约对象</span><strong>{applicationDraft.skillBounty?.display_name || `技能 #${applicationDraft.skill_bounty_id}`}</strong><small>{applicationDraft.skillBounty?.skill_name || ""}</small></div>
                <div><span>需求方</span><strong>{applicationDraft.contact_name || applicationDraft.applicant?.display_name || `用户 #${applicationDraft.applicant_user_id}`}</strong><small>{applicationDraft.applicant?.public_user_code || ""}</small></div>
                <div className="skill-detail-wide"><span>联系方式 / 微信号</span><div className="skill-contact-highlight"><code>{contactValue(applicationDraft) || "-"}</code>{contactValue(applicationDraft) && <button type="button" onClick={() => copyContact(contactValue(applicationDraft))}>复制</button>}</div><small>用户已在小程序中同意平台为本次邀约联系。</small></div>
                <div className="skill-detail-wide"><span>需求内容</span><p>{applicationDraft.task_summary || "-"}</p></div>
                <div className="skill-detail-wide"><span>期望结果</span><p>{applicationDraft.expected_result || "-"}</p></div>
                <div><span>预算</span><strong>{applicationDraft.budget_range || "未填写"}</strong></div>
                <div><span>期望时间</span><strong>{applicationDraft.desired_deadline || "未填写"}</strong></div>
              </div>
              <div className="skill-form-grid">
                <label><span>处理状态</span><select value={applicationDraft.status} onChange={(event) => setApplicationDraft({ ...applicationDraft, status: event.target.value })}>{applicationStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label><span>实际分派对象（选填）</span><select value={applicationDraft.assignedProviderUserId} onChange={(event) => setApplicationDraft({ ...applicationDraft, assignedProviderUserId: event.target.value })}><option value="">暂未分派</option>{users.map((user) => <option key={user.id} value={user.id}>{userLabel(user)} · {user.public_user_code || user.id}</option>)}</select></label>
                <label className="skill-form-wide"><span>内部跟进备注</span><textarea rows="5" value={applicationDraft.adminNote} onChange={(event) => setApplicationDraft({ ...applicationDraft, adminNote: event.target.value })} placeholder="例如：已添加微信，等待确认预算和排期。" /></label>
              </div>
              <div className="inline-actions skill-form-actions"><button type="button" className="button-secondary" onClick={() => setApplicationDraft(null)}>取消</button><button type="submit" disabled={loading}>保存处理结果</button></div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
