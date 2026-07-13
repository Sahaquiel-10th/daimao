const http = require("http");
const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");

const env = process.env.CLOUDBASE_ENV || process.env.ADMIN_API_CLOUDBASE_ENV || "cloud1-8gocbg40af3862ce";
const functionName = process.env.CLOUDBASE_FUNCTION || process.env.ADMIN_API_CLOUDBASE_FUNCTION || "daimaoBusiness";
const region = process.env.CLOUDBASE_REGION || process.env.ADMIN_API_CLOUDBASE_REGION || "ap-shanghai";
const port = Number(process.env.ADMIN_API_PORT || 8090);
const host = process.env.ADMIN_API_HOST || "127.0.0.1";
const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.CLOUDBASE_SECRET_ID || process.env.CLOUDBASE_SECRETID;
const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.CLOUDBASE_SECRET_KEY || process.env.CLOUDBASE_SECRETKEY;
const adminUsername = process.env.ADMIN_WEB_USERNAME || "admin";
const adminPassword = process.env.ADMIN_WEB_PASSWORD || "";
const superUsername = process.env.ADMIN_SUPER_USERNAME || adminUsername || "superadmin";
const superPassword = process.env.ADMIN_SUPER_PASSWORD || adminPassword || "";
const communityAccountsJson = process.env.ADMIN_COMMUNITY_ACCOUNTS || "";
const adminWebToken = process.env.ADMIN_WEB_TOKEN || "";
const sessionSecret = process.env.ADMIN_SESSION_SECRET || adminWebToken || secretKey || "";
const passwordHashIterations = Number(process.env.ADMIN_PASSWORD_HASH_ITERATIONS || 120000);

let app;
let rdbClient;

function getApp() {
  if (!app) {
    if (!secretId || !secretKey) {
      throw new Error("缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY，无法从服务器调用 CloudBase");
    }
    app = cloudbase.init({ env, secretId, secretKey, region });
  }
  return app;
}

function getRdb() {
  if (!rdbClient) rdbClient = getApp().rdb();
  return rdbClient;
}

function assertRdb(result, action) {
  if (result && result.error) {
    const raw = result.error || {};
    const reason = raw.message || raw.msg || raw.error || raw.code || "";
    const error = new Error(`${action || "CloudBase RDB"} 失败${reason ? `：${reason}` : ""}`);
    error.code = "RDB_ERROR";
    error.details = result.error;
    throw error;
  }
  return result || {};
}

async function rdbSelect(table, columns = "*", build) {
  let request = getRdb().from(table).select(columns);
  if (build) request = build(request);
  const result = assertRdb(await request, `查询 ${table}`);
  return result.data || [];
}

async function rdbUpdate(table, values, build) {
  let request = getRdb().from(table).update(values);
  if (build) request = build(request);
  return assertRdb(await request, `更新 ${table}`).data || null;
}

async function rdbInsert(table, values) {
  return assertRdb(await getRdb().from(table).insert(values), `新增 ${table}`).data || [];
}

async function rdbDelete(table, build) {
  let request = getRdb().from(table).delete();
  if (build) request = build(request);
  return assertRdb(await request, `删除 ${table}`).data || null;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function readBuffer(request, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("上传文件不能超过 8MB"), { code: "PAYLOAD_TOO_LARGE" }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function hashPassword(password) {
  const raw = String(password || "");
  if (raw.length < 10) {
    const error = new Error("密码至少 10 位");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(raw, salt, passwordHashIterations, 32, "sha256").toString("base64url");
  return `pbkdf2_sha256$${passwordHashIterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCommunityAccounts() {
  if (communityAccountsJson) {
    try {
      const rows = JSON.parse(communityAccountsJson);
      if (Array.isArray(rows)) {
        return rows
          .map((item) => ({
            username: text(item.username, 80),
            password: String(item.password || ""),
            role: "community_admin",
            communityIds: Array.isArray(item.communityIds) ? item.communityIds.map(Number).filter(Boolean) : [],
          }))
          .filter((item) => item.username && item.password && item.communityIds.length);
      }
    } catch (err) {
      console.warn("ADMIN_COMMUNITY_ACCOUNTS 不是合法 JSON", err.message);
    }
  }
  const username = process.env.ADMIN_COMMUNITY_USERNAME || "community_admin";
  const password = process.env.ADMIN_COMMUNITY_PASSWORD || "";
  const communityIds = String(process.env.ADMIN_COMMUNITY_IDS || "1")
    .split(/[\s,，]+/)
    .map(Number)
    .filter(Boolean);
  return password ? [{ username, password, role: "community_admin", communityIds }] : [];
}

const communityAccounts = parseCommunityAccounts();

const defaultExperienceRules = [
  { rule_key: "register_profile", label: "注册并保存名片", description: "首次完成名片资料。", points: 10, status: "active", sort_order: 10 },
  { rule_key: "card_viewed_by_other", label: "有人碰你的名片", description: "别人通过 NFC 或分享打开并保存你的名片。", points: 2, status: "active", sort_order: 20 },
  { rule_key: "view_other_card", label: "你碰别人的名片", description: "你主动打开并保存别人的名片。", points: 1, status: "active", sort_order: 30 },
  { rule_key: "share_card", label: "分享自己的名片", description: "分享 OPC 数据中心名片。", points: 1, status: "active", sort_order: 40 },
  { rule_key: "watch_project", label: "围观项目", description: "首次围观一个项目。", points: 1, status: "active", sort_order: 50 },
  { rule_key: "apply_project", label: "提交项目申请", description: "提交一次有效项目申请。", points: 3, status: "active", sort_order: 60 },
  { rule_key: "join_project", label: "被项目接受参与", description: "项目主理人接受申请。", points: 20, status: "active", sort_order: 70 },
  { rule_key: "complete_project_task", label: "完成一次项目任务", description: "项目主理人确认任务完成。", points: 15, status: "active", sort_order: 80 },
  { rule_key: "project_completed_member", label: "参与项目顺利完成", description: "作为成员参与并完成项目。", points: 50, status: "active", sort_order: 90 },
  { rule_key: "project_completed_lead", label: "主理项目顺利完成", description: "作为主理人完成项目。", points: 120, status: "active", sort_order: 100 },
  { rule_key: "attend_event", label: "参加一次活动", description: "活动签到或管理员确认。", points: 8, status: "active", sort_order: 110 },
  { rule_key: "pass_review", label: "通过社区认证", description: "获得任一社区认证徽章。", points: 30, status: "active", sort_order: 120 },
  { rule_key: "host_event", label: "协助组织活动", description: "管理员确认协助组织活动。", points: 40, status: "active", sort_order: 130 },
  { rule_key: "positive_feedback", label: "获得正向协作反馈", description: "来自项目主理人或管理员的正向反馈。", points: 10, status: "active", sort_order: 140 },
];

function createSessionToken(account) {
  if (!sessionSecret) throw new Error("缺少 ADMIN_SESSION_SECRET 或 ADMIN_WEB_TOKEN，无法创建后台会话");
  const payload = base64url(JSON.stringify({
    username: account.username,
    accountId: account.accountId || null,
    role: account.role,
    communityIds: account.communityIds || [],
    exp: Date.now() + 12 * 60 * 60 * 1000,
  }));
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!sessionSecret || !token || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || !data.exp || Date.now() >= Number(data.exp)) return null;
    return {
      username: text(data.username, 80),
      accountId: data.accountId ? Number(data.accountId) : null,
      role: data.role === "community_admin" ? "community_admin" : "super_admin",
      communityIds: Array.isArray(data.communityIds) ? data.communityIds.map(Number).filter(Boolean) : [],
    };
  } catch (err) {
    return null;
  }
}

function publicError(err) {
  return {
    success: false,
    code: err.code || "ADMIN_API_ERROR",
    message: err.message || "后台代理服务暂时不可用",
    details: process.env.NODE_ENV === "development" ? err.details : undefined,
  };
}

function text(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function normalizePublicUserCode(value) {
  return text(value, 32).replace(/\s+/g, "");
}

function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function json(value, fallback = []) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  return JSON.stringify(value);
}

function id(value, label = "id") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(`${label} 不合法`);
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return parsed;
}

function tags(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 40)).filter(Boolean);
  return String(value || "")
    .split(/[\s,，#]+/)
    .map((item) => text(item, 40))
    .filter(Boolean);
}

function fileExtension(filename, contentType) {
  const fromName = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (fromName) return fromName[1].slice(0, 8);
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function safeAssetKind(value) {
  return ["project-cover", "event-cover", "community-logo", "user-avatar"].includes(value) ? value : "misc";
}

async function callBusiness(data) {
  const result = await getApp().callFunction({
    name: functionName,
    data,
  });
  return result.result || result;
}

function resolveAdminWebToken(data) {
  if (data && data.adminWebToken) return data.adminWebToken;
  if (data && verifySessionToken(data.adminSessionToken) && adminWebToken) return adminWebToken;
  return "";
}

function sessionFromData(data) {
  return verifySessionToken(data && data.adminSessionToken) || null;
}

function requireSuperAdmin(data) {
  const session = sessionFromData(data);
  if (!session || session.role !== "super_admin") {
    const error = new Error("只有超级管理员可以执行此操作");
    error.code = "FORBIDDEN";
    throw error;
  }
  return session;
}

function requireCommunityAccess(data, communityId) {
  const session = sessionFromData(data);
  if (!session) {
    const error = new Error("请先登录后台");
    error.code = "FORBIDDEN";
    throw error;
  }
  if (session.role === "super_admin") return session;
  if (session.communityIds.includes(Number(communityId))) return session;
  const error = new Error("无权管理这个社区");
  error.code = "FORBIDDEN";
  throw error;
}

async function assertUserInSessionCommunities(data, userId) {
  const session = sessionFromData(data);
  if (!session) {
    const error = new Error("请先登录后台");
    error.code = "FORBIDDEN";
    throw error;
  }
  if (session.role === "super_admin") return session;
  const allowedIds = session.communityIds || [];
  if (!allowedIds.length) {
    const error = new Error("无权查看这个用户");
    error.code = "FORBIDDEN";
    throw error;
  }
  const rows = await rdbSelect("community_memberships", "id", (request) =>
    request.eq("user_id", id(userId, "userId")).in("community_id", allowedIds).eq("status", "active").limit(1)
  ).catch(() => []);
  if (rows[0]) return session;
  const error = new Error("无权查看这个用户");
  error.code = "FORBIDDEN";
  throw error;
}

async function assertEvidenceInSessionCommunities(data, evidenceId) {
  const session = sessionFromData(data);
  if (!session) {
    const error = new Error("请先登录后台");
    error.code = "FORBIDDEN";
    throw error;
  }
  if (session.role === "super_admin") return session;
  const rows = await rdbSelect("evidence_records", "id,user_id,community_id", (request) =>
    request.eq("id", id(evidenceId, "evidenceId")).limit(1)
  ).catch(() => []);
  const evidence = rows[0];
  if (!evidence) {
    const error = new Error("证据不存在");
    error.code = "NOT_FOUND";
    throw error;
  }
  if (evidence.community_id && session.communityIds.includes(Number(evidence.community_id))) return session;
  return assertUserInSessionCommunities(data, evidence.user_id);
}

async function assertProjectInSessionCommunities(data, projectId) {
  const rows = await rdbSelect("projects", "id,community_id", (request) => request.eq("id", id(projectId, "projectId")).limit(1)).catch(() => []);
  const project = rows[0];
  if (!project) {
    const error = new Error("项目不存在");
    error.code = "NOT_FOUND";
    throw error;
  }
  requireCommunityAccess(data, project.community_id);
  return project;
}

async function assertProjectMemberUserAllowed(data, projectId, userId) {
  const session = sessionFromData(data);
  if (!session || session.role === "super_admin") return;
  await assertProjectInSessionCommunities(data, projectId);
  await assertUserInSessionCommunities(data, userId);
}

async function assertScopedBusinessAction(data) {
  const session = sessionFromData(data);
  if (!session || session.role === "super_admin") return;
  const action = data.action;
  if (["processRagIndexJobs"].includes(action)) return;
  if (action === "adminCreateCommunityMemberEvidence") {
    requireCommunityAccess(data, data.communityId);
    return;
  }
  if (action === "adminListUserEvidence") {
    await assertUserInSessionCommunities(data, data.userId || data.targetUserId);
    return;
  }
  if (action === "adminUpdateUserEvidence" || action === "adminArchiveUserEvidence") {
    await assertEvidenceInSessionCommunities(data, data.evidenceId || data.id);
    return;
  }
  if (action === "adminCreateProject") {
    const project = data.project || data.patch || {};
    const communityId = project.communityId !== undefined ? project.communityId : project.community_id;
    const creatorUserId = project.creatorUserId !== undefined ? project.creatorUserId : project.creator_user_id;
    requireCommunityAccess(data, communityId);
    if (creatorUserId) await assertUserInSessionCommunities(data, creatorUserId);
    return;
  }
  if (action === "adminUpdateProject") {
    const patchCommunityId = data.patch && (data.patch.communityId !== undefined ? data.patch.communityId : data.patch.community_id);
    const patchCreatorUserId = data.patch && (data.patch.creatorUserId !== undefined ? data.patch.creatorUserId : data.patch.creator_user_id);
    const rows = await rdbSelect("projects", "id,community_id", (request) => request.eq("id", id(data.projectId, "projectId")).limit(1)).catch(() => []);
    const project = rows[0];
    if (!project) {
      const error = new Error("项目不存在");
      error.code = "NOT_FOUND";
      throw error;
    }
    requireCommunityAccess(data, project.community_id);
    if (patchCommunityId !== undefined) requireCommunityAccess(data, patchCommunityId);
    if (patchCreatorUserId) await assertUserInSessionCommunities(data, patchCreatorUserId);
    return;
  }
  if (["adminGetProjectManagement", "adminCreateProjectUpdate", "adminUpdateProjectUpdate", "adminCompleteProject"].includes(action)) {
    await assertProjectInSessionCommunities(data, data.projectId);
    return;
  }
  if (action === "adminUpsertProjectMember") {
    const memberUserId = data.userId || data.memberUserId;
    await assertProjectMemberUserAllowed(data, data.projectId, memberUserId);
    return;
  }
  if (action === "adminCreateProjectMemberReview") {
    const reviewedUserId = data.reviewedUserId || data.userId;
    await assertProjectMemberUserAllowed(data, data.projectId, reviewedUserId);
    return;
  }
  if (action === "adminCreateEvent") {
    const communityId = data.event && (data.event.communityId !== undefined ? data.event.communityId : data.event.community_id);
    requireCommunityAccess(data, communityId);
    return;
  }
  if (action === "adminUpdateEvent") {
    const rows = await rdbSelect("official_events", "id,community_id", (request) => request.eq("id", id(data.eventId, "eventId")).limit(1)).catch(() => []);
    const officialEvent = rows[0];
    if (!officialEvent) {
      const error = new Error("活动不存在");
      error.code = "NOT_FOUND";
      throw error;
    }
    requireCommunityAccess(data, officialEvent.community_id);
    const nextCommunityId = data.event && (data.event.communityId !== undefined ? data.event.communityId : data.event.community_id);
    if (nextCommunityId !== undefined) requireCommunityAccess(data, nextCommunityId);
    return;
  }
  if (action === "adminConfirmEventRegistration") {
    const rows = await rdbSelect("official_events", "id,community_id", (request) => request.eq("id", id(data.eventId, "eventId")).limit(1)).catch(() => []);
    const officialEvent = rows[0];
    if (!officialEvent) {
      const error = new Error("活动不存在");
      error.code = "NOT_FOUND";
      throw error;
    }
    requireCommunityAccess(data, officialEvent.community_id);
    const targetUser = await findUserByPublicCodeOrId(data.userId || data.publicUserCode || data.userCode);
    if (!targetUser) {
      const error = new Error("找不到要确认报名的用户");
      error.code = "NOT_FOUND";
      throw error;
    }
    await assertUserInSessionCommunities(data, targetUser.id);
    data.userId = Number(targetUser.id);
    delete data.publicUserCode;
    delete data.userCode;
    return;
  }
  const error = new Error("社区管理员无权执行此操作");
  error.code = "FORBIDDEN";
  throw error;
}

async function assertAdmin(data) {
  const token = resolveAdminWebToken(data);
  if (!token) {
    const error = new Error("请先登录后台");
    error.code = "FORBIDDEN";
    throw error;
  }
  const result = await callBusiness({ action: "adminList", adminWebToken: token });
  if (!result || !result.success) {
    const error = new Error((result && result.message) || "后台令牌校验失败");
    error.code = (result && result.code) || "FORBIDDEN";
    throw error;
  }
  return result;
}

function businessData(data) {
  const token = resolveAdminWebToken(data);
  const next = { ...data, adminWebToken: token };
  delete next.adminSessionToken;
  return next;
}

async function enrichAdminList(payload) {
  const userIds = (payload.users || []).map((item) => Number(item.id)).filter(Boolean);
  const [communities, memberships, profiles, projectMembers, projectRecords, experienceEvents, referrals, experienceRules] = await Promise.all([
    rdbSelect("communities", "*", (request) => request.order("sort_weight", { ascending: false }).limit(300)).catch(() => []),
    userIds.length ? rdbSelect("community_memberships", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("user_profiles", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("project_members", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("project_records", "id,project_id,uploader_user_id,title,record_type,visibility,ai_process_status,created_at", (request) => request.in("uploader_user_id", userIds).order("created_at", { ascending: false }).limit(500)).catch(() => []) : [],
    userIds.length ? rdbSelect("user_experience_events", "*", (request) => request.in("user_id", userIds).order("created_at", { ascending: false }).limit(500)).catch(() => []) : [],
    userIds.length ? rdbSelect("user_referrals", "*", (request) => request.in("referred_user_id", userIds).eq("status", "active").limit(3000)).catch(() => []) : [],
    rdbSelect("experience_rules", "*", (request) => request.order("sort_order", { ascending: true }).limit(200)).catch(() => defaultExperienceRules),
  ]);
  const referrerIds = [...new Set(referrals.map((item) => Number(item.referrer_user_id)).filter(Boolean))];
  const [referrerUsers, referrerProfiles] = await Promise.all([
    referrerIds.length ? rdbSelect("users", "id,openid,public_user_code,display_name,status", (request) => request.in("id", referrerIds).limit(3000)).catch(() => []) : [],
    referrerIds.length ? rdbSelect("user_profiles", "user_id,name,job,wechat", (request) => request.in("user_id", referrerIds).limit(3000)).catch(() => []) : [],
  ]);
  const communityMap = new Map(communities.map((item) => [Number(item.id), item]));
  const profilesByUser = new Map(profiles.map((item) => [Number(item.user_id), { ...item, tags: parseJson(item.tags_json, []), answers: parseJson(item.answers_json, []) }]));
  const referrerUserMap = new Map(referrerUsers.map((item) => [Number(item.id), item]));
  const referrerProfileMap = new Map(referrerProfiles.map((item) => [Number(item.user_id), item]));
  const membershipsByUser = new Map();
  memberships.forEach((item) => {
    const list = membershipsByUser.get(Number(item.user_id)) || [];
    const community = communityMap.get(Number(item.community_id)) || {};
    list.push({
      ...item,
      tags: parseJson(item.tags_json, []),
      communityName: community.name || "",
      badgeName: community.badge_name || "",
      logoUrl: community.logo_url || "",
    });
    membershipsByUser.set(Number(item.user_id), list);
  });
  const referralByUser = new Map();
  referrals.forEach((item) => {
    const referrer = referrerUserMap.get(Number(item.referrer_user_id)) || {};
    const profile = referrerProfileMap.get(Number(item.referrer_user_id)) || {};
    referralByUser.set(Number(item.referred_user_id), {
      ...item,
      referrer_public_user_code: referrer.public_user_code || "",
      referrer_display_name: referrer.display_name || profile.name || "",
      referrer_profile_name: profile.name || "",
      referrer_job: profile.job || "",
    });
  });
  const enriched = {
    ...payload,
    communities,
    communityMemberships: memberships,
    referrals,
    userProfiles: profiles,
    projectMembers,
    projectRecords,
    experienceEvents,
    experienceRules: experienceRules.length ? experienceRules : defaultExperienceRules,
    users: (payload.users || []).map((item) => ({
      ...item,
      profile: profilesByUser.get(Number(item.id)) || null,
      communities: membershipsByUser.get(Number(item.id)) || [],
      referral: referralByUser.get(Number(item.id)) || null,
    })),
  };
  return addAssetDisplayUrls(enriched);
}

function isCloudFileId(value) {
  return typeof value === "string" && value.startsWith("cloud://");
}

async function addAssetDisplayUrls(payload) {
  const fileIds = [];
  const push = (value) => {
    if (isCloudFileId(value) && !fileIds.includes(value)) fileIds.push(value);
  };
  (payload.users || []).forEach((item) => {
    push(item.avatar_url);
    push(item.profile && item.profile.avatar_url);
  });
  (payload.communities || []).forEach((item) => push(item.logo_url));
  (payload.projects || []).forEach((item) => push(item.cover_url));
  (payload.events || []).forEach((item) => push(item.cover_url));
  if (!fileIds.length) return payload;
  let urlMap = new Map();
  try {
    const result = await getApp().getTempFileURL({ fileList: fileIds });
    urlMap = new Map((result.fileList || []).map((item) => [item.fileID, item.tempFileURL || item.download_url || ""]));
  } catch (err) {
    console.warn("获取 CloudBase 图片临时 URL 失败", err.message);
  }
  const display = (value) => (isCloudFileId(value) ? urlMap.get(value) || "" : value || "");
  return {
    ...payload,
    users: (payload.users || []).map((item) => ({
      ...item,
      avatar_display_url: display(item.avatar_url),
      profile: item.profile ? { ...item.profile, avatar_display_url: display(item.profile.avatar_url) } : item.profile,
    })),
    communities: (payload.communities || []).map((item) => ({ ...item, logo_display_url: display(item.logo_url) })),
    projects: (payload.projects || []).map((item) => ({ ...item, cover_display_url: display(item.cover_url) })),
    events: (payload.events || []).map((item) => ({ ...item, cover_display_url: display(item.cover_url) })),
  };
}

function applyAdminScope(payload, session) {
  if (!session || session.role === "super_admin") return { ...payload, adminSession: session || { role: "super_admin", communityIds: [] } };
  const allowed = new Set((session.communityIds || []).map(Number));
  const communities = (payload.communities || []).filter((item) => allowed.has(Number(item.id)));
  const communityMemberships = (payload.communityMemberships || []).filter((item) => allowed.has(Number(item.community_id)));
  const allowedUserIds = new Set(communityMemberships.map((item) => Number(item.user_id)));
  const users = (payload.users || [])
    .filter((item) => allowedUserIds.has(Number(item.id)))
    .map((item) => ({
      ...item,
      communities: (item.communities || []).filter((membership) => allowed.has(Number(membership.community_id))),
    }));
  const evidence = (payload.evidence || []).filter((item) => allowed.has(Number(item.community_id)) || allowedUserIds.has(Number(item.user_id)));
  const ragSources = (payload.ragSources || []).filter(
    (item) => allowed.has(Number(item.community_id)) || allowedUserIds.has(Number(item.owner_user_id))
  );
  const allowedSourceIds = new Set(ragSources.map((item) => Number(item.id)));
  const ragIndexJobs = (payload.ragIndexJobs || []).filter((item) => allowedSourceIds.has(Number(item.source_id)));
  const projects = (payload.projects || []).filter((item) => allowed.has(Number(item.community_id)));
  const allowedProjectIds = new Set(projects.map((item) => Number(item.id)));
  const projectMembers = (payload.projectMembers || []).filter((item) => allowedProjectIds.has(Number(item.project_id)));
  const projectRecords = (payload.projectRecords || []).filter((item) => allowedProjectIds.has(Number(item.project_id)));
  const projectApplications = (payload.projectApplications || []).filter((item) => allowedProjectIds.has(Number(item.project_id)));
  const events = (payload.events || []).filter((item) => allowed.has(Number(item.community_id)));
  const referrals = (payload.referrals || []).filter(
    (item) => allowedUserIds.has(Number(item.referred_user_id)) || allowedUserIds.has(Number(item.referrer_user_id))
  );
  return {
    ...payload,
    adminSession: session,
    communities,
    communityMemberships,
    users,
    projects,
    projectMembers,
    projectRecords,
    projectApplications,
    events,
    referrals,
    evidence,
    ragSources,
    ragIndexJobs,
    adminLogs: [],
  };
}

async function adminUpdateUser(data) {
  requireSuperAdmin(data);
  const userId = id(data.userId, "userId");
  const patch = data.patch || {};
  const userValues = {};
  if (patch.publicUserCode !== undefined) {
    const code = normalizePublicUserCode(patch.publicUserCode);
    if (!code) {
      const error = new Error("用户ID不能为空");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    const duplicate = await rdbSelect("users", "id", (request) => request.eq("public_user_code", code).limit(1)).catch(() => []);
    if (duplicate[0] && Number(duplicate[0].id) !== Number(userId)) {
      const error = new Error("这个用户ID已被占用");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    userValues.public_user_code = code;
  }
  if (patch.displayName !== undefined) userValues.display_name = text(patch.displayName, 120);
  if (patch.avatarUrl !== undefined) userValues.avatar_url = text(patch.avatarUrl, 1000);
  if (patch.status !== undefined) userValues.status = patch.status === "disabled" ? "disabled" : "active";
  if (patch.isAdmin !== undefined) userValues.is_admin = patch.isAdmin ? 1 : 0;
  if (patch.experiencePoints !== undefined) userValues.experience_points = Number(patch.experiencePoints || 0);
  if (Object.keys(userValues).length) await rdbUpdate("users", userValues, (request) => request.eq("id", userId));

  const profileValues = {};
  if (patch.profileName !== undefined) profileValues.name = text(patch.profileName, 120);
  if (patch.job !== undefined) profileValues.job = text(patch.job, 180);
  if (patch.wechat !== undefined) profileValues.wechat = text(patch.wechat, 120);
  if (patch.intro !== undefined) profileValues.intro = text(patch.intro, 3000);
  if (patch.adminNote !== undefined) profileValues.admin_note = text(patch.adminNote, 10000);
  if (patch.profileTags !== undefined) profileValues.tags_json = json(tags(patch.profileTags), []);
  if (Object.keys(profileValues).length) {
    const existing = await rdbSelect("user_profiles", "id", (request) => request.eq("user_id", userId).limit(1)).catch(() => []);
    if (existing[0]) await rdbUpdate("user_profiles", profileValues, (request) => request.eq("id", existing[0].id));
    else await rdbInsert("user_profiles", { user_id: userId, ...profileValues });
  }

  return { success: true, saved: true };
}

async function findUserByPublicCodeOrId(value) {
  const key = normalizePublicUserCode(value);
  if (!key) return null;
  const byCode = await rdbSelect("users", "id,openid,public_user_code,display_name,status", (request) =>
    request.eq("public_user_code", key).limit(1)
  ).catch(() => []);
  if (byCode[0]) return byCode[0];
  if (/^\d+$/.test(key)) {
    const byId = await rdbSelect("users", "id,openid,public_user_code,display_name,status", (request) =>
      request.eq("id", Number(key)).limit(1)
    ).catch(() => []);
    if (byId[0]) return byId[0];
  }
  return null;
}

async function defaultReferralCommunityId(data, userId) {
  const session = sessionFromData(data);
  if (data.communityId) {
    const communityId = id(data.communityId, "communityId");
    requireCommunityAccess(data, communityId);
    return communityId;
  }
  if (!session || session.role === "super_admin") return null;
  const allowed = new Set((session.communityIds || []).map(Number));
  const rows = await rdbSelect("community_memberships", "community_id,status", (request) =>
    request.eq("user_id", userId).eq("status", "active").limit(100)
  ).catch(() => []);
  const match = rows.find((item) => allowed.has(Number(item.community_id)));
  if (!match) {
    const error = new Error("只能维护本社区成员的引荐关系");
    error.code = "FORBIDDEN";
    throw error;
  }
  return Number(match.community_id);
}

async function adminSetUserReferral(data) {
  const session = await assertAdmin(data);
  const referredUserId = id(data.userId || data.referredUserId, "userId");
  if (session && session.role !== "super_admin") await assertUserInSessionCommunities(data, referredUserId);
  const referrerKey = normalizePublicUserCode(data.referrerUserCode || data.referrerCode || data.referrerUserId);
  if (!referrerKey) {
    await rdbUpdate("user_referrals", { status: "revoked", note: text(data.note, 500) }, (request) =>
      request.eq("referred_user_id", referredUserId).eq("status", "active")
    ).catch(() => {});
    return { success: true, saved: true, revoked: true };
  }

  const referrer = await findUserByPublicCodeOrId(referrerKey);
  if (!referrer) {
    const error = new Error("找不到这个引荐人用户ID");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (Number(referrer.id) === Number(referredUserId)) {
    const error = new Error("不能把自己设置为自己的引荐人");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (referrer.status && referrer.status !== "active") {
    const error = new Error("引荐人账号不是启用状态");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const communityId = await defaultReferralCommunityId(data, referredUserId);
  await rdbUpdate("user_referrals", { status: "replaced" }, (request) =>
    request.eq("referred_user_id", referredUserId).eq("status", "active")
  ).catch(() => {});
  await rdbInsert("user_referrals", {
    referred_user_id: referredUserId,
    referrer_user_id: Number(referrer.id),
    community_id: communityId || null,
    source: session && session.role === "community_admin" ? "community_admin" : "admin",
    status: "active",
    note: text(data.note, 500),
    created_by_admin_account_id: session && session.accountId ? Number(session.accountId) : null,
  });
  return {
    success: true,
    saved: true,
    referral: {
      referred_user_id: referredUserId,
      referrer_user_id: Number(referrer.id),
      referrer_public_user_code: referrer.public_user_code || "",
      referrer_display_name: referrer.display_name || "",
      community_id: communityId || null,
    },
  };
}

async function adminDeleteUser(data) {
  requireSuperAdmin(data);
  const userId = id(data.userId, "userId");
  await rdbUpdate("users", { status: "disabled", is_admin: 0 }, (request) => request.eq("id", userId));
  return { success: true, saved: true };
}

async function adminSaveUserCommunity(data) {
  const userId = id(data.userId, "userId");
  const communityId = id(data.communityId, "communityId");
  requireCommunityAccess(data, communityId);
  const values = {
    community_id: communityId,
    user_id: userId,
    status: data.status === "revoked" ? "revoked" : "active",
    tags_json: json(tags(data.tagsText || data.tags), []),
    certified_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  const existing = await rdbSelect("community_memberships", "id", (request) =>
    request.eq("community_id", communityId).eq("user_id", userId).limit(1)
  ).catch(() => []);
  if (existing[0]) await rdbUpdate("community_memberships", values, (request) => request.eq("id", existing[0].id));
  else await rdbInsert("community_memberships", values);
  return { success: true, saved: true };
}

async function adminRevokeUserCommunity(data) {
  const userId = id(data.userId, "userId");
  const communityId = id(data.communityId, "communityId");
  requireCommunityAccess(data, communityId);
  await rdbUpdate("community_memberships", { status: "revoked" }, (request) =>
    request.eq("community_id", communityId).eq("user_id", userId)
  );
  return { success: true, saved: true };
}

async function adminUpdateCommunity(data) {
  requireSuperAdmin(data);
  const communityId = data.communityId ? id(data.communityId, "communityId") : null;
  const patch = data.patch || {};
  const values = {};
  if (patch.name !== undefined) values.name = text(patch.name, 120);
  if (patch.badgeName !== undefined) values.badge_name = text(patch.badgeName, 40);
  if (patch.description !== undefined) values.description = text(patch.description, 3000);
  if (patch.logoUrl !== undefined) values.logo_url = text(patch.logoUrl, 1000);
  if (patch.status !== undefined) values.status = ["paused", "archived"].includes(patch.status) ? patch.status : "active";
  if (patch.sortWeight !== undefined) values.sort_weight = Number(patch.sortWeight || 0);
  if (!Object.keys(values).length) return { success: true, saved: false };
  if (communityId) {
    await rdbUpdate("communities", values, (request) => request.eq("id", communityId));
    return { success: true, saved: true, communityId };
  }
  if (!values.name || !values.badge_name) {
    const error = new Error("新建社区需要填写社区名称和徽章名称");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  await rdbInsert("communities", {
    name: values.name,
    badge_name: values.badge_name,
    description: values.description || "",
    logo_url: values.logo_url || "",
    status: values.status || "active",
    sort_weight: values.sort_weight || 0,
  });
  const rows = await rdbSelect("communities", "id", (request) =>
    request.eq("name", values.name).order("created_at", { ascending: false }).limit(1)
  );
  return { success: true, saved: true, communityId: rows[0] && rows[0].id };
}

async function adminSearchUsersForCertification(data) {
  const communityId = id(data.communityId, "communityId");
  requireCommunityAccess(data, communityId);
  const keyword = text(data.keyword, 80);
  if (!keyword) return { success: true, users: [] };
  const users = await rdbSelect("users", "id,openid,public_user_code,display_name,avatar_url,status,experience_points", (request) =>
    request.order("updated_at", { ascending: false }).limit(1000)
  );
  const userIds = users.map((item) => Number(item.id)).filter(Boolean);
  const profiles = userIds.length
    ? await rdbSelect("user_profiles", "user_id,name,job,wechat,tags_json", (request) => request.in("user_id", userIds).limit(1000)).catch(() => [])
    : [];
  const memberships = userIds.length
    ? await rdbSelect("community_memberships", "user_id,community_id,status", (request) =>
        request.in("user_id", userIds).eq("community_id", communityId).limit(1000)
      ).catch(() => [])
    : [];
  const profileByUser = new Map(profiles.map((item) => [Number(item.user_id), { ...item, tags: parseJson(item.tags_json, []) }]));
  const membershipByUser = new Map(memberships.map((item) => [Number(item.user_id), item]));
  const normalizedKeyword = keyword.toLowerCase();
  const matched = users
    .map((item) => ({ ...item, profile: profileByUser.get(Number(item.id)) || null, membership: membershipByUser.get(Number(item.id)) || null }))
    .filter((item) => {
      const haystack = [
        item.id,
        item.public_user_code,
        item.openid,
        item.display_name,
        item.profile && item.profile.name,
        item.profile && item.profile.job,
        item.profile && item.profile.wechat,
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedKeyword);
    })
    .slice(0, 20);
  return { success: true, users: matched };
}

async function getAdminAccountCommunities(accountIds) {
  const ids = (accountIds || []).map(Number).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await rdbSelect("admin_account_communities", "account_id,community_id", (request) =>
    request.in("account_id", ids).limit(3000)
  ).catch(() => []);
  const map = new Map();
  rows.forEach((row) => {
    const key = Number(row.account_id);
    const list = map.get(key) || [];
    list.push(Number(row.community_id));
    map.set(key, list);
  });
  return map;
}

async function findDbAdminAccount(username) {
  const rows = await rdbSelect("admin_accounts", "*", (request) =>
    request.eq("username", text(username, 120)).eq("status", "active").limit(1)
  ).catch(() => []);
  const account = rows[0];
  if (!account) return null;
  const communityMap = await getAdminAccountCommunities([account.id]);
  return {
    accountId: Number(account.id),
    username: account.username,
    passwordHash: account.password_hash,
    role: account.role === "super_admin" ? "super_admin" : "community_admin",
    communityIds: communityMap.get(Number(account.id)) || [],
  };
}

async function listAdminAccounts(data) {
  requireSuperAdmin(data);
  const rows = await rdbSelect("admin_accounts", "id,username,role,status,display_name,created_at,updated_at", (request) =>
    request.order("created_at", { ascending: false }).limit(300)
  ).catch(() => []);
  const communityMap = await getAdminAccountCommunities(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    communityIds: communityMap.get(Number(row.id)) || [],
  }));
}

async function adminUpsertAdminAccount(data) {
  requireSuperAdmin(data);
  const accountId = data.accountId ? id(data.accountId, "accountId") : null;
  const patch = data.patch || {};
  const username = text(patch.username, 120);
  const role = patch.role === "super_admin" ? "super_admin" : "community_admin";
  const status = patch.status === "disabled" ? "disabled" : "active";
  const communityIds = Array.isArray(patch.communityIds) ? patch.communityIds.map(Number).filter(Boolean) : [];
  if (!accountId && !username) {
    const error = new Error("账号不能为空");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (role === "community_admin" && !communityIds.length) {
    const error = new Error("社区管理员至少要绑定一个社区");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const values = {
    role,
    status,
    display_name: text(patch.displayName || patch.username, 120),
  };
  if (username) values.username = username;
  if (patch.password) values.password_hash = hashPassword(patch.password);
  if (!accountId && !values.password_hash) {
    const error = new Error("新建管理员需要设置密码");
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  let savedAccountId = accountId;
  if (accountId) {
    await rdbUpdate("admin_accounts", values, (request) => request.eq("id", accountId));
  } else {
    await rdbInsert("admin_accounts", values);
    const rows = await rdbSelect("admin_accounts", "id", (request) =>
      request.eq("username", username).order("created_at", { ascending: false }).limit(1)
    );
    savedAccountId = Number(rows[0] && rows[0].id);
  }
  if (!savedAccountId) throw Object.assign(new Error("管理员账号保存失败"), { code: "SAVE_FAILED" });

  await rdbDelete("admin_account_communities", (request) => request.eq("account_id", savedAccountId));
  if (role === "community_admin") {
    for (const communityId of communityIds) {
      await rdbInsert("admin_account_communities", { account_id: savedAccountId, community_id: communityId });
    }
  }
  return { success: true, saved: true, accountId: savedAccountId };
}

async function adminDeleteAdminAccount(data) {
  requireSuperAdmin(data);
  const accountId = id(data.accountId, "accountId");
  await rdbUpdate("admin_accounts", { status: "disabled" }, (request) => request.eq("id", accountId));
  return { success: true, saved: true };
}

async function adminUpsertExperienceRule(data) {
  const session = requireSuperAdmin(data);
  const rule = data.rule || {};
  const ruleKey = text(rule.ruleKey || rule.rule_key, 80);
  if (!/^[a-z0-9_:-]{3,80}$/i.test(ruleKey)) {
    const error = new Error("经验规则 key 格式不正确");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const values = {
    rule_key: ruleKey,
    label: text(rule.label, 120) || ruleKey,
    description: text(rule.description, 500),
    points: Number(rule.points || 0),
    status: rule.status === "disabled" ? "disabled" : "active",
    sort_order: Number(rule.sortOrder ?? rule.sort_order ?? 0),
    updated_by: session.accountId || null,
  };
  const existing = await rdbSelect("experience_rules", "id", (request) => request.eq("rule_key", ruleKey).limit(1)).catch(() => []);
  if (existing[0]) {
    await rdbUpdate("experience_rules", values, (request) => request.eq("id", existing[0].id));
  } else {
    await rdbInsert("experience_rules", values);
  }
  return { success: true, saved: true, ruleKey };
}

async function saveCoverAfterBusiness(data, result) {
  if (!result || !result.success) return result;
  if (data.action === "adminCreateProject" && data.project && data.project.coverUrl !== undefined && result.projectId) {
    await rdbUpdate("projects", { cover_url: text(data.project.coverUrl, 1000) }, (request) => request.eq("id", id(result.projectId, "projectId")));
  }
  if (data.action === "adminCreateEvent" && data.event && data.event.coverUrl !== undefined && result.eventId) {
    await rdbUpdate("official_events", { cover_url: text(data.event.coverUrl, 1000) }, (request) => request.eq("id", id(result.eventId, "eventId")));
  }
  if (data.action === "adminUpdateProject" && data.patch && data.patch.coverUrl !== undefined) {
    await rdbUpdate("projects", { cover_url: text(data.patch.coverUrl, 1000) }, (request) => request.eq("id", id(data.projectId, "projectId")));
  }
  if (data.action === "adminUpdateEvent" && data.event && data.event.coverUrl !== undefined) {
    await rdbUpdate("official_events", { cover_url: text(data.event.coverUrl, 1000) }, (request) => request.eq("id", id(data.eventId, "eventId")));
  }
  return result;
}

function billingClientCommunityId(client) {
  return Number(client && (client.communityId ?? client.community_id ?? (client.community && client.community.id))) || 0;
}

function billingRowClientId(row) {
  return Number(row && (row.appClientId ?? row.app_client_id ?? row.clientId ?? row.client_id)) || 0;
}

function sumBillingUsage(rows, camelKey, snakeKey) {
  return (rows || []).reduce((total, row) => total + Number(row[camelKey] ?? row[snakeKey] ?? 0), 0);
}

function scopeBillingResult(payload, session) {
  if (!session || session.role === "super_admin") return payload;
  const allowedCommunities = new Set((session.communityIds || []).map(Number));
  const clients = (payload.clients || []).filter((client) => allowedCommunities.has(billingClientCommunityId(client)));
  const allowedClientIds = new Set(clients.map((client) => Number(client.id ?? client.appClientId ?? client.app_client_id)).filter(Boolean));
  const usageEvents = (payload.usageEvents || []).filter((row) => allowedClientIds.has(billingRowClientId(row)));
  const walletLedger = (payload.walletLedger || []).filter((row) => allowedClientIds.has(billingRowClientId(row)));
  const rechargeOrders = (payload.rechargeOrders || []).filter((row) => allowedClientIds.has(billingRowClientId(row)));
  return {
    ...payload,
    clients,
    usageEvents,
    walletLedger,
    rechargeOrders,
    usageSummary: {
      baseUnits: sumBillingUsage(usageEvents, "baseUnits", "base_units"),
      ratedUnits: sumBillingUsage(usageEvents, "ratedUnits", "rated_units"),
      savedUnits: sumBillingUsage(usageEvents, "savedUnits", "saved_units"),
      surchargeUnits: sumBillingUsage(usageEvents, "surchargeUnits", "surcharge_units"),
      freeUnitsApplied: sumBillingUsage(usageEvents, "freeUnitsApplied", "free_units_applied"),
      chargedUnits: sumBillingUsage(usageEvents, "chargedUnits", "charged_units"),
      totalTokens: sumBillingUsage(usageEvents, "totalTokens", "total_tokens"),
      requestCount: usageEvents.length,
    },
  };
}

function billingTotalPages(payload) {
  const pagination = (payload && payload.pagination) || {};
  return Number(pagination.totalPages ?? pagination.total_pages ?? 1) || 1;
}

async function getCommunityBilling(data, session) {
  const discoveryData = businessData({ ...data, page: 1, pageSize: 1 });
  delete discoveryData.appClientId;
  const discovery = await callBusiness(discoveryData);
  if (!discovery || !discovery.success) return discovery;
  const allowedCommunities = new Set((session.communityIds || []).map(Number));
  const allowedClients = (discovery.clients || []).filter((client) => allowedCommunities.has(billingClientCommunityId(client)));
  const requestedClientId = Number(data.appClientId || 0);
  const targets = requestedClientId
    ? allowedClients.filter((client) => Number(client.id ?? client.appClientId ?? client.app_client_id) === requestedClientId)
    : allowedClients;
  if (requestedClientId && !targets.length) {
    const error = new Error("无权查看这个社区电力账户");
    error.code = "FORBIDDEN";
    throw error;
  }
  const responses = await Promise.all(targets.map((client) => callBusiness(businessData({
    ...data,
    appClientId: Number(client.id ?? client.appClientId ?? client.app_client_id),
  }))));
  const usageEvents = responses.flatMap((item) => item.usageEvents || []);
  const walletLedger = responses.flatMap((item) => item.walletLedger || []);
  const rechargeOrders = responses.flatMap((item) => item.rechargeOrders || []);
  const platform = discovery.platformBillingSettings || {};
  return {
    success: true,
    clients: targets,
    platformBillingSettings: {
      powerPerCny: platform.powerPerCny ?? platform.power_per_cny,
      pricingLabel: platform.pricingLabel ?? platform.pricing_label,
    },
    usageEvents,
    walletLedger,
    rechargeOrders,
    usageSummary: {
      baseUnits: sumBillingUsage(usageEvents, "baseUnits", "base_units"),
      ratedUnits: sumBillingUsage(usageEvents, "ratedUnits", "rated_units"),
      savedUnits: sumBillingUsage(usageEvents, "savedUnits", "saved_units"),
      surchargeUnits: sumBillingUsage(usageEvents, "surchargeUnits", "surcharge_units"),
      freeUnitsApplied: sumBillingUsage(usageEvents, "freeUnitsApplied", "free_units_applied"),
      chargedUnits: sumBillingUsage(usageEvents, "chargedUnits", "charged_units"),
      totalTokens: sumBillingUsage(usageEvents, "totalTokens", "total_tokens"),
      requestCount: usageEvents.length,
    },
    pagination: {
      page: Number(data.page || 1),
      pageSize: Number(data.pageSize || 100),
      totalPages: Math.max(1, ...responses.map(billingTotalPages)),
    },
  };
}

async function adminProxyAction(data) {
  const billingActions = new Set([
    "adminGetAppClientBilling",
    "adminUpsertAppClient",
    "adminAdjustAppClientBalance",
    "adminUpdatePlatformBillingSettings",
    "adminUpdateAppClientBillingSettings",
    "adminSetAppClientWalletStatus",
    "adminRotateAppClientBillingReadToken",
  ]);
  if (billingActions.has(data.action) && data.action !== "adminGetAppClientBilling") requireSuperAdmin(data);
  if (data.action === "adminGetAppClientBilling") {
    await assertAdmin(data);
    const session = sessionFromData(data);
    if (session && session.role === "community_admin") return getCommunityBilling(data, session);
    return callBusiness(businessData(data));
  }
  if (data.action === "adminList") {
    await assertAdmin(data);
    const session = sessionFromData(data);
    const result = await callBusiness(businessData(data));
    if (!result || !result.success) return result;
    const enriched = await enrichAdminList(result);
    if (session && session.role === "super_admin") {
      enriched.adminAccounts = await listAdminAccounts(data);
    }
    return applyAdminScope(enriched, session);
  }
  if (data.action === "adminSearchUsersForCertification") {
    await assertAdmin(data);
    return adminSearchUsersForCertification(data);
  }
  if (data.action === "adminUpsertAdminAccount" || data.action === "adminDeleteAdminAccount") {
    await assertAdmin(data);
    if (data.action === "adminDeleteAdminAccount") return adminDeleteAdminAccount(data);
    return adminUpsertAdminAccount(data);
  }
  if (data.action === "adminUpsertExperienceRule") {
    await assertAdmin(data);
    return adminUpsertExperienceRule(data);
  }
  if (["adminUpdateUser", "adminDeleteUser", "adminSaveUserCommunity", "adminRevokeUserCommunity", "adminUpdateCommunity", "adminSetUserReferral"].includes(data.action)) {
    await assertAdmin(data);
    if (data.action === "adminUpdateUser") return adminUpdateUser(data);
    if (data.action === "adminDeleteUser") return adminDeleteUser(data);
    if (data.action === "adminSetUserReferral") return adminSetUserReferral(data);
    if (data.action === "adminUpdateCommunity") return adminUpdateCommunity(data);
    if (data.action === "adminRevokeUserCommunity") return adminRevokeUserCommunity(data);
    return adminSaveUserCommunity(data);
  }
  await assertScopedBusinessAction(data);
  const result = await callBusiness(businessData(data));
  return saveCoverAfterBusiness(data, result);
}

async function login(data) {
  const username = String(data.username || "");
  const password = String(data.password || "");
  const superAccount = { username: superUsername, password: superPassword, role: "super_admin", communityIds: [] };
  let account = null;
  if (superPassword && username === superAccount.username && password === superAccount.password) {
    account = superAccount;
  }
  if (!account) {
    const dbAccount = await findDbAdminAccount(username);
    if (dbAccount && verifyPassword(password, dbAccount.passwordHash)) account = dbAccount;
  }
  if (!account) {
    account = communityAccounts.find((item) => item.username === username && item.password === password);
  }
  if (!superPassword && !communityAccounts.length) {
    const dbAccount = await findDbAdminAccount(username);
    if (!dbAccount) {
      const error = new Error("服务器未配置超级管理员密码，且未找到数据库管理员账号");
      error.code = "LOGIN_NOT_CONFIGURED";
      throw error;
    }
  }
  if (!account) {
    const error = new Error("账号或密码不正确");
    error.code = "LOGIN_FAILED";
    throw error;
  }
  if (account.role === "community_admin" && !account.communityIds.length) {
    const error = new Error("该社区管理员没有绑定社区");
    error.code = "LOGIN_NOT_CONFIGURED";
    throw error;
  }
  return {
    success: true,
    sessionToken: createSessionToken(account),
    role: account.role,
    communityIds: account.communityIds || [],
    expiresInSeconds: 12 * 60 * 60,
  };
}

async function adminUploadAsset(data) {
  await assertAdmin(data);
  let contentType = data.contentType;
  let fileContent = data.fileContent;
  if (!fileContent) {
    const match = String(data.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      const error = new Error("上传内容格式不正确");
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    contentType = match[1];
    fileContent = Buffer.from(match[2], "base64");
  }
  if (!/^image\/(png|jpe?g|webp)$/.test(contentType)) {
    const error = new Error("只支持 png、jpg、webp 图片");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (!Buffer.isBuffer(fileContent) || !fileContent.length) {
    const error = new Error("图片内容为空");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (fileContent.length > 8 * 1024 * 1024) {
    const error = new Error("图片不能超过 8MB");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const ext = fileExtension(data.filename, contentType);
  const kind = safeAssetKind(data.kind);
  const cloudPath = `daimao/admin/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const result = await getApp().uploadFile({ cloudPath, fileContent });
  let tempFileURL = "";
  try {
    const urlResult = await getApp().getTempFileURL({ fileList: [result.fileID] });
    tempFileURL = (urlResult.fileList && urlResult.fileList[0] && (urlResult.fileList[0].tempFileURL || urlResult.fileList[0].download_url)) || "";
  } catch (err) {
    console.warn("获取上传图片临时 URL 失败", err.message);
  }
  return {
    success: true,
    fileID: result.fileID,
    cloudPath,
    tempFileURL,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { success: true, env, region, functionName });
    }
    if (request.method === "POST" && request.url === "/api/login") {
      const data = await readJson(request);
      return sendJson(response, 200, await login(data));
    }
    const url = new URL(request.url, `http://${request.headers.host || host}`);
    if (request.method === "POST" && url.pathname === "/api/upload") {
      const contentType = String(request.headers["content-type"] || "");
      let data;
      if (contentType.startsWith("application/json")) {
        data = await readJson(request);
      } else {
        data = {
          adminSessionToken: request.headers["x-admin-session-token"],
          kind: url.searchParams.get("kind"),
          filename: url.searchParams.get("filename") || request.headers["x-filename"],
          contentType,
          fileContent: await readBuffer(request),
        };
      }
      const result = await adminUploadAsset(data);
      return sendJson(response, 200, result);
    }
    if (request.method !== "POST" || request.url !== "/api/admin") {
      return sendJson(response, 404, { success: false, message: "Not found" });
    }

    const data = await readJson(request);
    if (!data || typeof data.action !== "string") {
      return sendJson(response, 400, { success: false, message: "缺少 action" });
    }

    const result = await adminProxyAction(data);
    return sendJson(response, 200, result);
  } catch (err) {
    console.error("admin proxy error", {
      code: err.code,
      message: err.message,
      stack: err.stack,
    });
    return sendJson(response, 500, publicError(err));
  }
});

server.listen(port, host, () => {
  console.log(`OPC data center admin api listening on http://${host}:${port}/api/admin`);
});
