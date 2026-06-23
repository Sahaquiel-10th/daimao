import cloudbase from "@cloudbase/js-sdk";

const env = import.meta.env.VITE_CLOUDBASE_ENV || "cloud1-8gocbg40af3862ce";
const functionName = import.meta.env.VITE_CLOUDBASE_FUNCTION || "daimaoBusiness";
const mockEnabled = import.meta.env.VITE_ADMIN_USE_MOCK === "true";

let app;
let signInPromise;

function getApp() {
  if (!app) app = cloudbase.init({ env });
  return app;
}

async function ensureAuth() {
  const auth = getApp().auth({ persistence: "local" });
  const state = await auth.getLoginState();
  if (state) return;
  if (!signInPromise) signInPromise = auth.anonymousAuthProvider().signIn();
  await signInPromise;
}

function getToken() {
  return localStorage.getItem("daimao_admin_web_token") || import.meta.env.VITE_ADMIN_WEB_TOKEN || "";
}

export function saveToken(token) {
  localStorage.setItem("daimao_admin_web_token", token || "");
}

export function hasToken() {
  return !!getToken();
}

export async function callAdmin(action, data = {}) {
  if (mockEnabled) return mockCall(action, data);
  const adminWebToken = getToken();
  if (!adminWebToken) throw new Error("请先填写后台访问令牌");
  await ensureAuth();
  const result = await getApp().callFunction({
    name: functionName,
    data: { action, adminWebToken, ...data },
  });
  const payload = result.result || result;
  if (!payload || !payload.success) {
    const error = new Error((payload && payload.message) || "后台服务暂时不可用");
    error.code = payload && payload.code;
    throw error;
  }
  return payload;
}

const now = new Date().toISOString();
const mockState = {
  users: [
    { id: 1, openid: "demo_admin_daimao", display_name: "呆猫主理人", status: "active", is_admin: 1, experience_points: 180, created_at: now },
    { id: 2, openid: "demo_operator_ai", display_name: "阿里 AI 产品顾问", status: "active", is_admin: 0, experience_points: 76, created_at: now },
    { id: 3, openid: "demo_sales_growth", display_name: "增长销售合伙人", status: "disabled", is_admin: 0, experience_points: 63, created_at: now },
  ],
  projects: [
    { id: 10, name: "AI 销售线索整理小助手", status: "active", visibility: "public", is_official_recommended: 1, official_sort_weight: 100, star_count: 42, stage: "招募共创", tags: ["AI", "销售"], updated_at: now },
    { id: 11, name: "城市私董会活动运营系统", status: "draft", visibility: "private", is_official_recommended: 0, official_sort_weight: 20, star_count: 8, stage: "内测", tags: ["社区", "活动"], updated_at: now },
  ],
  events: [
    { id: 20, title: "OPC 项目评审会", event_type: "project_review", location: "上海", status: "published", visibility: "public", start_time: now, capacity: 20 },
  ],
  ragSources: [
    { id: 30, source_type: "profile", title: "阿里 AI 产品顾问资料", status: "indexed", visibility: "match_only", updated_at: now },
  ],
  ragIndexJobs: [
    { id: 40, source_id: 30, job_type: "upsert", status: "completed", created_at: now },
  ],
};

async function mockCall(action, data) {
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (action === "adminList") return { success: true, ...mockState };
  if (action === "adminSetUserStatus") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, status: data.status } : item);
    return { success: true, saved: true };
  }
  if (action === "adminSetUserAdmin") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, is_admin: data.isAdmin ? 1 : 0 } : item);
    return { success: true, saved: true };
  }
  if (action === "adminUpdateProject") {
    mockState.projects = mockState.projects.map((item) => item.id === data.projectId ? { ...item, ...data.patch } : item);
    return { success: true, saved: true };
  }
  if (action === "adminCreateEvent") {
    const event = { id: Date.now(), ...data.event };
    mockState.events = [event, ...mockState.events];
    return { success: true, eventId: event.id };
  }
  if (action === "adminUpdateEvent") {
    mockState.events = mockState.events.map((item) => item.id === data.eventId ? { ...item, ...data.event } : item);
    return { success: true, saved: true };
  }
  return { success: false, message: `Mock 未实现 ${action}` };
}
