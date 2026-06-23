import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  Database,
  Lock,
  RefreshCw,
  Search,
  Shield,
  UserRound,
  Users,
} from "lucide-react";
import { callAdmin, hasToken, saveToken } from "./api";

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

export default function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(hasToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [projectDraft, setProjectDraft] = useState(null);
  const [eventDraft, setEventDraft] = useState(emptyEvent);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const payload = await callAdmin("adminList");
      setData(payload);
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
    const ragJobs = data?.ragIndexJobs || [];
    return [
      { label: "用户", value: users.length, hint: `${users.filter((item) => item.status === "active").length} 启用` },
      { label: "项目", value: projects.length, hint: `${projects.filter((item) => item.status === "active").length} 进行中` },
      { label: "活动", value: events.length, hint: `${events.filter((item) => item.status === "published").length} 已发布` },
      { label: "RAG 任务", value: ragJobs.length, hint: `${ragJobs.filter((item) => item.status === "failed").length} 失败` },
    ];
  }, [data]);

  const filteredUsers = (data?.users || []).filter((item) =>
    [item.display_name, item.openid, item.id].some((value) => String(value || "").includes(query))
  );
  const filteredProjects = (data?.projects || []).filter((item) =>
    [item.name, item.status, item.visibility].some((value) => String(value || "").includes(query))
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

  function login(event) {
    event.preventDefault();
    saveToken(tokenInput.trim());
    setAuthed(true);
  }

  if (!authed) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={login}>
          <div className="brand-line">
            <Shield size={24} />
            <h1>呆猫管理后台</h1>
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
        <div className="brand-line">
          <Shield size={22} />
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
          <div>
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

        {error && <div className="notice">{error}</div>}
        {loading && !data && <div className="loading">正在加载后台数据...</div>}

        {activeTab === "overview" && (
          <section className="content-grid">
            <div className="metric-row">
              {stats.map((item) => (
                <div className="metric" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <em>{item.hint}</em>
                </div>
              ))}
            </div>
            <section className="panel">
              <h3>近期项目</h3>
              <ProjectTable projects={(data?.projects || []).slice(0, 8)} onEdit={setProjectDraft} />
            </section>
            <section className="panel">
              <h3>近期活动</h3>
              <EventTable
                events={(data?.events || []).slice(0, 8)}
                onEdit={(item) => setEventDraft(fromEventRow(item))}
              />
            </section>
          </section>
        )}

        {activeTab === "users" && (
          <section className="panel">
            <h3>用户权限</h3>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>昵称</th>
                  <th>OpenID</th>
                  <th>经验值</th>
                  <th>状态</th>
                  <th>管理员</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.id}</td>
                    <td className="strong-cell">
                      <UserRound size={15} />
                      {user.display_name || "-"}
                    </td>
                    <td className="mono">{user.openid}</td>
                    <td>{user.experience_points || 0}</td>
                    <td>
                      <Badge tone={user.status === "active" ? "green" : "red"}>{statusLabel(user.status)}</Badge>
                    </td>
                    <td>{user.is_admin ? <Badge tone="blue">管理员</Badge> : <Badge>普通用户</Badge>}</td>
                    <td>{formatDate(user.created_at)}</td>
                    <td className="actions">
                      <button onClick={() => run("adminSetUserStatus", { userId: user.id, status: user.status === "active" ? "disabled" : "active" })}>
                        {user.status === "active" ? "禁用" : "启用"}
                      </button>
                      <button onClick={() => run("adminSetUserAdmin", { userId: user.id, isAdmin: !user.is_admin })}>
                        {user.is_admin ? "移除管理" : "设为管理"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === "projects" && (
          <section className="split-view">
            <section className="panel">
              <h3>项目管理</h3>
              <ProjectTable projects={filteredProjects} onEdit={setProjectDraft} />
            </section>
            <ProjectEditor
              draft={projectDraft}
              onChange={setProjectDraft}
              onSubmit={() => projectDraft && run("adminUpdateProject", { projectId: projectDraft.id, patch: toProjectPatch(projectDraft) })}
            />
          </section>
        )}

        {activeTab === "events" && (
          <section className="split-view">
            <section className="panel">
              <h3>活动管理</h3>
              <EventTable events={filteredEvents} onEdit={(item) => setEventDraft(fromEventRow(item))} />
            </section>
            <EventEditor
              draft={eventDraft}
              onChange={setEventDraft}
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
            <section className="panel">
              <h3>证据来源</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>类型</th>
                    <th>标题</th>
                    <th>可见性</th>
                    <th>状态</th>
                    <th>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.ragSources || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.source_type}</td>
                      <td>{item.title}</td>
                      <td>{item.visibility}</td>
                      <td><Badge tone={item.status === "failed" ? "red" : "green"}>{statusLabel(item.status)}</Badge></td>
                      <td>{formatDate(item.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <h3>索引任务</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Source</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.ragIndexJobs || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.source_id}</td>
                      <td>{item.job_type}</td>
                      <td><Badge tone={item.status === "failed" ? "red" : "blue"}>{statusLabel(item.status)}</Badge></td>
                      <td>{formatDate(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        )}
      </section>
    </main>
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
          <th>推荐</th>
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
                <span>{project.stage || "-"}</span>
              </div>
            </td>
            <td><Badge tone={project.status === "active" ? "green" : "default"}>{statusLabel(project.status)}</Badge></td>
            <td>{project.visibility}</td>
            <td>{project.is_official_recommended ? "是" : "否"} / {project.official_sort_weight || 0}</td>
            <td>{project.star_count || project.watch_count || 0}</td>
            <td>{formatDate(project.updated_at)}</td>
            <td><button onClick={() => onEdit(project)}>编辑</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProjectEditor({ draft, onChange, onSubmit }) {
  if (!draft) {
    return (
      <aside className="panel editor-panel">
        <h3>项目编辑</h3>
        <p className="muted">选择左侧项目后维护发布状态、推荐权重和基础信息。</p>
      </aside>
    );
  }
  return (
    <aside className="panel editor-panel">
      <h3>项目编辑</h3>
      <Field label="项目名称">
        <input value={draft.name || ""} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
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
          onChange={(event) => onChange({ ...draft, is_official_recommended: event.target.checked ? 1 : 0 })}
        />
        官方推荐
      </label>
      <Field label="推荐权重">
        <input type="number" value={draft.official_sort_weight || 0} onChange={(event) => onChange({ ...draft, official_sort_weight: event.target.value })} />
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

function EventEditor({ draft, onChange, onSubmit, onNew }) {
  return (
    <aside className="panel editor-panel">
      <div className="editor-title">
        <h3>{draft.id ? "活动编辑" : "发布活动"}</h3>
        <button onClick={onNew}>新建</button>
      </div>
      <Field label="标题">
        <input value={draft.title || ""} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
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
  };
}

function toProjectPatch(draft) {
  return {
    name: draft.name,
    stage: draft.stage,
    goal: draft.goal,
    status: draft.status,
    visibility: draft.visibility,
    isOfficialRecommended: !!draft.is_official_recommended,
    officialSortWeight: Number(draft.official_sort_weight || 0),
  };
}
