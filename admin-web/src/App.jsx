import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  Database,
  Lock,
  RefreshCw,
  Search,
  Shield,
  Star,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { callAdmin, hasToken, saveAccessKey, saveToken, uploadAsset } from "./api";
import logoCutout from "./assets/logo-cutout.png";
import catRub from "./assets/cat-rub-cutout.png";
import catStretch from "./assets/cat-stretch-cutout.png";

const tabs = [
  { key: "overview", label: "概览", icon: Activity },
  { key: "users", label: "用户", icon: Users },
  { key: "projects", label: "项目", icon: Database },
  { key: "events", label: "活动", icon: CalendarDays },
  { key: "rag", label: "RAG", icon: Search },
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
};

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
  };
  return labels[value] || value || "-";
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

function firstText(value, fallback = "猫") {
  return String(value || fallback).trim().slice(0, 1);
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
    displayName: user?.display_name || "",
    avatarUrl: user?.avatar_url || profile.avatar_url || "",
    status: user?.status || "active",
    isAdmin: !!user?.is_admin,
    experiencePoints: Number(user?.experience_points || 0),
    profileName: profile.name || "",
    job: profile.job || "",
    wechat: profile.wechat || "",
    intro: profile.intro || "",
    profileTags: (profile.tags || []).join(" "),
    communityId: user?.communities?.[0]?.community_id || "",
    communityTags: (user?.communities?.[0]?.tags || []).join(" "),
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(hasToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDraft, setUserDraft] = useState(null);
  const [projectDraft, setProjectDraft] = useState(null);
  const [eventDraft, setEventDraft] = useState(emptyEvent);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const payload = await callAdmin("adminList");
      setData(payload);
      if (selectedUser) {
        const next = (payload.users || []).find((item) => Number(item.id) === Number(selectedUser.id));
        if (next) {
          setSelectedUser(next);
          setUserDraft(userDraftFrom(next));
        }
      }
    } catch (err) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) refresh();
  }, [authed]);

  const stats = useMemo(() => {
    const users = data?.users || [];
    const projects = data?.projects || [];
    const events = data?.events || [];
    const communities = data?.communities || [];
    return [
      { label: "活跃用户", value: users.filter((item) => item.status === "active").length, hint: `${users.length} 总用户` },
      { label: "认证社区", value: communities.filter((item) => item.status !== "disabled").length, hint: "徽章与称号" },
      { label: "官方项目", value: projects.filter((item) => item.is_official_recommended).length, hint: "前 5 位展示" },
      { label: "活动", value: events.filter((item) => item.status === "published").length, hint: `${events.length} 总活动` },
    ];
  }, [data]);

  const filteredUsers = (data?.users || []).filter((item) =>
    [item.display_name, item.openid, item.id, item.profile?.name, item.profile?.job].some((value) => String(value || "").includes(query))
  );
  const filteredProjects = (data?.projects || []).filter((item) =>
    [item.name, item.status, item.visibility, item.stage].some((value) => String(value || "").includes(query))
  );
  const filteredEvents = (data?.events || []).filter((item) =>
    [item.title, item.location, item.status].some((value) => String(value || "").includes(query))
  );

  async function run(action, payload) {
    setLoading(true);
    setError("");
    try {
      await callAdmin(action, payload);
      await refresh();
    } catch (err) {
      setError(err.message || "操作失败");
      setLoading(false);
    }
  }

  async function upload(kind, file, apply) {
    setLoading(true);
    setError("");
    try {
      const result = await uploadAsset(kind, file);
      apply(result.fileID);
    } catch (err) {
      setError(err.message || "上传失败");
    } finally {
      setLoading(false);
    }
  }

  function login(event) {
    event.preventDefault();
    saveToken(tokenInput.trim());
    saveAccessKey("");
    setAuthed(true);
  }

  function resetCredentials() {
    saveToken("");
    saveAccessKey("");
    setTokenInput("");
    setAuthed(false);
    setData(null);
    setError("");
  }

  function selectUser(user) {
    setSelectedUser(user);
    setUserDraft(userDraftFrom(user));
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
          <Field label="后台访问令牌">
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="ADMIN_WEB_TOKEN"
              autoFocus
            />
          </Field>
          <button className="primary-button" type="submit">
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
          {tabs.map((tab) => {
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
          </div>
          <div className="topbar-actions">
            <div className="searchbox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前视图" />
            </div>
            <button className="icon-button" onClick={refresh} disabled={loading} title="刷新">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="notice">
            <pre>{error}</pre>
            <button type="button" onClick={resetCredentials}>
              重新配置
            </button>
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
                />
            </section>
          </section>
        )}

        {activeTab === "users" && (
          <section className="split-view user-view">
            <section className="panel dm-card">
              <h3>用户资料与社区认证</h3>
              <UserTable users={filteredUsers} onEdit={selectUser} />
            </section>
            <UserEditor
              draft={userDraft}
              communities={data?.communities || []}
              onChange={setUserDraft}
              onSubmit={() =>
                userDraft &&
                run("adminUpdateUser", {
                  userId: userDraft.id,
                  patch: userDraft,
                })
              }
              onSaveCommunity={() =>
                userDraft?.communityId &&
                run("adminSaveUserCommunity", {
                  userId: userDraft.id,
                  communityId: userDraft.communityId,
                  tagsText: userDraft.communityTags,
                })
              }
              onDelete={() => {
                if (!userDraft) return;
                const ok = window.confirm(`确认删除用户「${userDraft.displayName || userDraft.id}」？\n这会禁用账号并移除管理员权限。`);
                if (ok) run("adminDeleteUser", { userId: userDraft.id });
              }}
            />
          </section>
        )}

        {activeTab === "projects" && (
          <section className="split-view">
            <section className="panel dm-card">
              <h3>项目管理</h3>
              <ProjectTable projects={filteredProjects} onEdit={setProjectDraft} />
            </section>
            <ProjectEditor
              draft={projectDraft}
              onChange={setProjectDraft}
              onUpload={(file) => upload("project-cover", file, (fileID) => setProjectDraft((draft) => ({ ...draft, cover_url: fileID })))}
              onSubmit={() => projectDraft && run("adminUpdateProject", { projectId: projectDraft.id, patch: toProjectPatch(projectDraft) })}
            />
          </section>
        )}

        {activeTab === "events" && (
          <section className="split-view">
            <section className="panel dm-card">
              <h3>活动管理</h3>
              <EventTable events={filteredEvents} onEdit={(item) => setEventDraft(fromEventRow(item))} />
            </section>
            <EventEditor
              draft={eventDraft}
              onChange={setEventDraft}
              onUpload={(file) => upload("event-cover", file, (fileID) => setEventDraft((draft) => ({ ...draft, coverUrl: fileID })))}
              onSubmit={() => {
                const payload = toEventPayload(eventDraft);
                if (eventDraft.id) run("adminUpdateEvent", { eventId: eventDraft.id, event: payload });
                else run("adminCreateEvent", { event: payload });
              }}
              onNew={() => setEventDraft(emptyEvent)}
            />
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
      </section>
    </main>
  );
}

function UserTable({ users, onEdit }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>用户</th>
          <th>社区徽章</th>
          <th>经验</th>
          <th>状态</th>
          <th>权限</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.id}</td>
            <td>
              <div className="user-cell">
                {user.avatar_url ? <img className="avatar" src={user.avatar_url} alt="" /> : <span className="avatar text-avatar">{firstText(user.display_name)}</span>}
                <div className="title-stack">
                  <strong>{user.display_name || user.profile?.name || "-"}</strong>
                  <span>{user.profile?.job || user.openid}</span>
                </div>
              </div>
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
        ))}
      </tbody>
    </table>
  );
}

function UserEditor({ draft, communities, onChange, onSubmit, onSaveCommunity, onDelete }) {
  if (!draft) {
    return (
      <aside className="panel editor-panel dm-card">
        <h3>用户编辑</h3>
        <p className="muted">选择左侧用户后，可以维护运营侧资料、经验值、社区认证和标签。</p>
      </aside>
    );
  }
  return (
    <aside className="panel editor-panel dm-card">
      <div className="editor-title">
        <h3>用户编辑</h3>
        <button className="danger-button" onClick={onDelete}><Trash2 size={15} />删除</button>
      </div>
      <Field label="展示名">
        <input value={draft.displayName} onChange={(event) => onChange({ ...draft, displayName: event.target.value })} />
      </Field>
      <Field label="头像 URL / cloud fileID">
        <input value={draft.avatarUrl} onChange={(event) => onChange({ ...draft, avatarUrl: event.target.value })} />
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
      <Field label="运营标签">
        <input value={draft.profileTags} onChange={(event) => onChange({ ...draft, profileTags: event.target.value })} placeholder="用空格分隔" />
      </Field>
      <Field label="运营备注">
        <textarea value={draft.intro} onChange={(event) => onChange({ ...draft, intro: event.target.value })} />
      </Field>
      <button className="primary-button" onClick={onSubmit}>保存用户资料</button>
      <div className="editor-divider" />
      <Field label="认证社区">
        <select value={draft.communityId} onChange={(event) => onChange({ ...draft, communityId: event.target.value })}>
          <option value="">选择社区</option>
          {communities.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </Field>
      <Field label="社区称号/能力标签">
        <input value={draft.communityTags} onChange={(event) => onChange({ ...draft, communityTags: event.target.value })} placeholder="如 AI产品 需求梳理" />
      </Field>
      <button onClick={onSaveCommunity}>保存社区认证</button>
    </aside>
  );
}

function ProjectTable({ projects, onEdit }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>项目</th>
          <th>状态</th>
          <th>可见性</th>
          <th>官方顺序</th>
          <th>围观</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {projects.map((project) => (
          <tr key={project.id}>
            <td>{project.id}</td>
            <td>
              <div className="title-stack">
                <strong>{project.name}</strong>
                <span>{(project.tags || []).map((item) => `#${item}`).join(" ") || project.stage || "-"}</span>
              </div>
            </td>
            <td><Badge tone={project.status === "active" ? "green" : "default"}>{statusLabel(project.status)}</Badge></td>
            <td>{project.visibility}</td>
            <td>{project.is_official_recommended ? <Badge tone="yellow">#{officialDisplayOrder(project.official_sort_weight)}</Badge> : "-"}</td>
            <td>{project.star_count || project.watch_count || 0}</td>
            <td>{formatDate(project.updated_at)}</td>
            <td><button onClick={() => onEdit(project)}>编辑</button></td>
          </tr>
        ))}
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

function ProjectEditor({ draft, onChange, onSubmit, onUpload }) {
  if (!draft) {
    return (
      <aside className="panel editor-panel dm-card">
        <h3>项目编辑</h3>
        <p className="muted">官方推荐项会优先展示；排序建议只填 1-5，数值越小越靠前。</p>
      </aside>
    );
  }
  return (
    <aside className="panel editor-panel dm-card">
      <h3>项目编辑</h3>
      <Field label="项目名称">
        <input value={draft.name || ""} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </Field>
      <Field label="封面 URL / cloud fileID">
        <div className="asset-row">
          <input value={draft.cover_url || draft.coverUrl || ""} onChange={(event) => onChange({ ...draft, cover_url: event.target.value })} placeholder="cloud://..." />
          <UploadButton onUpload={onUpload} />
        </div>
      </Field>
      <Field label="阶段">
        <input value={draft.stage || ""} onChange={(event) => onChange({ ...draft, stage: event.target.value })} />
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
      <button className="primary-button" onClick={onSubmit}>保存项目</button>
    </aside>
  );
}

function EventTable({ events, onEdit }) {
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>活动</th>
          <th>时间</th>
          <th>地点</th>
          <th>状态</th>
          <th>容量</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <td>{event.id}</td>
            <td>
              <div className="title-stack">
                <strong>{event.title}</strong>
                <span>{event.event_type}</span>
              </div>
            </td>
            <td>{formatDate(event.start_time)}</td>
            <td>{event.location || "-"}</td>
            <td><Badge tone={event.status === "published" ? "green" : "default"}>{statusLabel(event.status)}</Badge></td>
            <td>{event.capacity || "-"}</td>
            <td><button onClick={() => onEdit(event)}>编辑</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventEditor({ draft, onChange, onSubmit, onNew, onUpload }) {
  return (
    <aside className="panel editor-panel dm-card">
      <div className="editor-title">
        <h3>{draft.id ? "活动编辑" : "发布活动"}</h3>
        <button onClick={onNew}>新建</button>
      </div>
      <Field label="标题">
        <input value={draft.title || ""} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
      </Field>
      <Field label="封面 URL / cloud fileID">
        <div className="asset-row">
          <input value={draft.coverUrl || ""} onChange={(event) => onChange({ ...draft, coverUrl: event.target.value })} placeholder="cloud://..." />
          <UploadButton onUpload={onUpload} />
        </div>
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

function SimpleTable({ rows, columns }) {
  return (
    <table>
      <thead>
        <tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map(([key, label, format]) => <td key={label}>{format ? format(row[key]) : String(row[key] || "-")}</td>)}
          </tr>
        ))}
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
  };
}

function toProjectPatch(draft) {
  return {
    name: draft.name,
    stage: draft.stage,
    status: draft.status,
    visibility: draft.visibility,
    isOfficialRecommended: !!draft.is_official_recommended,
    officialSortWeight: Number(draft.official_sort_weight || officialWeightFromOrder(1)),
    goal: draft.goal,
    coverUrl: draft.cover_url || draft.coverUrl || "",
  };
}
