const http = require("http");
const cloudbase = require("@cloudbase/node-sdk");

const env = process.env.CLOUDBASE_ENV || process.env.ADMIN_API_CLOUDBASE_ENV || "cloud1-8gocbg40af3862ce";
const functionName = process.env.CLOUDBASE_FUNCTION || process.env.ADMIN_API_CLOUDBASE_FUNCTION || "daimaoBusiness";
const region = process.env.CLOUDBASE_REGION || process.env.ADMIN_API_CLOUDBASE_REGION || "ap-shanghai";
const port = Number(process.env.ADMIN_API_PORT || 8090);
const host = process.env.ADMIN_API_HOST || "127.0.0.1";
const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.CLOUDBASE_SECRET_ID || process.env.CLOUDBASE_SECRETID;
const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.CLOUDBASE_SECRET_KEY || process.env.CLOUDBASE_SECRETKEY;

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
    const error = new Error(`${action || "CloudBase RDB"} 失败`);
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

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
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
  return ["project-cover", "event-cover", "community-logo"].includes(value) ? value : "misc";
}

async function callBusiness(data) {
  const result = await getApp().callFunction({
    name: functionName,
    data,
  });
  return result.result || result;
}

async function assertAdmin(data) {
  if (!data || !data.adminWebToken) {
    const error = new Error("请先填写后台访问令牌");
    error.code = "FORBIDDEN";
    throw error;
  }
  const result = await callBusiness({ action: "adminList", adminWebToken: data.adminWebToken });
  if (!result || !result.success) {
    const error = new Error((result && result.message) || "后台令牌校验失败");
    error.code = (result && result.code) || "FORBIDDEN";
    throw error;
  }
  return result;
}

async function enrichAdminList(payload) {
  const userIds = (payload.users || []).map((item) => Number(item.id)).filter(Boolean);
  const [communities, memberships, profiles, projectMembers, projectRecords, experienceEvents] = await Promise.all([
    rdbSelect("communities", "*", (request) => request.order("sort_weight", { ascending: false }).limit(300)).catch(() => []),
    userIds.length ? rdbSelect("community_memberships", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("user_profiles", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("project_members", "*", (request) => request.in("user_id", userIds).limit(3000)).catch(() => []) : [],
    userIds.length ? rdbSelect("project_records", "id,project_id,uploader_user_id,title,record_type,visibility,ai_process_status,created_at", (request) => request.in("uploader_user_id", userIds).order("created_at", { ascending: false }).limit(500)).catch(() => []) : [],
    userIds.length ? rdbSelect("user_experience_events", "*", (request) => request.in("user_id", userIds).order("created_at", { ascending: false }).limit(500)).catch(() => []) : [],
  ]);
  const communityMap = new Map(communities.map((item) => [Number(item.id), item]));
  const profilesByUser = new Map(profiles.map((item) => [Number(item.user_id), { ...item, tags: parseJson(item.tags_json, []), answers: parseJson(item.answers_json, []) }]));
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
  return {
    ...payload,
    communities,
    communityMemberships: memberships,
    userProfiles: profiles,
    projectMembers,
    projectRecords,
    experienceEvents,
    users: (payload.users || []).map((item) => ({
      ...item,
      profile: profilesByUser.get(Number(item.id)) || null,
      communities: membershipsByUser.get(Number(item.id)) || [],
    })),
  };
}

async function adminUpdateUser(data) {
  const userId = id(data.userId, "userId");
  const patch = data.patch || {};
  const userValues = {};
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
  if (patch.profileTags !== undefined) profileValues.tags_json = json(tags(patch.profileTags), []);
  if (Object.keys(profileValues).length) {
    const existing = await rdbSelect("user_profiles", "id", (request) => request.eq("user_id", userId).limit(1)).catch(() => []);
    if (existing[0]) await rdbUpdate("user_profiles", profileValues, (request) => request.eq("id", existing[0].id));
    else await rdbInsert("user_profiles", { user_id: userId, ...profileValues });
  }

  return { success: true, saved: true };
}

async function adminDeleteUser(data) {
  const userId = id(data.userId, "userId");
  await rdbUpdate("users", { status: "disabled", is_admin: 0 }, (request) => request.eq("id", userId));
  return { success: true, saved: true };
}

async function adminSaveUserCommunity(data) {
  const userId = id(data.userId, "userId");
  const communityId = id(data.communityId, "communityId");
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

async function saveCoverAfterBusiness(data, result) {
  if (!result || !result.success) return result;
  if (data.action === "adminUpdateProject" && data.patch && data.patch.coverUrl !== undefined) {
    await rdbUpdate("projects", { cover_url: text(data.patch.coverUrl, 1000) }, (request) => request.eq("id", id(data.projectId, "projectId")));
  }
  if (data.action === "adminUpdateEvent" && data.event && data.event.coverUrl !== undefined) {
    await rdbUpdate("official_events", { cover_url: text(data.event.coverUrl, 1000) }, (request) => request.eq("id", id(data.eventId, "eventId")));
  }
  return result;
}

async function adminProxyAction(data) {
  if (data.action === "adminList") {
    const result = await callBusiness(data);
    if (!result || !result.success) return result;
    return enrichAdminList(result);
  }
  if (["adminUpdateUser", "adminDeleteUser", "adminSaveUserCommunity"].includes(data.action)) {
    await assertAdmin(data);
    if (data.action === "adminUpdateUser") return adminUpdateUser(data);
    if (data.action === "adminDeleteUser") return adminDeleteUser(data);
    return adminSaveUserCommunity(data);
  }
  const result = await callBusiness(data);
  return saveCoverAfterBusiness(data, result);
}

async function adminUploadAsset(data) {
  await assertAdmin(data);
  const match = String(data.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    const error = new Error("上传内容格式不正确");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const contentType = match[1];
  if (!/^image\/(png|jpe?g|webp)$/.test(contentType)) {
    const error = new Error("只支持 png、jpg、webp 图片");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const fileContent = Buffer.from(match[2], "base64");
  if (fileContent.length > 5 * 1024 * 1024) {
    const error = new Error("图片不能超过 5MB");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const ext = fileExtension(data.filename, contentType);
  const kind = safeAssetKind(data.kind);
  const cloudPath = `daimao/admin/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const result = await getApp().uploadFile({ cloudPath, fileContent });
  return {
    success: true,
    fileID: result.fileID,
    cloudPath,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { success: true, env, region, functionName });
    }
    if (request.method === "POST" && request.url === "/api/upload") {
      const data = await readJson(request);
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
  console.log(`daimao admin api listening on http://${host}:${port}/api/admin`);
});
