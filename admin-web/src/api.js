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
  if (mockEnabled) {
    const payload = await mockCall(action, data);
    if (!payload || !payload.success) {
      const error = new Error((payload && payload.message) || `Mock 未实现 ${action}`);
      error.code = payload && payload.code;
      throw error;
    }
    return payload;
  }
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
  if (file.size > 2 * 1024 * 1024) throw new Error("图片不能超过 2MB，请压缩后再上传");
  const uploadFile = await prepareImageForUpload(file);
  const params = new URLSearchParams({
    kind,
    filename: uploadFile.name || file.name || "upload",
  });
  const response = await fetch(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": uploadFile.type || file.type || "application/octet-stream",
      "X-Admin-Session-Token": adminSessionToken,
    },
    body: uploadFile,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !payload.success) {
    throw new Error((payload && payload.message) || `上传失败 HTTP ${response.status}`);
  }
  return payload;
}

async function prepareImageForUpload(file) {
  if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.type || "")) return file;
  if (file.size <= 900 * 1024) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob || blob.size >= file.size) return file;
  const baseName = String(file.name || "upload").replace(/\.[a-z0-9]+$/i, "");
  return new File([blob], `${baseName}.webp`, { type: "image/webp" });
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
    { id: 1, public_user_code: "001", openid: "demo_admin_daimao", display_name: "呆猫主理人", status: "active", is_admin: 1, experience_points: 180, created_at: now, communities: [{ community_id: 1, status: "active", tags: ["主理人"], communityName: "OPC 共创营", badgeName: "OPC" }] },
    { id: 2, public_user_code: "002", openid: "demo_operator_ai", display_name: "阿里 AI 产品顾问", status: "active", is_admin: 0, experience_points: 76, created_at: now, communities: [{ community_id: 1, status: "active", tags: ["AI"], communityName: "OPC 共创营", badgeName: "OPC" }], referral: { referrer_user_id: 1, referrer_public_user_code: "001", referrer_display_name: "呆猫主理人", note: "测试引荐" } },
    { id: 3, public_user_code: "003", openid: "demo_sales_growth", display_name: "增长销售合伙人", status: "disabled", is_admin: 0, experience_points: 63, created_at: now },
  ],
  communities: [
    { id: 1, name: "OPC 共创营", badge_name: "OPC", description: "务实接单、项目共创", logo_url: "", certification_method: "manual_review", status: "active", sort_weight: 100 },
  ],
  adminAccounts: [
    { id: 1, username: "community_demo", display_name: "OPC 社区管理员", role: "community_admin", status: "active", communityIds: [1], updated_at: now },
  ],
  projects: [
    { id: 10, community_id: 1, name: "AI 销售线索整理小助手", status: "active", visibility: "public", is_official_recommended: 1, official_sort_weight: 100, star_count: 42, stage: "招募共创", tags: ["AI", "销售"], updated_at: now },
    { id: 11, community_id: 1, name: "城市私董会活动运营系统", status: "draft", visibility: "private", is_official_recommended: 0, official_sort_weight: 20, star_count: 8, stage: "内测", tags: ["社区", "活动"], updated_at: now },
  ],
  projectApplications: [
    { id: 101, project_id: 10, user_id: 2, message: "我想参与线索整理", status: "pending_secretary_review", ai_review_status: "pending", created_at: now },
  ],
  events: [
    { id: 20, community_id: 1, title: "OPC 项目评审会", event_type: "project_review", location: "上海", status: "published", visibility: "public", start_time: now, capacity: 20, fee_amount_cents: 9900, fee_currency: "CNY" },
  ],
  adminLogs: [
    { id: 1, admin_user_id: 1, action: "mock_login", target_type: "admin", target_id: 1, detail_json: { source: "mock" }, created_at: now },
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
  if (action === "adminList") return { success: true, adminSession: { role: "super_admin", communityIds: [] }, ...mockState };
  if (action === "adminUpdateUser") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, public_user_code: data.patch?.publicUserCode ?? item.public_user_code, display_name: data.patch?.displayName ?? item.display_name, status: data.patch?.status ?? item.status, experience_points: data.patch?.experiencePoints ?? item.experience_points } : item);
    return { success: true, saved: true };
  }
  if (action === "adminSetUserReferral") {
    const referrer = mockState.users.find((item) => item.public_user_code === data.referrerUserCode || String(item.id) === String(data.referrerUserCode));
    mockState.users = mockState.users.map((item) => {
      if (item.id !== data.userId) return item;
      if (!data.referrerUserCode) return { ...item, referral: null };
      return { ...item, referral: { referrer_user_id: referrer?.id, referrer_public_user_code: referrer?.public_user_code || data.referrerUserCode, referrer_display_name: referrer?.display_name || "", note: data.note || "" } };
    });
    return { success: true, saved: true };
  }
  if (action === "adminDeleteUser") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, status: "disabled", is_admin: 0 } : item);
    return { success: true, saved: true };
  }
  if (action === "adminUpdateCommunity") {
    const patch = data.patch || {};
    const values = {
      name: patch.name,
      badge_name: patch.badgeName,
      description: patch.description,
      logo_url: patch.logoUrl,
      certification_method: patch.certificationMethod,
      status: patch.status,
      sort_weight: patch.sortWeight,
    };
    if (data.communityId) {
      mockState.communities = mockState.communities.map((item) => item.id === data.communityId ? { ...item, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) } : item);
      return { success: true, saved: true };
    }
    const community = { id: Date.now(), ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) };
    mockState.communities = [community, ...mockState.communities];
    return { success: true, saved: true, communityId: community.id };
  }
  if (action === "adminUpsertAdminAccount") {
    const patch = data.patch || {};
    if (data.accountId) {
      mockState.adminAccounts = mockState.adminAccounts.map((item) => item.id === data.accountId ? { ...item, ...patch, communityIds: patch.communityIds || [] } : item);
    } else {
      mockState.adminAccounts = [{ id: Date.now(), ...patch, updated_at: now }, ...mockState.adminAccounts];
    }
    return { success: true, saved: true };
  }
  if (action === "adminDeleteAdminAccount") {
    mockState.adminAccounts = mockState.adminAccounts.map((item) => item.id === data.accountId ? { ...item, status: "disabled" } : item);
    return { success: true, saved: true };
  }
  if (action === "adminSaveUserCommunity" || action === "adminRevokeUserCommunity") {
    return { success: true, saved: true };
  }
  if (action === "adminListUserEvidence") return { success: true, evidence: [] };
  if (action === "adminSearchUsersForCertification") {
    const keyword = String(data.keyword || "").toLowerCase();
    const users = mockState.users.filter((item) =>
      [item.id, item.openid, item.display_name, item.profile?.name, item.profile?.job, item.profile?.wechat]
        .some((value) => String(value || "").toLowerCase().includes(keyword))
    );
    return { success: true, users };
  }
  if (action === "processRagIndexJobs") return { success: true, checked: 0, completed: 0, failed: 0 };
  if (action === "adminSetUserStatus") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, status: data.status } : item);
    return { success: true, saved: true };
  }
  if (action === "adminSetUserAdmin") {
    mockState.users = mockState.users.map((item) => item.id === data.userId ? { ...item, is_admin: data.isAdmin ? 1 : 0 } : item);
    return { success: true, saved: true };
  }
  if (action === "adminUpdateProject") {
    const patch = { ...data.patch };
    if (patch.communityId !== undefined) {
      patch.community_id = patch.communityId;
      delete patch.communityId;
    }
    mockState.projects = mockState.projects.map((item) => item.id === data.projectId ? { ...item, ...patch } : item);
    return { success: true, saved: true };
  }
  if (action === "adminCreateProject") {
    const project = { id: Date.now(), ...data.project, community_id: data.project?.communityId || data.project?.community_id || null, creator_user_id: data.project?.creatorUserId || data.project?.creator_user_id || 1, updated_at: now };
    mockState.projects = [project, ...mockState.projects];
    return { success: true, projectId: project.id };
  }
  if (action === "adminCreateEvent") {
    const event = { id: Date.now(), ...data.event, community_id: data.event?.communityId || data.event?.community_id || null };
    mockState.events = [event, ...mockState.events];
    return { success: true, eventId: event.id };
  }
  if (action === "adminUpdateEvent") {
    const event = { ...data.event };
    if (event.communityId !== undefined) {
      event.community_id = event.communityId;
      delete event.communityId;
    }
    mockState.events = mockState.events.map((item) => item.id === data.eventId ? { ...item, ...event } : item);
    return { success: true, saved: true };
  }
  if (action === "adminConfirmEventRegistration") {
    return {
      success: true,
      eventId: data.eventId,
      userId: data.userId || null,
      publicUserCode: data.publicUserCode || "",
      status: "registered",
      paidAmountCents: data.paidAmountCents || 0,
    };
  }
  return { success: false, message: `Mock 未实现 ${action}` };
}
