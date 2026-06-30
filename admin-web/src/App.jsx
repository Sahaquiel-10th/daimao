import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  CheckCircle2,
  Database,
  FileText,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Shield,
  Star,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { callAdmin, hasToken, loginAdmin, saveAccessKey, saveToken, uploadAsset } from "./api";
import logoCutout from "./assets/logo-cutout.png";
import catRub from "./assets/cat-rub-cutout.png";
import catStretch from "./assets/cat-stretch-cutout.png";

const tabs = [
  { key: "overview", label: "概览", icon: Activity },
  { key: "users", label: "用户", icon: Users, superOnly: true },
  { key: "admins", label: "管理员", icon: Shield, superOnly: true },
  { key: "communities", label: "社区", icon: Building2 },
  { key: "projects", label: "项目", icon: Database },
  { key: "events", label: "活动", icon: CalendarDays },
  { key: "pending", label: "待处理", icon: CheckCircle2 },
  { key: "experience", label: "经验", icon: Star, superOnly: true },
  { key: "rag", label: "RAG", icon: Search },
  { key: "logs", label: "日志", icon: FileText, superOnly: true },
];

const emptyEvent = {
  title: "",
  description: "",
  eventType: "offline_meeting",
  location: "",
  startTime: "",
  endTime: "",
  status: "published",
  visibility: "public",
  officialSortWeight: 0,
  capacity: "",
  coverUrl: "",
  communityId: "",
};

function emptyProjectDraft(defaultCommunityId = "") {
  return {
    id: null,
    name: "",
    description: "",
    stage: "筹备中",
    status: "draft",
    visibility: "private",
    goal: "",
    tagsText: "",
    creatorUserId: "",
    communityId: defaultCommunityId || "",
    is_official_recommended: 0,
    official_sort_weight: officialWeightFromOrder(3),
    coverUrl: "",
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function statusLabel(value) {
  const labels = {
    active: "启用",
    disabled: "禁用",
    draft: "草稿",
    published: "已发布",
    closed: "已关闭",
    cancelled: "已取消",
    completed: "已完成",
    paused: "暂停",
    archived: "归档",
    indexed: "已索引",
    pending: "等待",
    failed: "失败",
    revoked: "已撤销",
    admin_note: "管理员备注",
    admin_interview: "管理员访谈",
    admin_evidence: "管理员证据",
    risk_note: "风险备注",
  };
  return labels[value] || value || "-";
}

function communityName(communities, communityId) {
  if (!communityId) return "平台官方";
  const community = (communities || []).find((item) => Number(item.id) === Number(communityId));
  return community?.name || `社区 #${communityId}`;
}

function userName(users, userId) {
  if (!userId) return "-";
  const user = (users || []).find((item) => Number(item.id) === Number(userId));
  return user?.profile?.name || user?.display_name || `用户 #${userId}`;
}

function buildPendingItems(data) {
  if (!data) return [];
  const items = [];
  (data.projectApplications || [])
    .filter((item) => ["pending_secretary_review", "pending_owner_review"].includes(item.status) || item.ai_review_status === "pending")
    .forEach((item) => {
      items.push({
        id: `application-${item.id}`,
        type: "项目申请",
        title: `项目 #${item.project_id} · ${userName(data.users, item.user_id)}`,
        status: item.status,
        hint: item.ai_review_summary || item.message || "等待审核",
        created_at: item.created_at,
      });
    });
  (data.ragIndexJobs || [])
    .filter((item) => ["pending", "processing", "failed"].includes(item.status))
    .forEach((item) => {
      items.push({
        id: `rag-${item.id}`,
        type: "RAG 索引",
        title: `Source #${item.source_id}`,
        status: item.status,
        hint: item.error_message || item.job_type || "等待索引",
        created_at: item.created_at,
      });
    });
  (data.evidence || [])
    .filter((item) => item.status === "candidate")
    .forEach((item) => {
      items.push({
        id: `evidence-${item.id}`,
        type: "候选证据",
        title: `${userName(data.users, item.user_id)} · ${statusLabel(item.evidence_type)}`,
        status: item.status,
        hint: item.content,
        created_at: item.created_at,
      });
    });
  return items.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 80);
}

function Badge({ children, tone = "default" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ title = "暂无数据", children }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

function firstText(value, fallback = "猫") {
  return String(value || fallback).trim().slice(0, 1);
}

function assetSrc(primary, fallback) {
  if (primary) return primary;
  if (typeof fallback === "string" && !fallback.startsWith("cloud://")) return fallback;
  return "";
}

function assetStatusText(value) {
  return value ? "已上传，保存后生效" : "未上传";
}

function isSessionError(err) {
  const code = err && err.code;
  const message = String((err && err.message) || "");
  return ["LOGIN_FAILED", "LOGIN_NOT_CONFIGURED", "UNAUTHORIZED", "LOGIN_REQUIRED"].includes(code)
    || /请先登录后台|登录失败|会话|session/i.test(message);
}

function officialDisplayOrder(weight) {
  const value = Number(weight || 0);
  if (!value) return 1;
  if (value >= 900) return Math.max(1, Math.min(5, 1000 - value));
  return Math.max(1, Math.min(5, value));
}

function officialWeightFromOrder(order) {
  const value = Math.max(1, Math.min(5, Number(order || 1)));
  return 1000 - value;
}

function userDraftFrom(user) {
  const profile = user?.profile || {};
  return {
    id: user?.id,
    publicUserCode: user?.public_user_code || "",
    displayName: user?.display_name || "",
    avatarUrl: user?.avatar_url || profile.avatar_url || "",
    avatarDisplayUrl: user?.avatar_display_url || profile.avatar_display_url || "",
    status: user?.status || "active",
    isAdmin: !!user?.is_admin,
    experiencePoints: Number(user?.experience_points || 0),
    profileName: profile.name || "",
    job: profile.job || "",
    wechat: profile.wechat || "",
    intro: profile.intro || "",
    adminNote: profile.admin_note || "",
    profileTags: (profile.tags || []).join(" "),
    referrerUserCode: user?.referral?.referrer_public_user_code || "",
    referralNote: user?.referral?.note || "",
  };
}

function communityDraftFrom(community) {
  return {
    id: community?.id,
    name: community?.name || "",
    badgeName: community?.badge_name || "",
    logoUrl: community?.logo_url || "",
    logoDisplayUrl: community?.logo_display_url || "",
    description: community?.description || "",
    status: community?.status || "active",
    sortWeight: Number(community?.sort_weight || 0),
  };
}

function emptyCommunityDraft() {
  return {
    id: null,
    name: "",
    badgeName: "",
    logoUrl: "",
    logoDisplayUrl: "",
    description: "",
    status: "active",
    sortWeight: 0,
  };
}

function emptyAdminDraft() {
  return {
    id: null,
    username: "",
    displayName: "",
    password: "",
    role: "community_admin",
    status: "active",
    communityIds: [],
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [usernameInput, setUsernameInput] = useState("admin");
  const [passwordInput, setPasswordInput] = useState("");
  const [authed, setAuthed] = useState(hasToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDraft, setUserDraft] = useState(null);
  const [userEvidence, setUserEvidence] = useState([]);
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [communityDraft, setCommunityDraft] = useState(null);
  const [adminDraft, setAdminDraft] = useState(null);
  const [evidenceDraft, setEvidenceDraft] = useState(null);
  const [projectDraft, setProjectDraft] = useState(null);
  const [eventDraft, setEventDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [errorNeedsLogin, setErrorNeedsLogin] = useState(false);

  function showError(err, fallback = "操作失败") {
    const message = (err && err.message) || fallback;
    const needsLogin = isSessionError(err);
    setError(message);
    setErrorNeedsLogin(needsLogin);
    setToast({ type: "error", message });
    if (needsLogin) {
      saveToken("");
      saveAccessKey("");
      setPasswordInput("");
      setAuthed(false);
      setData(null);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setErrorNeedsLogin(false);
    try {
      const payload = await callAdmin("adminList");
      setData(payload);
      if (selectedUser) {
        const next = (payload.users || []).find((item) => Number(item.id) === Number(selectedUser.id));
        if (next) {
          setSelectedUser(next);
          setUserDraft(userDraftFrom(next));
          await loadUserEvidence(next.id);
        }
      }
      if (selectedCommunity) {
        const nextCommunity = (payload.communities || []).find((item) => Number(item.id) === Number(selectedCommunity.id));
        if (nextCommunity) {
          setSelectedCommunity(nextCommunity);
          if (communityDraft) setCommunityDraft(communityDraftFrom(nextCommunity));
        }
      }
    } catch (err) {
      showError(err, "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) refresh();
  }, [authed]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stats = useMemo(() => {
    const users = data?.users || [];
    const projects = data?.projects || [];
    const events = data?.events || [];
    const communities = data?.communities || [];
    return [
      { label: "活跃用户", value: users.filter((item) => item.status === "active").length, hint: `${users.length} 总用户` },
      { label: "认证社区", value: communities.filter((item) => item.status === "active").length, hint: "徽章与称号" },
      { label: "官方项目", value: projects.filter((item) => item.is_official_recommended).length, hint: "前 5 位展示" },
      { label: "活动", value: events.filter((item) => item.status === "published").length, hint: `${events.length} 总活动` },
    ];
  }, [data]);

  const filteredUsers = (data?.users || []).filter((item) =>
    [
      item.display_name,
      item.openid,
      item.public_user_code,
      item.id,
      item.profile?.name,
      item.profile?.job,
      item.referral?.referrer_public_user_code,
      item.referral?.referrer_display_name,
    ].some((value) => String(value || "").includes(query))
  );
  const filteredProjects = (data?.projects || []).filter((item) =>
    [item.name, item.status, item.visibility, item.stage].some((value) => String(value || "").includes(query))
  );
  const filteredEvents = (data?.events || []).filter((item) =>
    [item.title, item.location, item.status].some((value) => String(value || "").includes(query))
  );
  const filteredCommunities = (data?.communities || []).filter((item) =>
    [item.name, item.badge_name, item.status].some((value) => String(value || "").includes(query))
  );
  const communityMembers = useMemo(() => {
    if (!selectedCommunity) return [];
    return (data?.users || []).filter((user) =>
      (user.communities || []).some((item) => Number(item.community_id) === Number(selectedCommunity.id) && item.status === "active")
    );
  }, [data, selectedCommunity]);
  const selectedUserEvidence = useMemo(() => {
    if (!selectedUser) return [];
    return userEvidence;
  }, [selectedUser, userEvidence]);
  const pendingItems = useMemo(() => buildPendingItems(data), [data]);
  const adminSession = data?.adminSession || null;
  const isSuperAdmin = adminSession?.role !== "community_admin";
  const visibleTabs = useMemo(() => tabs.filter((tab) => !tab.superOnly || isSuperAdmin), [isSuperAdmin]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, visibleTabs]);

  async function loadUserEvidence(userId) {
    if (!userId) {
      setUserEvidence([]);
      return [];
    }
    const result = await callAdmin("adminListUserEvidence", { userId });
    setUserEvidence(result.evidence || []);
    return result.evidence || [];
  }

  async function run(action, payload, successMessage = "操作已完成") {
    setLoading(true);
    setError("");
    setErrorNeedsLogin(false);
    setToast({ type: "info", message: "正在保存..." });
    try {
      await callAdmin(action, payload);
      await refresh();
      setToast({ type: "success", message: successMessage });
      return true;
    } catch (err) {
      showError(err, "操作失败");
      setLoading(false);
      return false;
    }
  }

  async function submitCommunityEvidence() {
    if (!evidenceDraft) return false;
    setLoading(true);
    setError("");
    setErrorNeedsLogin(false);
    try {
      await callAdmin("adminCreateCommunityMemberEvidence", {
        userId: evidenceDraft.userId,
        communityId: evidenceDraft.communityId,
        evidenceType: evidenceDraft.evidenceType,
        title: evidenceDraft.title,
        content: evidenceDraft.content,
        confidence: evidenceDraft.confidence,
        file: evidenceDraft.file,
      });
      setEvidenceDraft(null);
      await refresh();
      setToast({ type: "success", message: "证据已保存，后台正在索引，约 1-3 分钟后可检索" });
      callAdmin("processRagIndexJobs", { limit: 10 }).then(refresh).catch((err) => {
        setToast({ type: "error", message: `证据已保存，但即时索引触发失败：${err.message || "请稍后由定时任务补偿"}` });
      });
      return true;
    } catch (err) {
      showError(err, "证据保存失败");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function upload(kind, file, apply) {
    if (file && file.size > 2 * 1024 * 1024) {
      showError(new Error("图片不能超过 2MB，请压缩后再上传"), "上传失败");
      return;
    }
    setLoading(true);
    setError("");
    setErrorNeedsLogin(false);
    setToast({ type: "info", message: "正在上传图片..." });
    try {
      const result = await uploadAsset(kind, file);
      apply(result.fileID, result.tempFileURL || result.displayUrl || "");
      setToast({ type: "success", message: "图片已上传，记得保存当前表单" });
    } catch (err) {
      showError(err, "上传失败");
    } finally {
      setLoading(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setErrorNeedsLogin(false);
    try {
      await loginAdmin(usernameInput.trim(), passwordInput);
      saveAccessKey("");
      setAuthed(true);
    } catch (err) {
      setError(err.message || "登录失败");
      setErrorNeedsLogin(false);
    } finally {
      setLoading(false);
    }
  }

  function resetCredentials() {
    saveToken("");
    saveAccessKey("");
    setPasswordInput("");
    setAuthed(false);
    setData(null);
    setError("");
    setErrorNeedsLogin(false);
  }

  function selectUser(user) {
    setSelectedUser(user);
    setUserDraft(userDraftFrom(user));
    loadUserEvidence(user.id).catch((err) => {
      setToast({ type: "error", message: err.message || "证据链加载失败" });
    });
  }

  function selectCommunity(community) {
    setSelectedCommunity(community);
    setCommunityDraft(communityDraftFrom(community));
  }

  function createCommunity() {
    setSelectedCommunity(null);
    setCommunityDraft(emptyCommunityDraft());
  }

  function createProjectDraft() {
    const defaultCommunityId = !isSuperAdmin && (data?.communities || []).length === 1 ? data.communities[0].id : "";
    setProjectDraft(emptyProjectDraft(defaultCommunityId));
  }

  if (!authed) {
    return (
      <main className="login-shell">
        <form className="login-panel dm-card" onSubmit={login}>
          <img className="login-cat" src={catRub} alt="" />
          <div className="brand-line">
            <img src={logoCutout} alt="" />
            <div>
              <p className="eyebrow">DAIMAO ADMIN</p>
              <h1>呆猫管理后台</h1>
            </div>
          </div>
          {error && <div className="login-error">{error}</div>}
          <Field label="账号">
            <input
              value={usernameInput}
              onChange={(event) => setUsernameInput(event.target.value)}
              placeholder="admin"
              autoFocus
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="后台密码"
            />
          </Field>
          <button className="primary-button" type="submit" disabled={loading}>
            <Lock size={16} />
            进入后台
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-line sidebar-brand">
          <img src={logoCutout} alt="" />
          <h1>呆猫后台</h1>
        </div>
        <nav>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                className={activeTab === tab.key ? "nav-item active" : "nav-item"}
                onClick={() => setActiveTab(tab.key)}
                title={tab.label}
              >
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="top-title">
            <p className="eyebrow">CloudBase SQL Admin</p>
            <h2>{tabs.find((item) => item.key === activeTab)?.label}</h2>
            {adminSession?.role === "community_admin" && <span className="role-pill">社区管理员</span>}
          </div>
          <div className="topbar-actions">
            <div className="searchbox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前视图" />
            </div>
            <button className="icon-button" onClick={refresh} disabled={loading} title="刷新">
              <RefreshCw size={18} />
            </button>
            <button type="button" onClick={resetCredentials} title="退出登录">
              <LogOut size={16} />
              退出
            </button>
          </div>
        </header>

        {error && (
          <div className="notice">
            <pre>{error}</pre>
            {errorNeedsLogin && (
              <button type="button" onClick={resetCredentials}>
                重新登录
              </button>
            )}
          </div>
        )}
        {toast && (
          <div className={`toast toast-${toast.type}`} role="status">
            <CheckCircle2 size={17} />
            <span>{toast.message}</span>
          </div>
        )}
        {loading && !data && <div className="loading">正在加载后台数据...</div>}

        {activeTab === "overview" && (
          <section className="content-grid">
            <div className="hero-strip dm-card">
              <div>
                <p className="eyebrow">运营驾驶舱</p>
                <h2>社区、项目、活动和人，都在同一张地图里。</h2>
              </div>
              <img src={catStretch} alt="" />
            </div>
            <div className="metric-row">
              {stats.map((item) => (
                <div className="metric dm-card" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <em>{item.hint}</em>
                </div>
              ))}
            </div>
            <section className="panel dm-card">
              <h3>官方项目顺序</h3>
                <ProjectTable
                  projects={(data?.projects || [])
                    .filter((item) => item.is_official_recommended)
                    .sort((a, b) => Number(b.official_sort_weight || 0) - Number(a.official_sort_weight || 0))
                    .slice(0, 5)}
                  onEdit={setProjectDraft}
                  communities={data?.communities || []}
                  users={data?.users || []}
                />
            </section>
          </section>
        )}

        {activeTab === "users" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <h3>用户资料与社区认证</h3>
              <UserTable users={filteredUsers} onEdit={selectUser} />
            </section>
            {userDraft && (
              <Modal title="用户编辑" onClose={() => { setSelectedUser(null); setUserDraft(null); }}>
                <UserEditor
              draft={userDraft}
              user={selectedUser}
              communities={data?.communities || []}
              evidence={selectedUserEvidence}
              isSuperAdmin={isSuperAdmin}
              onChange={setUserDraft}
              onUploadAvatar={(file) => upload("user-avatar", file, (fileID, displayUrl) => setUserDraft((draft) => ({ ...draft, avatarUrl: fileID, avatarDisplayUrl: displayUrl })))}
              onSubmit={() =>
                userDraft &&
                run("adminUpdateUser", {
                  userId: userDraft.id,
                  patch: userDraft,
                }, "用户资料已保存").then((ok) => {
                  if (ok) {
                    setSelectedUser(null);
                    setUserDraft(null);
                  }
                })
              }
              onSaveCommunity={(form) =>
                userDraft?.id &&
                form?.communityId &&
                run("adminSaveUserCommunity", {
                  userId: userDraft.id,
                  communityId: form.communityId,
                  tagsText: form.tagsText,
                }, "社区认证已保存")
              }
              onRevokeCommunity={(communityId) =>
                userDraft?.id &&
                run("adminRevokeUserCommunity", {
                  userId: userDraft.id,
                  communityId,
                }, "社区认证已撤销")
              }
              onSaveReferral={(form) =>
                userDraft?.id &&
                run("adminSetUserReferral", {
                  userId: userDraft.id,
                  referrerUserCode: form.referrerUserCode,
                  note: form.note,
                }, form.referrerUserCode ? "引荐绑定已保存" : "引荐绑定已解除")
              }
              onDelete={() => {
                if (!userDraft) return;
                const ok = window.confirm(`确认删除用户「${userDraft.displayName || userDraft.id}」？\n这会禁用账号并移除管理员权限。`);
                if (ok) {
                  run("adminDeleteUser", { userId: userDraft.id }, "用户已禁用");
                  setSelectedUser(null);
                  setUserDraft(null);
                }
              }}
              onSaveEvidence={(evidence) =>
                run("adminUpdateUserEvidence", {
                  evidenceId: evidence.id,
                  evidenceType: evidence.evidence_type,
                  content: evidence.content,
                  confidence: evidence.confidence,
                  status: evidence.status,
                }, "证据已更新，后台正在重新索引").then((ok) => {
                  if (ok) callAdmin("processRagIndexJobs", { limit: 10 }).then(() => {
                    refresh();
                    loadUserEvidence(userDraft.id);
                  }).catch(() => {});
                })
              }
              onArchiveEvidence={(evidenceId) => {
                const ok = window.confirm("确认归档这条证据？归档后不会再用于 AI 审核，但历史记录仍保留。");
                if (ok) run("adminArchiveUserEvidence", { evidenceId }, "证据已归档");
              }}
                />
              </Modal>
            )}
          </section>
        )}

        {activeTab === "communities" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <div className="panel-title-row">
                <h3>社区与徽章</h3>
                {isSuperAdmin && <button onClick={createCommunity}>新建社区</button>}
              </div>
              <CommunityTable communities={filteredCommunities} onEdit={selectCommunity} />
            </section>
            <section className="community-layout">
              <CommunityMembers
                community={selectedCommunity}
                members={communityMembers}
                onCertify={(form) =>
                  selectedCommunity &&
                  run("adminSaveUserCommunity", {
                    userId: form.userId,
                    communityId: selectedCommunity.id,
                    tagsText: form.tagsText,
                  }, "社区成员已认证")
                }
                onRevoke={(userId) =>
                  selectedCommunity &&
                  run("adminRevokeUserCommunity", {
                    userId,
                    communityId: selectedCommunity.id,
                  }, "成员认证已撤销")
                }
                onCreateEvidence={(member) =>
                  setEvidenceDraft({
                    userId: member.id,
                    userName: member.display_name || member.profile?.name || member.id,
                    communityId: selectedCommunity?.id,
                    communityName: selectedCommunity?.name,
                    title: `社区证据：${member.display_name || member.profile?.name || member.id}`,
                    evidenceType: "admin_evidence",
                    confidence: 0.9,
                    content: "",
                    file: null,
                  })
                }
              />
            </section>
            {evidenceDraft && (
              <Modal title="上传社区成员证据" onClose={() => setEvidenceDraft(null)}>
                <CommunityEvidenceEditor
                  draft={evidenceDraft}
                  onChange={setEvidenceDraft}
                  onFile={async (file) => {
                    if (file.size > 5 * 1024 * 1024) {
                      setToast({ type: "error", message: "证据文件不能超过 5MB；建议先提取关键文字再上传。" });
                      return;
                    }
                    const dataUrl = await readFileAsDataUrl(file);
                    setEvidenceDraft((draft) => ({
                      ...draft,
                      file: {
                        filename: file.name,
                        contentType: file.type,
                        dataUrl,
                      },
                    }));
                  }}
                  onSubmit={() =>
                    submitCommunityEvidence()
                  }
                />
              </Modal>
            )}
            {communityDraft && (
              <Modal title={communityDraft.id ? "编辑社区" : "新建社区"} onClose={() => setCommunityDraft(null)}>
                <CommunityEditor
                  draft={communityDraft}
                  readOnly={!isSuperAdmin}
                  onChange={setCommunityDraft}
                  onUpload={(file) => upload("community-logo", file, (fileID, displayUrl) => setCommunityDraft((draft) => ({ ...draft, logoUrl: fileID, logoDisplayUrl: displayUrl })))}
                  onSubmit={() =>
                    communityDraft &&
                    run("adminUpdateCommunity", {
                      communityId: communityDraft.id,
                      patch: communityDraft,
                    }, communityDraft.id ? "社区资料已保存" : "社区已创建").then((ok) => {
                      if (ok) setCommunityDraft(null);
                    })
                  }
                />
              </Modal>
            )}
          </section>
        )}

        {activeTab === "admins" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <div className="panel-title-row">
                <h3>后台管理员</h3>
                <button type="button" onClick={() => setAdminDraft(emptyAdminDraft())}>新建管理员</button>
              </div>
              <AdminAccountTable accounts={data?.adminAccounts || []} communities={data?.communities || []} onEdit={setAdminDraft} />
            </section>
            {adminDraft && (
              <Modal title={adminDraft.id ? "编辑管理员" : "新建管理员"} onClose={() => setAdminDraft(null)}>
                <AdminAccountEditor
                  draft={adminDraft}
                  communities={data?.communities || []}
                  onChange={setAdminDraft}
                  onSubmit={() =>
                    adminDraft &&
                    run("adminUpsertAdminAccount", {
                      accountId: adminDraft.id,
                      patch: adminDraft,
                    }, adminDraft.id ? "管理员账号已保存" : "管理员账号已创建").then((ok) => {
                      if (ok) setAdminDraft(null);
                    })
                  }
                  onDisable={() => {
                    if (!adminDraft?.id) return;
                    const ok = window.confirm(`确认停用管理员「${adminDraft.username}」？`);
                    if (ok) run("adminDeleteAdminAccount", { accountId: adminDraft.id }, "管理员账号已停用").then((saved) => {
                      if (saved) setAdminDraft(null);
                    });
                  }}
                />
              </Modal>
            )}
          </section>
        )}

        {activeTab === "projects" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <div className="panel-title-row">
                <h3>项目管理</h3>
                <button type="button" onClick={createProjectDraft}>新建项目</button>
              </div>
              <ProjectTable projects={filteredProjects} onEdit={setProjectDraft} communities={data?.communities || []} users={data?.users || []} />
            </section>
            {projectDraft && (
              <Modal title={projectDraft.id ? "编辑项目" : "新建项目"} onClose={() => setProjectDraft(null)}>
                <ProjectEditor
                  draft={projectDraft}
                  onChange={setProjectDraft}
                  communities={data?.communities || []}
                  users={data?.users || []}
                  isSuperAdmin={isSuperAdmin}
                  onUpload={(file) => upload("project-cover", file, (fileID, displayUrl) => setProjectDraft((draft) => ({ ...draft, cover_url: fileID, cover_display_url: displayUrl })))}
                  onSubmit={() => {
                    if (!projectDraft) return;
                    const payload = toProjectPatch(projectDraft);
                    if (!payload.communityId && !isSuperAdmin && (data?.communities || []).length === 1) {
                      payload.communityId = data.communities[0].id;
                    }
                    const request = projectDraft.id
                      ? run("adminUpdateProject", { projectId: projectDraft.id, patch: payload }, "项目已保存")
                      : run("adminCreateProject", { project: payload }, "项目已创建");
                    request.then((ok) => {
                      if (ok) setProjectDraft(null);
                    });
                  }}
                />
              </Modal>
            )}
          </section>
        )}

        {activeTab === "events" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <div className="panel-title-row">
                <h3>活动管理</h3>
                <button type="button" onClick={() => setEventDraft(emptyEvent)}>新建活动</button>
              </div>
              <EventTable events={filteredEvents} onEdit={(item) => setEventDraft(fromEventRow(item))} communities={data?.communities || []} />
            </section>
            {eventDraft && (
              <Modal title={eventDraft.id ? "编辑活动" : "发布活动"} onClose={() => setEventDraft(null)}>
                <EventEditor
                  draft={eventDraft}
                  onChange={setEventDraft}
                  communities={data?.communities || []}
                  isSuperAdmin={isSuperAdmin}
                  onUpload={(file) => upload("event-cover", file, (fileID, displayUrl) => setEventDraft((draft) => ({ ...draft, coverUrl: fileID, coverDisplayUrl: displayUrl })))}
                  onSubmit={() => {
                    const payload = toEventPayload(eventDraft);
                    if (!payload.communityId && !isSuperAdmin && (data?.communities || []).length === 1) {
                      payload.communityId = data.communities[0].id;
                    }
                    const request = eventDraft.id
                      ? run("adminUpdateEvent", { eventId: eventDraft.id, event: payload }, "活动已保存")
                      : run("adminCreateEvent", { event: payload }, "活动已发布");
                    request.then((ok) => {
                      if (ok) setEventDraft(null);
                    });
                  }}
                />
              </Modal>
            )}
          </section>
        )}

        {activeTab === "pending" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <div className="panel-title-row">
                <h3>待处理中心</h3>
                <button
                  type="button"
                  onClick={() => run("processRagIndexJobs", { limit: 20 }, "已触发待索引处理")}
                  disabled={loading || !pendingItems.some((item) => item.type === "RAG 索引" && item.status === "pending")}
                >
                  立即处理待索引
                </button>
              </div>
              <PendingTable items={pendingItems} />
            </section>
          </section>
        )}

        {activeTab === "experience" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <h3>经验规则</h3>
              <p className="muted small-muted">
                这里只控制未来发生的动作加多少分；已经写入用户的历史经验不会回滚或重算。等级采用递增曲线，等级越高越难升级。
              </p>
              <ExperienceRuleTable
                rules={data?.experienceRules || []}
                onSave={(rule) =>
                  run("adminUpsertExperienceRule", { rule }, "经验规则已保存")
                }
              />
            </section>
          </section>
        )}

        {activeTab === "rag" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <h3>证据来源</h3>
              <SimpleTable
                rows={data?.ragSources || []}
                columns={[
                  ["id", "ID"],
                  ["source_type", "类型"],
                  ["title", "标题"],
                  ["visibility", "可见性"],
                  ["status", "状态"],
                  ["updated_at", "更新时间", formatDate],
                ]}
              />
            </section>
            <section className="panel dm-card">
              <h3>索引任务</h3>
              <SimpleTable
                rows={data?.ragIndexJobs || []}
                columns={[
                  ["id", "ID"],
                  ["source_id", "Source"],
                  ["job_type", "类型"],
                  ["status", "状态"],
                  ["created_at", "创建时间", formatDate],
                ]}
              />
            </section>
          </section>
        )}

        {activeTab === "logs" && (
          <section className="content-grid">
            <section className="panel dm-card">
              <h3>后台操作日志</h3>
              <AdminLogTable logs={data?.adminLogs || []} users={data?.users || []} />
            </section>
          </section>
        )}
      </section>
    </main>
  );
}

function UserTable({ users, onEdit }) {
  return (
    <table>
      <thead>
        <tr>
          <th>用户</th>
          <th>用户ID</th>
          <th>引荐人</th>
          <th>社区徽章</th>
          <th>经验</th>
          <th>状态</th>
          <th>权限</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {users.length ? users.map((user) => (
          <tr key={user.id}>
            <td>
              <div className="user-cell">
                {assetSrc(user.avatar_display_url, user.avatar_url) ? <img className="avatar" src={assetSrc(user.avatar_display_url, user.avatar_url)} alt="" /> : <span className="avatar text-avatar">{firstText(user.display_name)}</span>}
                <div className="title-stack">
                  <strong>{user.display_name || user.profile?.name || "-"}</strong>
                  <span>{user.profile?.job || user.openid}</span>
                </div>
              </div>
            </td>
            <td><code>{user.public_user_code || String(user.id || "").padStart(3, "0")}</code></td>
            <td>
              {user.referral ? (
                <span>{user.referral.referrer_display_name || user.referral.referrer_profile_name || "未命名"} · {user.referral.referrer_public_user_code || user.referral.referrer_user_id}</span>
              ) : <span className="muted">未绑定</span>}
            </td>
            <td>
              <div className="badge-row">
                {(user.communities || []).slice(0, 3).map((item) => (
                  <Badge tone="yellow" key={`${user.id}-${item.community_id}`}>{item.badgeName || item.communityName}</Badge>
                ))}
              </div>
            </td>
            <td>{user.experience_points || 0}</td>
            <td><Badge tone={user.status === "active" ? "green" : "red"}>{statusLabel(user.status)}</Badge></td>
            <td>{user.is_admin ? <Badge tone="blue">管理员</Badge> : <Badge>用户</Badge>}</td>
            <td><button onClick={() => onEdit(user)}>编辑</button></td>
          </tr>
        )) : (
          <tr><td colSpan="8"><EmptyState title="暂无用户">换个关键词试试，或等待用户注册后再管理。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel dm-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h3>{title}</h3>
          <button type="button" className="icon-button" onClick={onClose} title="关闭">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function UserEditor({
  draft,
  user,
  communities,
  evidence,
  isSuperAdmin,
  onChange,
  onUploadAvatar,
  onSubmit,
  onSaveCommunity,
  onRevokeCommunity,
  onSaveReferral,
  onDelete,
  onSaveEvidence,
  onArchiveEvidence,
}) {
  const [communityForm, setCommunityForm] = useState({ communityId: "", tagsText: "" });
  const [editingEvidenceId, setEditingEvidenceId] = useState(null);
  const [evidenceDraft, setEvidenceDraft] = useState(null);
  if (!draft) {
    return (
      <aside className="panel editor-panel dm-card">
        <h3>用户编辑</h3>
        <p className="muted">选择左侧用户后，可以维护运营侧资料、经验值、社区认证和标签。</p>
      </aside>
    );
  }
  return (
    <div className="editor-panel embedded-editor">
      <div className="editor-title">
        <button className="danger-button" onClick={onDelete}><Trash2 size={15} />删除</button>
      </div>
      <Field label="用户ID">
        <input
          value={draft.publicUserCode || ""}
          disabled={!isSuperAdmin}
          onChange={(event) => onChange({ ...draft, publicUserCode: event.target.value })}
          placeholder="如 001"
        />
        <p className="muted small-muted">
          {isSuperAdmin ? "默认自动生成，修改时会查重。" : "只有超级管理员可以修改用户ID。"}
        </p>
      </Field>
      <Field label="展示名">
        <input value={draft.displayName} onChange={(event) => onChange({ ...draft, displayName: event.target.value })} />
      </Field>
      <Field label="头像">
        <AssetUploadField
          value={draft.avatarUrl}
          displayUrl={draft.avatarDisplayUrl}
          onUpload={onUploadAvatar}
          onClear={() => onChange({ ...draft, avatarUrl: "", avatarDisplayUrl: "" })}
        />
      </Field>
      <Field label="经验值">
        <input type="number" value={draft.experiencePoints} onChange={(event) => onChange({ ...draft, experiencePoints: event.target.value })} />
      </Field>
      <Field label="状态">
        <select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value })}>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={draft.isAdmin} onChange={(event) => onChange({ ...draft, isAdmin: event.target.checked })} />
        管理员账号
      </label>
      <Field label="个人称呼">
        <input value={draft.profileName} onChange={(event) => onChange({ ...draft, profileName: event.target.value })} />
      </Field>
      <Field label="身份/职业">
        <input value={draft.job} onChange={(event) => onChange({ ...draft, job: event.target.value })} />
      </Field>
      <Field label="用户标签">
        <input value={draft.profileTags} onChange={(event) => onChange({ ...draft, profileTags: event.target.value })} placeholder="用空格分隔" />
      </Field>
      <Field label="个人简介（名片公开）">
        <textarea value={draft.intro} onChange={(event) => onChange({ ...draft, intro: event.target.value })} />
      </Field>
      <Field label="用户备注（后台可见）">
        <textarea
          value={draft.adminNote || ""}
          onChange={(event) => onChange({ ...draft, adminNote: event.target.value })}
          placeholder="只给后台管理员看，不会展示给用户，也不会作为公开名片内容。"
        />
      </Field>
      <button className="primary-button" onClick={onSubmit}>保存用户资料</button>
      <div className="editor-divider" />
      <section className="embedded-section">
        <h4>终身引荐绑定</h4>
        <p className="muted small-muted">
          当前引荐人：{user?.referral ? `${user.referral.referrer_display_name || user.referral.referrer_profile_name || "未命名"}（${user.referral.referrer_public_user_code || user.referral.referrer_user_id}）` : "未绑定"}
        </p>
        <Field label="引荐人用户ID">
          <input
            value={draft.referrerUserCode || ""}
            onChange={(event) => onChange({ ...draft, referrerUserCode: event.target.value })}
            placeholder="输入引荐人的用户ID，如 001"
          />
        </Field>
        <Field label="绑定备注">
          <input
            value={draft.referralNote || ""}
            onChange={(event) => onChange({ ...draft, referralNote: event.target.value })}
            placeholder="可记录来源活动、推荐说明等"
          />
        </Field>
        <div className="inline-actions">
          <button type="button" onClick={() => onSaveReferral({ referrerUserCode: draft.referrerUserCode, note: draft.referralNote })}>保存绑定</button>
          <button
            type="button"
            className="danger-button"
            onClick={() => onSaveReferral({ referrerUserCode: "", note: draft.referralNote || "后台解除绑定" })}
          >
            解除绑定
          </button>
        </div>
      </section>
      <div className="editor-divider" />
      <section className="embedded-section">
        <h4>社区认证</h4>
        <div className="cert-list">
          {(user?.communities || []).length ? (user.communities || []).map((item) => (
            <div className="cert-item" key={`${item.community_id}-${item.id || item.communityName}`}>
              <div>
                <strong>{item.communityName || item.badgeName || item.community_id}</strong>
                <span>{(item.tags || []).join(" / ") || "暂无社区标签"}</span>
              </div>
              <button type="button" onClick={() => onRevokeCommunity(item.community_id)}>撤销</button>
            </div>
          )) : <p className="muted small-muted">还没有社区认证。</p>}
        </div>
      </section>
      <Field label="新增认证社区">
        <select value={communityForm.communityId} onChange={(event) => setCommunityForm({ ...communityForm, communityId: event.target.value })}>
          <option value="">选择社区</option>
          {communities.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </Field>
      <Field label="社区称号/能力标签">
        <input value={communityForm.tagsText} onChange={(event) => setCommunityForm({ ...communityForm, tagsText: event.target.value })} placeholder="如 AI产品 需求梳理" />
      </Field>
      <button onClick={() => onSaveCommunity(communityForm)}>保存社区认证</button>
      <div className="editor-divider" />
      <section className="embedded-section">
        <h4>密封证据链</h4>
        {(evidence || []).length ? (
          <div className="evidence-list">
            {(evidence || []).map((item) => {
              const isEditing = Number(editingEvidenceId) === Number(item.id);
              const current = isEditing ? evidenceDraft : item;
              return (
                <div className="evidence-item" key={item.id}>
                  <div className="evidence-meta">
                    <Badge tone={item.status === "confirmed" ? "success" : item.status === "rejected" ? "danger" : "default"}>{statusLabel(item.status)}</Badge>
                    <span>{statusLabel(item.evidence_type)}</span>
                    <span>可信度 {Number(item.confidence || 0).toFixed(2)}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                  {isEditing ? (
                    <>
                      <Field label="证据类型">
                        <select value={current.evidence_type} onChange={(event) => setEvidenceDraft({ ...current, evidence_type: event.target.value })}>
                          <option value="admin_note">管理员备注</option>
                          <option value="admin_interview">管理员访谈</option>
                          <option value="admin_evidence">管理员证据</option>
                          <option value="risk_note">风险备注</option>
                        </select>
                      </Field>
                      <Field label="可信度">
                        <input type="number" min="0" max="1" step="0.01" value={current.confidence} onChange={(event) => setEvidenceDraft({ ...current, confidence: event.target.value })} />
                      </Field>
                      <Field label="状态">
                        <select value={current.status} onChange={(event) => setEvidenceDraft({ ...current, status: event.target.value })}>
                          <option value="confirmed">确认</option>
                          <option value="candidate">候选</option>
                          <option value="rejected">归档/停用</option>
                        </select>
                      </Field>
                      <Field label="证据内容">
                        <textarea value={current.content} onChange={(event) => setEvidenceDraft({ ...current, content: event.target.value })} />
                      </Field>
                      <div className="inline-actions">
                        <button className="primary-button" onClick={() => onSaveEvidence(current).then(() => { setEditingEvidenceId(null); setEvidenceDraft(null); })}>保存证据</button>
                        <button onClick={() => { setEditingEvidenceId(null); setEvidenceDraft(null); }}>取消</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="evidence-content">{item.content}</p>
                      <div className="inline-actions">
                        <button onClick={() => { setEditingEvidenceId(item.id); setEvidenceDraft({ ...item }); }}>编辑</button>
                        {item.status !== "rejected" && <button className="danger-button" onClick={() => onArchiveEvidence(item.id)}>归档</button>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted small-muted">暂无密封证据。可以在社区成员列表里上传。</p>
        )}
      </section>
    </div>
  );
}

function AdminAccountTable({ accounts, communities, onEdit }) {
  const communityMap = new Map((communities || []).map((item) => [Number(item.id), item.name]));
  return (
    <table>
      <thead>
        <tr>
          <th>账号</th>
          <th>角色</th>
          <th>可管理社区</th>
          <th>状态</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {(accounts || []).length ? (accounts || []).map((account) => (
          <tr key={account.id}>
            <td>
              <div className="title-stack">
                <strong>{account.display_name || account.username}</strong>
                <span>{account.username}</span>
              </div>
            </td>
            <td><Badge tone={account.role === "super_admin" ? "blue" : "yellow"}>{account.role === "super_admin" ? "超级管理员" : "社区管理员"}</Badge></td>
            <td>
              <div className="badge-row">
                {account.role === "super_admin" ? <Badge tone="blue">全部社区</Badge> : (account.communityIds || []).map((idValue) => (
                  <Badge key={`${account.id}-${idValue}`}>{communityMap.get(Number(idValue)) || `社区 ${idValue}`}</Badge>
                ))}
              </div>
            </td>
            <td><Badge tone={account.status === "active" ? "green" : "red"}>{statusLabel(account.status)}</Badge></td>
            <td>{formatDate(account.updated_at)}</td>
            <td><button type="button" onClick={() => onEdit({ ...account, password: "" })}>编辑</button></td>
          </tr>
        )) : (
          <tr><td colSpan="6"><EmptyState title="暂无管理员账号">先新建一个社区管理员，绑定可管理社区。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function AdminAccountEditor({ draft, communities, onChange, onSubmit, onDisable }) {
  if (!draft) return null;
  const selected = new Set((draft.communityIds || []).map(Number));
  function toggleCommunity(communityId) {
    const idValue = Number(communityId);
    const next = new Set(selected);
    if (next.has(idValue)) next.delete(idValue);
    else next.add(idValue);
    onChange({ ...draft, communityIds: Array.from(next) });
  }
  return (
    <form
      className="editor-panel embedded-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="editor-title">
        {draft.id && <button className="danger-button" type="button" onClick={onDisable}>停用</button>}
      </div>
      <Field label="登录账号">
        <input value={draft.username || ""} onChange={(event) => onChange({ ...draft, username: event.target.value })} placeholder="例如 opc_admin" />
      </Field>
      <Field label="显示名称">
        <input value={draft.displayName || ""} onChange={(event) => onChange({ ...draft, displayName: event.target.value })} placeholder="例如 OPC 社区管理员" />
      </Field>
      <Field label={draft.id ? "新密码（不改可留空）" : "登录密码"}>
        <input type="password" value={draft.password || ""} onChange={(event) => onChange({ ...draft, password: event.target.value })} placeholder="至少 10 位" />
      </Field>
      <Field label="角色">
        <select value={draft.role || "community_admin"} onChange={(event) => onChange({ ...draft, role: event.target.value })}>
          <option value="community_admin">社区管理员</option>
          <option value="super_admin">超级管理员</option>
        </select>
      </Field>
      <Field label="状态">
        <select value={draft.status || "active"} onChange={(event) => onChange({ ...draft, status: event.target.value })}>
          <option value="active">启用</option>
          <option value="disabled">停用</option>
        </select>
      </Field>
      {draft.role !== "super_admin" && (
        <section className="embedded-section">
          <h4>可管理社区</h4>
          <div className="checkbox-grid">
            {(communities || []).map((community) => (
              <label className="check-row" key={community.id}>
                <input type="checkbox" checked={selected.has(Number(community.id))} onChange={() => toggleCommunity(community.id)} />
                {community.name}
              </label>
            ))}
          </div>
        </section>
      )}
      <button className="primary-button" type="submit">
        {draft.id ? "保存管理员" : "创建管理员"}
      </button>
    </form>
  );
}

function CommunityTable({ communities, onEdit }) {
  return (
    <table>
      <thead>
        <tr>
          <th>社区</th>
          <th>徽章</th>
          <th>状态</th>
          <th>排序</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {communities.length ? communities.map((community) => (
          <tr key={community.id}>
            <td>
              <div className="user-cell">
                {assetSrc(community.logo_display_url, community.logo_url) ? <img className="avatar square-avatar" src={assetSrc(community.logo_display_url, community.logo_url)} alt="" /> : <span className="avatar square-avatar text-avatar">{firstText(community.name, "社")}</span>}
                <div className="title-stack">
                  <strong>{community.name || "-"}</strong>
                  <span>{community.description || "社区资料"}</span>
                </div>
              </div>
            </td>
            <td><Badge tone="yellow">{community.badge_name || "-"}</Badge></td>
            <td><Badge tone={community.status === "active" ? "green" : "red"}>{statusLabel(community.status)}</Badge></td>
            <td>{community.sort_weight || 0}</td>
            <td><button onClick={() => onEdit(community)}>编辑</button></td>
          </tr>
        )) : (
          <tr><td colSpan="5"><EmptyState title="暂无社区">点击「新建社区」创建第一个社区。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function CommunityEditor({ draft, readOnly = false, onChange, onSubmit, onUpload }) {
  if (!draft) {
    return (
      <aside className="panel editor-panel dm-card">
        <h3>社区编辑</h3>
        <p className="muted">选择左侧社区后，可以查看社区名称、徽章、logo 和排序。只有超级管理员可以编辑社区主体资料。</p>
      </aside>
    );
  }
  return (
    <aside className="editor-panel embedded-editor">
      {readOnly && <p className="muted small-muted">社区管理员只能维护本社区成员、活动和证据链；社区主体资料由超级管理员维护。</p>}
      <Field label="社区名称">
        <input disabled={readOnly} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </Field>
      <Field label="徽章名称">
        <input disabled={readOnly} value={draft.badgeName} onChange={(event) => onChange({ ...draft, badgeName: event.target.value })} />
      </Field>
      <Field label="社区说明">
        <textarea disabled={readOnly} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </Field>
      <Field label="社区 logo">
        <AssetUploadField
          value={draft.logoUrl}
          displayUrl={draft.logoDisplayUrl}
          disabled={readOnly}
          onUpload={onUpload}
          onClear={() => onChange({ ...draft, logoUrl: "", logoDisplayUrl: "" })}
        />
      </Field>
      <Field label="状态">
        <select disabled={readOnly} value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value })}>
          <option value="active">启用</option>
          <option value="paused">暂停</option>
          <option value="archived">归档</option>
        </select>
      </Field>
      <Field label="排序权重">
        <input disabled={readOnly} type="number" value={draft.sortWeight} onChange={(event) => onChange({ ...draft, sortWeight: event.target.value })} />
      </Field>
      {!readOnly && <button className="primary-button" onClick={onSubmit}>{draft.id ? "保存社区" : "创建社区"}</button>}
    </aside>
  );
}

function CommunityMembers({ community, members, onCertify, onRevoke, onCreateEvidence }) {
  const [form, setForm] = useState({ userId: "", tagsText: "" });
  const [keyword, setKeyword] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    setForm({ userId: "", tagsText: "" });
    setKeyword("");
    setCandidates([]);
    setSearchError("");
  }, [community?.id]);

  if (!community) {
    return (
      <section className="panel editor-panel dm-card">
        <h3>社区成员</h3>
        <p className="muted">选择一个社区后，可以查看成员、添加认证、上传密封证据。</p>
      </section>
    );
  }
  const activeIds = new Set(members.map((item) => Number(item.id)));
  async function searchUsers() {
    if (!keyword.trim()) {
      setSearchError("请输入姓名、微信号、openid 或用户ID");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const result = await callAdmin("adminSearchUsersForCertification", {
        communityId: community.id,
        keyword: keyword.trim(),
      });
      setCandidates(result.users || []);
    } catch (err) {
      setSearchError(err.message || "搜索失败");
    } finally {
      setSearching(false);
    }
  }
  return (
    <section className="panel editor-panel dm-card">
      <h3>{community.name} · 成员</h3>
      <div className="member-tools">
        <Field label="搜索用户">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="姓名 / 微信号 / 公开用户ID / openid" onKeyDown={(event) => event.key === "Enter" && searchUsers()} />
        </Field>
        <Field label="社区标签">
          <input value={form.tagsText} onChange={(event) => setForm({ ...form, tagsText: event.target.value })} placeholder="如 技术验证 项目推进" />
        </Field>
        <button type="button" onClick={searchUsers} disabled={searching}>{searching ? "搜索中" : "搜索"}</button>
      </div>
      {searchError && <p className="form-error">{searchError}</p>}
      {candidates.length > 0 && (
        <div className="candidate-list">
          {candidates.map((item) => {
            const alreadyActive = activeIds.has(Number(item.id)) || item.membership?.status === "active";
            const name = item.display_name || item.profile?.name || item.openid || item.id;
            return (
              <div className="candidate-card" key={item.id}>
                <div className="title-stack">
                  <strong>{name}</strong>
                  <span>ID {item.public_user_code || String(item.id || "").padStart(3, "0")} · {item.profile?.job || item.profile?.wechat || item.openid || "暂无资料"}</span>
                </div>
                <button
                  type="button"
                  disabled={alreadyActive}
                  onClick={() => {
                    setForm((next) => ({ ...next, userId: item.id }));
                    onCertify({ ...form, userId: item.id });
                  }}
                >
                  {alreadyActive ? "已认证" : "认证进社区"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="member-list">
        {members.length ? members.map((member) => {
          const membership = (member.communities || []).find((item) => Number(item.community_id) === Number(community.id)) || {};
          return (
            <div className="member-card" key={member.id}>
              <div className="user-cell">
                {assetSrc(member.avatar_display_url, member.avatar_url) ? <img className="avatar" src={assetSrc(member.avatar_display_url, member.avatar_url)} alt="" /> : <span className="avatar text-avatar">{firstText(member.display_name || member.profile?.name)}</span>}
                <div className="title-stack">
                  <strong>{member.display_name || member.profile?.name || "-"}</strong>
                  <span>{member.profile?.job || member.openid}</span>
                  <span>{(membership.tags || []).join(" / ") || "暂无社区标签"}</span>
                </div>
              </div>
              <div className="member-actions">
                <button type="button" onClick={() => onCreateEvidence(member)}><FileText size={14} />上传证据</button>
                <button type="button" onClick={() => onRevoke(member.id)}>撤销认证</button>
              </div>
            </div>
          );
        }) : <p className="muted">当前社区还没有 active 成员。</p>}
      </div>
    </section>
  );
}

function CommunityEvidenceEditor({ draft, onChange, onFile, onSubmit }) {
  return (
    <div className="editor-panel embedded-editor">
      <p className="muted">
        给 {draft.userName} 写入 {draft.communityName} 的密封证据。内容会进入 SQL，并生成 RAG 索引任务；AI 召回时只使用正文，元数据不会直接喂给模型。
      </p>
      <Field label="标题">
        <input value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </Field>
      <Field label="证据类型">
        <select value={draft.evidenceType} onChange={(event) => onChange({ ...draft, evidenceType: event.target.value })}>
          <option value="admin_evidence">管理员上传证据</option>
          <option value="admin_interview">管理员访谈记录</option>
          <option value="admin_note">管理员备注</option>
          <option value="risk_note">风险备注</option>
        </select>
      </Field>
      <Field label="可信度">
        <input type="number" min="0" max="1" step="0.01" value={draft.confidence} onChange={(event) => onChange({ ...draft, confidence: event.target.value })} />
      </Field>
      <Field label="文本内容">
        <textarea value={draft.content} onChange={(event) => onChange({ ...draft, content: event.target.value })} placeholder="可以直接粘贴主理人评价、管理员备注、访谈纪要等。" />
      </Field>
      <Field label="上传文本文件">
        <label className="upload-button wide-upload">
          {draft.file?.filename || "选择 txt / md / docx / pdf"}
          <input type="file" accept=".txt,.md,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
        </label>
      </Field>
      <button className="primary-button" onClick={onSubmit}>写入证据并排队索引</button>
    </div>
  );
}

function ProjectTable({ projects, onEdit, communities = [], users = [] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>项目</th>
          <th>社区</th>
          <th>主理人</th>
          <th>状态</th>
          <th>可见性</th>
          <th>官方顺序</th>
          <th>围观</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {projects.length ? projects.map((project) => (
          <tr key={project.id}>
            <td>{project.id}</td>
            <td>
              <div className="title-stack">
                <strong>{project.name}</strong>
                <span>{(project.tags || []).map((item) => `#${item}`).join(" ") || project.stage || "-"}</span>
              </div>
            </td>
            <td>{communityName(communities, project.community_id)}</td>
            <td>{userName(users, project.creator_user_id)}</td>
            <td><Badge tone={project.status === "active" ? "green" : "default"}>{statusLabel(project.status)}</Badge></td>
            <td>{project.visibility}</td>
            <td>{project.is_official_recommended ? <Badge tone="yellow">#{officialDisplayOrder(project.official_sort_weight)}</Badge> : "-"}</td>
            <td>{project.star_count || project.watch_count || 0}</td>
            <td>{formatDate(project.updated_at)}</td>
            <td><button onClick={() => onEdit(project)}>编辑</button></td>
          </tr>
        )) : (
          <tr><td colSpan="10"><EmptyState title="暂无项目">发布或同步项目后会显示在这里。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function UploadButton({ onUpload }) {
  return (
    <label className="upload-button">
      上传图片
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
    </label>
  );
}

function AssetUploadField({ value, displayUrl, onUpload, onClear, disabled = false }) {
  const preview = assetSrc(displayUrl, value);
  return (
    <div className="asset-upload-field">
      {preview ? (
        <img className="asset-preview" src={preview} alt="" />
      ) : (
        <div className="asset-placeholder">暂无图片</div>
      )}
      <div className="asset-upload-actions">
        <span>{assetStatusText(value)}</span>
        {!disabled && (
          <div className="inline-actions">
            <UploadButton onUpload={onUpload} />
            {value && <button type="button" onClick={onClear}>清除</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectEditor({ draft, onChange, onSubmit, onUpload, communities = [], users = [], isSuperAdmin = false }) {
  if (!draft) {
    return (
      <aside className="panel editor-panel dm-card">
        <h3>项目编辑</h3>
        <p className="muted">官方推荐项会优先展示；排序建议只填 1-5，数值越小越靠前。</p>
      </aside>
    );
  }
  return (
    <aside className="editor-panel embedded-editor">
      <Field label="项目名称">
        <input value={draft.name || ""} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </Field>
      <Field label="归属社区">
        <select value={draft.community_id || draft.communityId || ""} onChange={(event) => onChange({ ...draft, community_id: event.target.value })}>
          {isSuperAdmin && <option value="">平台官方 / 不绑定社区</option>}
          {!isSuperAdmin && <option value="">请选择社区</option>}
          {communities.map((community) => (
            <option key={community.id} value={community.id}>{community.name}</option>
          ))}
        </select>
      </Field>
      <Field label="项目主理人">
        <select value={draft.creator_user_id || draft.creatorUserId || ""} onChange={(event) => onChange({ ...draft, creator_user_id: event.target.value })}>
          <option value="">请选择主理人</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.profile?.name || user.display_name || user.openid || user.id}</option>
          ))}
        </select>
      </Field>
      <Field label="项目封面">
        <AssetUploadField
          value={draft.cover_url || draft.coverUrl || ""}
          displayUrl={draft.cover_display_url || draft.coverDisplayUrl || ""}
          onUpload={onUpload}
          onClear={() => onChange({ ...draft, cover_url: "", coverUrl: "", cover_display_url: "", coverDisplayUrl: "" })}
        />
      </Field>
      <Field label="阶段">
        <input value={draft.stage || ""} onChange={(event) => onChange({ ...draft, stage: event.target.value })} />
      </Field>
      <Field label="标签">
        <input value={draft.tagsText || (draft.tags || []).join(" ")} onChange={(event) => onChange({ ...draft, tagsText: event.target.value })} placeholder="AI 销售 SaaS" />
      </Field>
      <Field label="状态">
        <select value={draft.status || "draft"} onChange={(event) => onChange({ ...draft, status: event.target.value })}>
          <option value="draft">草稿</option>
          <option value="active">进行中</option>
          <option value="paused">暂停</option>
          <option value="completed">已完成</option>
          <option value="archived">归档</option>
        </select>
      </Field>
      <Field label="可见性">
        <select value={draft.visibility || "private"} onChange={(event) => onChange({ ...draft, visibility: event.target.value })}>
          <option value="public">公开</option>
          <option value="private">私有</option>
        </select>
      </Field>
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!draft.is_official_recommended}
          onChange={(event) => onChange({ ...draft, is_official_recommended: event.target.checked ? 1 : 0, official_sort_weight: draft.official_sort_weight || officialWeightFromOrder(1) })}
        />
        官方推荐
      </label>
      <Field label="官方展示顺序">
        <input
          min="1"
          max="5"
          type="number"
          value={officialDisplayOrder(draft.official_sort_weight)}
          onChange={(event) => onChange({ ...draft, official_sort_weight: officialWeightFromOrder(event.target.value) })}
        />
      </Field>
      <Field label="目标">
        <textarea value={draft.goal || ""} onChange={(event) => onChange({ ...draft, goal: event.target.value })} />
      </Field>
      <Field label="项目说明">
        <textarea value={draft.description || ""} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </Field>
      <button className="primary-button" onClick={onSubmit}>保存项目</button>
    </aside>
  );
}

function EventTable({ events, onEdit, communities = [] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>活动</th>
          <th>社区</th>
          <th>时间</th>
          <th>地点</th>
          <th>状态</th>
          <th>容量</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {events.length ? events.map((event) => (
          <tr key={event.id}>
            <td>{event.id}</td>
            <td>
              <div className="title-stack">
                <strong>{event.title}</strong>
                <span>{event.event_type}</span>
              </div>
            </td>
            <td>{communityName(communities, event.community_id)}</td>
            <td>{formatDate(event.start_time)}</td>
            <td>{event.location || "-"}</td>
            <td><Badge tone={event.status === "published" ? "green" : "default"}>{statusLabel(event.status)}</Badge></td>
            <td>{event.capacity || "-"}</td>
            <td><button onClick={() => onEdit(event)}>编辑</button></td>
          </tr>
        )) : (
          <tr><td colSpan="8"><EmptyState title="暂无活动">创建活动后会显示在这里。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function EventEditor({ draft, onChange, onSubmit, onUpload, communities = [], isSuperAdmin = false }) {
  return (
    <aside className="editor-panel embedded-editor">
      <Field label="标题">
        <input value={draft.title || ""} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </Field>
      <Field label="归属社区">
        <select value={draft.communityId || draft.community_id || ""} onChange={(event) => onChange({ ...draft, communityId: event.target.value })}>
          {isSuperAdmin && <option value="">平台官方 / 不绑定社区</option>}
          {!isSuperAdmin && <option value="">请选择社区</option>}
          {communities.map((community) => (
            <option key={community.id} value={community.id}>{community.name}</option>
          ))}
        </select>
      </Field>
      <Field label="活动封面">
        <AssetUploadField
          value={draft.coverUrl || ""}
          displayUrl={draft.coverDisplayUrl || ""}
          onUpload={onUpload}
          onClear={() => onChange({ ...draft, coverUrl: "", coverDisplayUrl: "" })}
        />
      </Field>
      <Field label="类型">
        <select value={draft.eventType || "offline_meeting"} onChange={(event) => onChange({ ...draft, eventType: event.target.value })}>
          <option value="offline_meeting">线下会面</option>
          <option value="project_review">项目评审</option>
          <option value="closed_door_session">闭门会</option>
          <option value="workshop">工作坊</option>
          <option value="demo_day">Demo Day</option>
          <option value="networking">社交活动</option>
          <option value="other">其他</option>
        </select>
      </Field>
      <Field label="开始时间">
        <input type="datetime-local" value={draft.startTime || ""} onChange={(event) => onChange({ ...draft, startTime: event.target.value })} />
      </Field>
      <Field label="结束时间">
        <input type="datetime-local" value={draft.endTime || ""} onChange={(event) => onChange({ ...draft, endTime: event.target.value })} />
      </Field>
      <Field label="地点">
        <input value={draft.location || ""} onChange={(event) => onChange({ ...draft, location: event.target.value })} />
      </Field>
      <Field label="状态">
        <select value={draft.status || "published"} onChange={(event) => onChange({ ...draft, status: event.target.value })}>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="closed">已关闭</option>
          <option value="cancelled">已取消</option>
          <option value="completed">已完成</option>
        </select>
      </Field>
      <Field label="容量">
        <input type="number" value={draft.capacity || ""} onChange={(event) => onChange({ ...draft, capacity: event.target.value })} />
      </Field>
      <Field label="介绍">
        <textarea value={draft.description || ""} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
      </Field>
      <button className="primary-button" onClick={onSubmit}>{draft.id ? "保存活动" : "发布活动"}</button>
    </aside>
  );
}

function PendingTable({ items }) {
  return (
    <table>
      <thead>
        <tr>
          <th>类型</th>
          <th>对象</th>
          <th>状态</th>
          <th>说明</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        {items.length ? items.map((item) => (
          <tr key={item.id}>
            <td>{item.type}</td>
            <td>{item.title}</td>
            <td><Badge tone={item.status === "failed" ? "red" : "yellow"}>{statusLabel(item.status)}</Badge></td>
            <td className="muted-cell">{String(item.hint || "-").slice(0, 120)}</td>
            <td>{formatDate(item.created_at)}</td>
          </tr>
        )) : (
          <tr><td colSpan="5"><EmptyState title="暂无待处理事项">没有待审核申请、候选证据或待索引任务。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function ExperienceRuleTable({ rules, onSave }) {
  const [editingKey, setEditingKey] = useState("");
  const [draft, setDraft] = useState(null);
  const sorted = [...(rules || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  function startEdit(rule) {
    setEditingKey(rule.rule_key);
    setDraft({
      ruleKey: rule.rule_key,
      label: rule.label || "",
      description: rule.description || "",
      points: Number(rule.points || 0),
      status: rule.status || "active",
      sortOrder: Number(rule.sort_order || 0),
    });
  }

  function cancelEdit() {
    setEditingKey("");
    setDraft(null);
  }

  return (
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>说明</th>
          <th>分值</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {sorted.length ? sorted.map((rule) => {
          const isEditing = editingKey === rule.rule_key && draft;
          return (
            <tr key={rule.rule_key}>
              <td>
                {isEditing ? (
                  <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
                ) : (
                  <div className="title-stack">
                    <strong>{rule.label}</strong>
                    <span>{rule.rule_key}</span>
                  </div>
                )}
              </td>
              <td className="muted-cell">
                {isEditing ? (
                  <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                ) : (
                  rule.description || "-"
                )}
              </td>
              <td>
                {isEditing ? (
                  <input type="number" value={draft.points} onChange={(event) => setDraft({ ...draft, points: event.target.value })} />
                ) : (
                  `+${rule.points || 0}`
                )}
              </td>
              <td>
                {isEditing ? (
                  <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                  </select>
                ) : (
                  <Badge tone={rule.status === "active" ? "green" : "red"}>{statusLabel(rule.status)}</Badge>
                )}
              </td>
              <td>
                {isEditing ? (
                  <div className="inline-actions">
                    <button type="button" onClick={() => onSave(draft).then(cancelEdit)}>保存</button>
                    <button type="button" onClick={cancelEdit}>取消</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => startEdit(rule)}>编辑</button>
                )}
              </td>
            </tr>
          );
        }) : (
          <tr><td colSpan="5"><EmptyState title="暂无经验规则">请先执行经验规则迁移。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function AdminLogTable({ logs, users }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>管理员</th>
          <th>动作</th>
          <th>对象</th>
          <th>详情</th>
          <th>时间</th>
        </tr>
      </thead>
      <tbody>
        {logs.length ? logs.map((log) => (
          <tr key={log.id}>
            <td>{log.id}</td>
            <td>{userName(users, log.admin_user_id)}</td>
            <td>{log.action}</td>
            <td>{log.target_type} #{log.target_id || "-"}</td>
            <td className="muted-cell">{JSON.stringify(log.detail_json || {}).slice(0, 160)}</td>
            <td>{formatDate(log.created_at)}</td>
          </tr>
        )) : (
          <tr><td colSpan="6"><EmptyState title="暂无操作日志">后台操作后会记录在这里。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function SimpleTable({ rows, columns }) {
  return (
    <table>
      <thead>
        <tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row) => (
          <tr key={row.id}>
            {columns.map(([key, label, format]) => <td key={label}>{format ? format(row[key]) : String(row[key] || "-")}</td>)}
          </tr>
        )) : (
          <tr><td colSpan={columns.length}><EmptyState title="暂无数据">这里还没有可展示的记录。</EmptyState></td></tr>
        )}
      </tbody>
    </table>
  );
}

function fromEventRow(row) {
  return {
    id: row.id,
    title: row.title || "",
    description: row.description || "",
    eventType: row.event_type || "other",
    location: row.location || "",
    startTime: dateInputValue(row.start_time),
    endTime: dateInputValue(row.end_time),
    status: row.status || "published",
    visibility: row.visibility || "public",
    officialSortWeight: row.official_sort_weight || 0,
    capacity: row.capacity || "",
    coverUrl: row.cover_url || "",
    coverDisplayUrl: row.cover_display_url || "",
    communityId: row.community_id || "",
  };
}

function toEventPayload(draft) {
  return {
    title: draft.title,
    description: draft.description,
    eventType: draft.eventType,
    location: draft.location,
    startTime: draft.startTime,
    endTime: draft.endTime,
    status: draft.status,
    visibility: draft.visibility,
    officialSortWeight: Number(draft.officialSortWeight || 0),
    capacity: draft.capacity ? Number(draft.capacity) : null,
    coverUrl: draft.coverUrl || "",
    communityId: draft.communityId || draft.community_id || null,
  };
}

function toProjectPatch(draft) {
  return {
    name: draft.name,
    description: draft.description || "",
    stage: draft.stage,
    status: draft.status,
    visibility: draft.visibility,
    isOfficialRecommended: !!draft.is_official_recommended,
    officialSortWeight: Number(draft.official_sort_weight || officialWeightFromOrder(1)),
    goal: draft.goal,
    tagsText: draft.tagsText || (draft.tags || []).join(" "),
    creatorUserId: draft.creator_user_id || draft.creatorUserId || null,
    coverUrl: draft.cover_url || draft.coverUrl || "",
    communityId: draft.community_id || draft.communityId || null,
  };
}
