import cloudbase from "@cloudbase/js-sdk";

const env = import.meta.env.VITE_CLOUDBASE_ENV || "cloud1-8gocbg40af3862ce";
const functionName = import.meta.env.VITE_CLOUDBASE_FUNCTION || "daimaoBusiness";
const region = import.meta.env.VITE_CLOUDBASE_REGION || "ap-shanghai";
const mockEnabled = import.meta.env.VITE_ADMIN_USE_MOCK === "true";
const apiMode = import.meta.env.VITE_ADMIN_API_MODE || "proxy";
const proxyUrl = import.meta.env.VITE_ADMIN_API_URL || "/api/admin";

let app;
let signInPromise;
let appAccessKey;

function getApp() {
  const accessKey = getAccessKey();
  if (!app || appAccessKey !== accessKey) {
    appAccessKey = accessKey;
    app = cloudbase.init(accessKey ? { env, region, accessKey } : { env, region });
    signInPromise = null;
  }
  return app;
}

async function ensureAuth() {
  if (getAccessKey()) return;
  let stage = "检查登录态";
  try {
    const auth = getApp().auth({ persistence: "local" });
    const state = await auth.getLoginState();
    if (state) return;
    stage = "匿名登录";
    if (!signInPromise) signInPromise = signInAnonymously(auth);
    await signInPromise;
    stage = "确认登录态";
    const signedInState = await auth.getLoginState();
    if (!signedInState) throw new Error("匿名登录后仍未获取到 CloudBase 登录态");
    if (typeof auth.loginScope === "function") {
      const scope = await auth.loginScope();
      if (!scope) throw new Error("匿名登录后 CloudBase loginScope 为空");
    }
  } catch (err) {
    signInPromise = null;
    err.cloudbaseStage = stage;
    throw normalizeCloudbaseError(err);
  }
}

async function signInAnonymously(auth) {
  if (typeof auth.signInAnonymously === "function") {
    const result = await auth.signInAnonymously();
    if (result && result.error) throw result.error;
    return result;
  }
  return auth.anonymousAuthProvider().signIn();
}

function getToken() {
  return localStorage.getItem("daimao_admin_session_token") || "";
}

function getAccessKey() {
  return localStorage.getItem("daimao_cloudbase_access_key") || import.meta.env.VITE_CLOUDBASE_ACCESS_KEY || "";
}

export function saveToken(token) {
  localStorage.setItem("daimao_admin_session_token", token || "");
}

export function saveAccessKey(accessKey) {
  localStorage.setItem("daimao_cloudbase_access_key", accessKey || "");
  app = null;
  appAccessKey = "";
  signInPromise = null;
}

export function hasToken() {
  return !!getToken();
}

export async function loginAdmin(username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.success || !payload.sessionToken) {
    throw new Error((payload && payload.message) || "登录失败");
  }
  saveToken(payload.sessionToken);
  return payload;
}

export async function callAdmin(action, data = {}) {
  if (mockEnabled) return mockCall(action, data);
  const adminSessionToken = getToken();
  if (!adminSessionToken) throw new Error("请先登录后台");
  if (apiMode !== "cloudbase") return callAdminProxy(action, { adminSessionToken, ...data });
  await ensureAuth();
  try {
    const result = await getApp().callFunction({
      name: functionName,
      data: { action, adminSessionToken, ...data },
    });
    const payload = result.result || result;
    if (!payload || !payload.success) {
      const error = new Error((payload && payload.message) || "后台服务暂时不可用");
      error.code = payload && payload.code;
      throw error;
    }
    return payload;
  } catch (err) {
    err.cloudbaseStage = "调用云函数";
    throw normalizeCloudbaseError(err);
  }
}

export async function uploadAsset(kind, file) {
  const adminSessionToken = getToken();
  if (!adminSessionToken) throw new Error("请先登录后台");
  if (!file) throw new Error("请选择图片");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB");
  const params = new URLSearchParams({
    kind,
    filename: file.name || "upload",
  });
  const response = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Admin-Session-Token": adminSessionToken,
    },
    body: file,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.success) {
    throw new Error((payload && payload.message) || `上传失败 HTTP ${response.status}`);
  }
  return payload;
}

async function callAdminProxy(action, data = {}) {
  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !payload.success) {
      const error = new Error((payload && payload.message) || `后台代理服务返回 HTTP ${response.status}`);
      error.code = payload && payload.code;
      throw error;
    }
    return payload;
  } catch (err) {
    if (err.code) throw err;
    throw new Error(`后台代理服务连接失败：${err.message || err}`);
  }
}

function normalizeCloudbaseError(err) {
  const rawMessage = errorMessage(err);
  const context = cloudbaseContext(err);
  if (/scope|anonymous|auth|login/i.test(rawMessage)) {
    return new Error(`CloudBase Web 登录未就绪：请检查匿名登录、Web 安全来源和环境 ID。\n${context}\n原始错误：${rawMessage}`);
  }
  if (/cors|origin|domain|403|forbidden/i.test(rawMessage)) {
    return new Error(`CloudBase 拒绝当前网页来源：请把当前 Origin 加入云开发 Web 安全域名/安全来源。\n${context}\n原始错误：${rawMessage}`);
  }
  return new Error(`CloudBase 调用失败。\n${context}\n原始错误：${rawMessage || "未知错误"}`);
}

function cloudbaseContext(err) {
  const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
  const stage = err && err.cloudbaseStage ? `\n当前阶段：${err.cloudbaseStage}` : "";
  return `当前 Origin：${origin || "-"}\n当前 CloudBase env：${env}\n当前 CloudBase region：${region}\n当前云函数：${functionName}${stage}`;
}

function errorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.message && typeof err.message === "string") return err.message;
  if (err.msg && typeof err.msg === "string") return err.msg;
  if (err.error && typeof err.error === "string") return err.error;
  if (err.error_description && typeof err.error_description === "string") return err.error_description;
  if (err.code || err.requestId || err.requestID) {
    return JSON.stringify({
      code: err.code,
      message: err.message || err.msg,
      requestId: err.requestId || err.requestID,
    });
  }
  try {
    return JSON.stringify(err);
  } catch (jsonErr) {
    return String(err);
  }
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
