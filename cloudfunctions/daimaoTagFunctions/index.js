const cloud = require("wx-server-sdk");
const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  tags: "daimao_nfc_tags",
  profiles: "daimao_user_profiles",
  visits: "daimao_tag_visits",
  subscriptions: "daimao_profile_reminder_subscriptions",
};
const AGREEMENT_VERSION = "2026-06-13-v2";
const PROFILE_REMINDER_TEMPLATE_ID = "g_4-pPRh3dGyv9EEUNscNu81ZDGfwS-QkDdpyWv-lFU";
const DAIMAO_APP_ID = "wx2bc83fb7b03cd3d1";
const SQL_SYNC_ENABLED = process.env.TAG_SQL_SYNC !== "false";
let cloudbaseApp;
let rdbClient;

function now() {
  return db.serverDate();
}

function getRdb() {
  if (!rdbClient) {
    cloudbaseApp = cloudbase.init({
      env: process.env.CLOUDBASE_ENV || cloudbase.SYMBOL_CURRENT_ENV || cloudbase.SYMBOL_DEFAULT_ENV,
    });
    rdbClient = cloudbaseApp.rdb();
  }
  return rdbClient;
}

function assertRdb(result, action) {
  if (result && result.error) {
    const error = new Error(`${action || "CloudBase RDB"} failed`);
    error.code = "RDB_ERROR";
    error.details = result.error;
    throw error;
  }
  return result || {};
}

async function rdbSelect(table, columns = "*", build) {
  let request = getRdb().from(table).select(columns);
  if (build) request = build(request);
  const result = assertRdb(await request, `select ${table}`);
  return result.data || [];
}

async function rdbInsert(table, values) {
  return assertRdb(await getRdb().from(table).insert(values), `insert ${table}`);
}

async function rdbUpdate(table, values, build) {
  let request = getRdb().from(table).update(values);
  if (build) request = build(request);
  return assertRdb(await request, `update ${table}`);
}

async function rdbDelete(table, build) {
  let request = getRdb().from(table).delete();
  if (build) request = build(request);
  return assertRdb(await request, `delete ${table}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function splitChunks(content, maxLength = 900) {
  const text = String(content || "").trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  paragraphs.forEach((paragraph) => {
    if (!current) {
      current = paragraph;
      return;
    }
    if (`${current}\n\n${paragraph}`.length <= maxLength) {
      current = `${current}\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  });
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxLength) return [chunk];
    const parts = [];
    for (let index = 0; index < chunk.length; index += maxLength) {
      parts.push(chunk.slice(index, index + maxLength));
    }
    return parts;
  });
}

function defaultPublicUserCode(userId) {
  const value = Number(userId || 0);
  if (!value) return "";
  return String(value).padStart(3, "0");
}

async function ensurePublicUserCode(user) {
  if (!SQL_SYNC_ENABLED || !user || !user.id || user.public_user_code) return user;
  const publicUserCode = defaultPublicUserCode(user.id);
  if (!publicUserCode) return user;
  await rdbUpdate("users", { public_user_code: publicUserCode }, (request) => request.eq("id", user.id)).catch(() => {});
  return { ...user, public_user_code: publicUserCode };
}

function detectPolarity(content) {
  const text = String(content || "");
  if (/不擅长|不适合|不会|不能|缺少|短板|避免|拒绝|不希望/.test(text)) return "negative";
  if (/喜欢|希望|倾向|偏好|想要|感兴趣/.test(text)) return "preference";
  if (/擅长|负责|完成|经验|做过|主理|参与|交付/.test(text)) return "positive";
  return "neutral";
}

async function ensureSqlUser(openid, profile = {}) {
  const userId = String(openid || "").trim();
  if (!userId || !SQL_SYNC_ENABLED) return null;
  const existing = await rdbSelect("users", "*", (request) => request.eq("openid", userId).limit(1));
  if (existing[0]) {
    await rdbUpdate(
      "users",
      {
        display_name: String(profile.name || profile.display_name || existing[0].display_name || "").trim(),
        avatar_url: profile.avatar || profile.avatar_url || existing[0].avatar_url || "",
      },
      (request) => request.eq("id", existing[0].id)
    );
    const rows = await rdbSelect("users", "*", (request) => request.eq("openid", userId).limit(1));
    return ensurePublicUserCode(rows[0] || existing[0]);
  }
  await rdbInsert("users", {
    openid: userId,
    display_name: String(profile.name || profile.display_name || "").trim(),
    avatar_url: profile.avatar || profile.avatar_url || "",
    status: "active",
    is_admin: 0,
    experience_points: 0,
  });
  const rows = await rdbSelect("users", "*", (request) => request.eq("openid", userId).limit(1));
  return ensurePublicUserCode(rows[0] || null);
}

function buildProfileRagContent(profile) {
  const tags = Array.isArray(profile.tags_json) ? profile.tags_json : parseJson(profile.tags_json, []);
  const answers = Array.isArray(profile.answers_json) ? profile.answers_json : parseJson(profile.answers_json, []);
  const lines = [
    `资料类型：呆猫名片`,
    `姓名：${profile.name || ""}`,
    `工作：${profile.job || ""}`,
    `个人简介：${profile.intro || ""}`,
  ];
  if (tags.length) lines.push(`标签：${tags.join("、")}`);
  answers.forEach((item, index) => {
    if (!item || !item.q || !item.a) return;
    lines.push(`问答${index + 1}：${item.q}`);
    lines.push(`回答${index + 1}：${item.a}`);
  });
  return lines.filter((line) => !/：$/.test(line)).join("\n");
}

async function upsertProfileRagSource(user, profile) {
  if (!user || !profile || !profile.id || !SQL_SYNC_ENABLED) return null;
  const content = buildProfileRagContent(profile);
  if (!content) return null;
  const contentHash = sha256(content);
  const tags = parseJson(profile.tags_json, []);
  const metadata = {
    sourceChannel: "profile_save",
    openid: user.openid || "",
    profileStatus: profile.profile_status || "",
  };
  const existing = await rdbSelect("rag_sources", "*", (request) =>
    request.eq("source_type", "profile").eq("source_id", profile.id).limit(1)
  );
  let sourceId = existing[0] && existing[0].id;
  const payload = {
    source_type: "profile",
    source_id: profile.id,
    owner_user_id: user.id,
    title: `${profile.name || user.display_name || "未命名"} 的呆猫名片`,
    summary: truncate(content, 1200),
    tags_json: JSON.stringify(tags),
    visibility: "match_only",
    status: "pending",
    version: Number((existing[0] && existing[0].version) || 1),
    text_hash: contentHash,
    metadata_json: JSON.stringify(metadata),
  };
  if (sourceId) {
    await rdbUpdate("rag_sources", payload, (request) => request.eq("id", sourceId));
    await rdbDelete("rag_chunks", (request) => request.eq("source_id", sourceId));
  } else {
    await rdbInsert("rag_sources", payload);
    const rows = await rdbSelect("rag_sources", "id", (request) =>
      request.eq("source_type", "profile").eq("source_id", profile.id).limit(1)
    );
    sourceId = rows[0] && rows[0].id;
  }
  if (!sourceId) return null;
  const chunks = splitChunks(content);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await rdbInsert("rag_chunks", {
      source_id: sourceId,
      chunk_index: index,
      content: chunk,
      content_summary: truncate(chunk, 240),
      vector_doc_id: `rag_${sourceId}_${index}`,
      evidence_polarity: detectPolarity(chunk),
      confidence: 0.82,
      status: "pending",
    });
  }
  await rdbInsert("rag_index_jobs", {
    source_id: sourceId,
    job_type: "upsert",
    status: "pending",
  });
  return { sourceId, chunks: chunks.length };
}

async function syncProfileToSql(profile, sourceProfileId = "") {
  if (!profile || !profile.userId || !SQL_SYNC_ENABLED) return null;
  const user = await ensureSqlUser(profile.userId, profile);
  if (!user) return null;
  const payload = {
    user_id: user.id,
    source_profile_id: sourceProfileId || profile._id || "",
    name: String(profile.name || "").trim(),
    job: String(profile.job || "").trim(),
    wechat: String(profile.wechat || "").trim(),
    avatar_url: profile.avatar || "",
    intro: String(profile.intro || "").trim(),
    answers_json: JSON.stringify(Array.isArray(profile.answers) ? profile.answers : []),
    tags_json: JSON.stringify(Array.isArray(profile.tags) ? profile.tags : []),
    sticker_code: profile.stickerCode || "",
    agreement_version: profile.agreementVersion || "",
    profile_status: profile.name && profile.job && profile.wechat && profile.intro ? "complete" : "draft",
  };
  const existing = await rdbSelect("user_profiles", "*", (request) => request.eq("user_id", user.id).limit(1));
  if (existing[0]) {
    await rdbUpdate("user_profiles", payload, (request) => request.eq("user_id", user.id));
  } else {
    await rdbInsert("user_profiles", payload);
  }
  const savedProfiles = await rdbSelect("user_profiles", "*", (request) => request.eq("user_id", user.id).limit(1));
  const savedProfile = savedProfiles[0] || null;
  if (savedProfile) {
    await upsertProfileRagSource(user, savedProfile);
  }
  if (!existing[0] && payload.profile_status === "complete") {
    await rdbInsert("user_experience_events", {
      user_id: user.id,
      event_type: "register_profile",
      points: 10,
      source_type: "user_profiles",
      source_id: user.id,
      note: "注册并保存呆猫名片",
      created_by: user.id,
    });
    await rdbUpdate("users", { experience_points: Number(user.experience_points || 0) + 10 }, (request) => request.eq("id", user.id));
  }
  return { user, profile: savedProfile };
}

async function upsertSqlConnection(ownerOpenid, visitorOpenid, source = "other") {
  if (!ownerOpenid || !visitorOpenid || ownerOpenid === visitorOpenid || !SQL_SYNC_ENABLED) return null;
  const [owner, visitor] = await Promise.all([ensureSqlUser(ownerOpenid), ensureSqlUser(visitorOpenid)]);
  if (!owner || !visitor) return null;
  const pairs = [
    [owner.id, visitor.id],
    [visitor.id, owner.id],
  ];
  for (const [userId, friendUserId] of pairs) {
    const existing = await rdbSelect("user_connections", "*", (request) =>
      request.eq("user_id", userId).eq("friend_user_id", friendUserId).limit(1)
    );
    if (existing[0]) {
      await rdbUpdate(
        "user_connections",
        {
          source: source === "share_card" ? "share_card" : source === "nfc" ? "nfc" : "other",
          visit_count: Number(existing[0].visit_count || 0) + 1,
          status: "active",
        },
        (request) => request.eq("id", existing[0].id)
      );
    } else {
      await rdbInsert("user_connections", {
        user_id: userId,
        friend_user_id: friendUserId,
        source: source === "share_card" ? "share_card" : source === "nfc" ? "nfc" : "other",
        status: "active",
        visit_count: 1,
      });
    }
  }
  return { ownerUserId: owner.id, visitorUserId: visitor.id };
}

function getContextUserIds() {
  const wxContext = cloud.getWXContext();
  return Array.from(new Set([wxContext.FROM_OPENID, wxContext.OPENID].filter(Boolean)));
}

function getContextUserId() {
  return getContextUserIds()[0] || "";
}

function sanitizeToken(token) {
  return String(token || "").trim().toUpperCase();
}

function publicTag(tag, ownerProfile) {
  if (!tag) return null;
  return {
    id: tag._id,
    tagCode: tag.tagCode,
    claimToken: tag.claimToken,
    ownerUserId: tag.ownerUserId || "",
    status: tag.status,
    batchNo: tag.batchNo || "",
    createdAt: tag.createdAt || "",
    boundAt: tag.boundAt || "",
    lastVisitedAt: tag.lastVisitedAt || "",
    ownerProfile: ownerProfile || null,
  };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.userId || profile.id || "",
    userId: profile.userId || profile.id || "",
    name: profile.name || "",
    job: profile.job || "",
    wechat: profile.wechat || "",
    avatar: profile.avatar || "",
    intro: profile.intro || "",
    answers: Array.isArray(profile.answers) ? profile.answers : [],
    tags: Array.isArray(profile.tags) ? profile.tags : [],
  };
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    return fallback;
  }
}

function publicSqlProfile(user, profile, communities = []) {
  if (!user || !profile) return null;
  return {
    id: user.openid || String(user.id || ""),
    userId: user.openid || String(user.id || ""),
    name: profile.name || user.display_name || "",
    job: profile.job || "",
    wechat: profile.wechat || "",
    avatar: profile.avatar_url || user.avatar_url || "",
    intro: profile.intro || "",
    answers: parseJson(profile.answers_json, []),
    tags: parseJson(profile.tags_json, []),
    stickerCode: profile.sticker_code || "",
    agreementVersion: profile.agreement_version || "",
    profileStatus: profile.profile_status || "",
    communities,
  };
}

async function getUserCommunities(userId) {
  if (!userId || !SQL_SYNC_ENABLED) return [];
  try {
    const memberships = await rdbSelect("community_memberships", "*", (request) =>
      request.eq("user_id", userId).eq("status", "active").limit(100)
    );
    const communityIds = [...new Set(memberships.map((item) => Number(item.community_id)).filter(Boolean))];
    if (!communityIds.length) return [];
    const communities = await rdbSelect("communities", "*", (request) =>
      request.in("id", communityIds).eq("status", "active").limit(100)
    );
    const byId = new Map(communities.map((item) => [Number(item.id), item]));
    return memberships
      .map((item) => {
        const community = byId.get(Number(item.community_id));
        if (!community) return null;
        return {
          id: item.community_id,
          name: community.name || "",
          badge: community.badge_name || "",
          logoUrl: community.logo_url || "",
          tags: parseJson(item.tags_json, []),
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn("load user communities failed", err.message);
    return [];
  }
}

async function getSqlProfileByOpenid(openid) {
  if (!openid || !SQL_SYNC_ENABLED) return null;
  const users = await rdbSelect("users", "*", (request) => request.eq("openid", openid).limit(1));
  const user = users[0];
  if (!user) return null;
  const profiles = await rdbSelect("user_profiles", "*", (request) => request.eq("user_id", user.id).limit(1));
  const profile = profiles[0];
  if (!profile) return null;
  return publicSqlProfile(user, profile, await getUserCommunities(user.id));
}

async function getCurrentProfileForDisplay() {
  const contextUserIds = getContextUserIds();
  for (const userId of contextUserIds) {
    try {
      const sqlProfile = await getSqlProfileByOpenid(userId);
      if (sqlProfile) return sqlProfile;
    } catch (err) {
      console.error("get current sql profile failed", err);
    }
    const docProfile = await getProfile(userId);
    if (docProfile) return publicProfile(docProfile);
  }
  return null;
}

async function getProfile(userId) {
  if (!userId) return null;
  const resp = await db
    .collection(COLLECTIONS.profiles)
    .where({
      userId,
    })
    .limit(1)
    .get();
  const profile = resp.data[0] || null;
  if (!profile) return null;
  return {
    ...profile,
    id: profile.userId || userId,
  };
}

async function getCurrentUserProfile() {
  const userIds = getContextUserIds();
  for (const userId of userIds) {
    const profile = await getProfile(userId);
    if (profile) return profile;
  }
  return null;
}

async function upsertCurrentUserProfile(event) {
  const currentUserId = getContextUserId();
  if (!currentUserId) return { success: false, code: "LOGIN_REQUIRED", message: "请先登录" };

  const profile = event.profile || {};
  const data = {
    userId: currentUserId,
    name: String(profile.name || "").trim(),
    job: String(profile.job || "").trim(),
    wechat: String(profile.wechat || "").trim(),
    avatar: profile.avatar || "",
    intro: String(profile.intro || "").trim(),
    answers: Array.isArray(profile.answers) ? profile.answers : [],
    tags: Array.isArray(profile.tags) ? profile.tags : [],
    stickerCode: profile.stickerCode || "",
    agreementVersion: profile.agreementVersion === AGREEMENT_VERSION ? AGREEMENT_VERSION : "",
    updatedAt: now(),
  };

  if (!data.name || !data.job || !data.wechat || !data.intro) {
    return { success: false, code: "PROFILE_INCOMPLETE", message: "名片信息不完整" };
  }

  let syncResult = null;
  try {
    syncResult = await syncProfileToSql(data, "");
  } catch (err) {
    console.error("sync profile to sql failed", err);
    return { success: false, code: "SQL_SYNC_FAILED", message: "名片保存失败，请稍后重试" };
  }

  return {
    success: true,
    userId: currentUserId,
    profile: {
      ...data,
      id: currentUserId,
    },
    sqlUserId: syncResult && syncResult.user && syncResult.user.id,
    sqlProfileId: syncResult && syncResult.profile && syncResult.profile.id,
  };
}

async function acceptCurrentAgreement() {
  const openid = getContextUserId();
  const user = openid ? await ensureSqlUser(openid) : null;
  const profile = user
    ? (await rdbSelect("user_profiles", "*", (request) => request.eq("user_id", user.id).limit(1)))[0]
    : null;
  if (!profile) return { success: false, code: "PROFILE_REQUIRED", message: "请先保存名片" };
  await rdbUpdate("user_profiles", { agreement_version: AGREEMENT_VERSION }, (request) => request.eq("id", profile.id));
  return { success: true, agreementVersion: AGREEMENT_VERSION };
}

async function getTagByToken(event) {
  const token = sanitizeToken(event.token);
  if (!token) {
    return { success: false, code: "TOKEN_REQUIRED", message: "缺少 token" };
  }

  const resp = await db
    .collection(COLLECTIONS.tags)
    .where({
      claimToken: token,
    })
    .limit(1)
    .get();
  const tag = resp.data[0];
  if (!tag) {
    return { success: false, code: "TAG_NOT_FOUND", message: "这个贴纸不存在或链接无效" };
  }

  await db
    .collection(COLLECTIONS.tags)
    .doc(tag._id)
    .update({
      data: {
        lastVisitedAt: now(),
      },
    });

  let ownerProfile = tag.ownerUserId ? await getSqlProfileByOpenid(tag.ownerUserId) : null;
  if (!ownerProfile && tag.ownerUserId) {
    const docOwnerProfile = await getProfile(tag.ownerUserId);
    ownerProfile = publicProfile(docOwnerProfile);
  }
  const currentProfile = await getCurrentProfileForDisplay();
  const contextUserIds = getContextUserIds();
  if (!ownerProfile && tag.ownerUserId && contextUserIds.includes(tag.ownerUserId)) {
    ownerProfile = currentProfile;
    if (ownerProfile && ownerProfile.userId !== tag.ownerUserId) {
      await db.collection(COLLECTIONS.tags).doc(tag._id).update({
        data: {
          ownerUserId: ownerProfile.userId,
        },
      });
      tag.ownerUserId = ownerProfile.userId;
    }
  }
  return {
    success: true,
    tag: publicTag(tag, ownerProfile),
    ownerProfile,
    currentUserId: contextUserIds.includes(tag.ownerUserId) ? tag.ownerUserId : getContextUserId(),
    currentUserHasProfile: !!currentProfile,
  };
}

async function getProfileByUserId(event) {
  const userId = String(event.userId || "").trim();
  if (!userId) return { success: false, code: "USER_REQUIRED", message: "缺少名片用户" };
  const sqlProfile = await getSqlProfileByOpenid(userId);
  if (sqlProfile && sqlProfile.agreementVersion === AGREEMENT_VERSION) {
    return { success: true, profile: sqlProfile };
  }
  const profile = await getProfile(userId);
  if (!profile || profile.agreementVersion !== AGREEMENT_VERSION) {
    return { success: false, code: "PROFILE_NOT_FOUND", message: "这张名片暂时不可见" };
  }
  return { success: true, profile: publicProfile(profile) };
}

async function getCurrentProfile() {
  const profile = await getCurrentProfileForDisplay();
  if (!profile) return { success: false, code: "PROFILE_NOT_FOUND", message: "还没有保存名片" };
  return { success: true, profile };
}

async function bindTagToCurrentUser(event) {
  const token = sanitizeToken(event.token);
  const contextUserIds = getContextUserIds();
  const ownerProfile = await getCurrentProfileForDisplay();
  const currentUserId = ownerProfile ? ownerProfile.userId : getContextUserId();
  if (!token) return { success: false, code: "TOKEN_REQUIRED", message: "缺少 token" };
  if (!currentUserId) return { success: false, code: "LOGIN_REQUIRED", message: "请先登录" };

  return db.runTransaction(async (transaction) => {
    const tagResp = await transaction
      .collection(COLLECTIONS.tags)
      .where({
        claimToken: token,
      })
      .limit(1)
      .get();
    const tag = tagResp.data[0];

    if (!tag) {
      return { success: false, code: "TAG_NOT_FOUND", message: "这个贴纸不存在或链接无效" };
    }
    if (tag.status === "frozen") {
      return { success: false, code: "TAG_FROZEN", message: "这个贴纸已失效" };
    }

    const belongsToCurrentUser =
      tag.ownerUserId === currentUserId || contextUserIds.includes(tag.ownerUserId);
    if (tag.status === "bound" && tag.ownerUserId && !belongsToCurrentUser) {
      return { success: false, code: "TAG_ALREADY_BOUND", message: "这张贴纸已被绑定", tag: publicTag(tag) };
    }

    if (tag.status === "bound" && belongsToCurrentUser) {
      if (tag.ownerUserId !== currentUserId) {
        await transaction.collection(COLLECTIONS.tags).doc(tag._id).update({
          data: {
            ownerUserId: currentUserId,
          },
        });
        tag.ownerUserId = currentUserId;
      }
      return { success: true, tag: publicTag(tag, ownerProfile), ownerProfile };
    }

    await transaction.collection(COLLECTIONS.tags).doc(tag._id).update({
      data: {
        ownerUserId: currentUserId,
        status: "bound",
        boundAt: now(),
        lastVisitedAt: now(),
      },
    });

    return {
      success: true,
      tag: publicTag({ ...tag, ownerUserId: currentUserId, status: "bound" }, ownerProfile),
      ownerProfile,
    };
  });
}

async function recordTagVisit(event) {
  const token = sanitizeToken(event.token);
  const currentProfile = await getCurrentProfileForDisplay();
  const visitorUserId = currentProfile ? currentProfile.userId : getContextUserId();
  const source = event.source || "unknown";
  const directOwnerUserId = String(event.ownerUserId || "").trim();

  if (!token && directOwnerUserId && source === "share_card") {
    try {
      await upsertSqlConnection(directOwnerUserId, visitorUserId, "share_card");
    } catch (err) {
      console.error("sync shared card connection to sql failed", err);
    }
    return { success: true, source: "share_card", sqlOnly: true };
  }

  let query = {};
  if (token) {
    query = { claimToken: token };
  } else if (directOwnerUserId) {
    query = { ownerUserId: directOwnerUserId };
  } else {
    return { success: false, code: "TOKEN_OR_OWNER_REQUIRED", message: "缺少 token 或 ownerUserId" };
  }

  const tagResp = await db.collection(COLLECTIONS.tags).where(query).limit(1).get();
  const tag = tagResp.data[0];
  if (!tag) return { success: false, code: "TAG_NOT_FOUND", message: "这个贴纸不存在或链接无效" };
  if (tag.status !== "bound" || !tag.ownerUserId) return { success: true, skipped: true };
  if (visitorUserId && visitorUserId === tag.ownerUserId) return { success: true, skipped: true };

  const visitResult = await db.collection(COLLECTIONS.visits).add({
    data: {
      tagId: tag._id,
      tagCode: tag.tagCode,
      ownerUserId: tag.ownerUserId,
      visitorUserId,
      source,
      createdAt: now(),
    },
  });

  await db.collection(COLLECTIONS.tags).doc(tag._id).update({
    data: {
      lastVisitedAt: now(),
      visitCount: _.inc(1),
    },
  });

  try {
    await upsertSqlConnection(tag.ownerUserId, visitorUserId, source);
  } catch (err) {
    console.error("sync connection to sql failed", err);
  }

  return { success: true, visitId: visitResult._id || "" };
}

async function getVisitsByUser(field, userId) {
  const visits = [];
  const pageSize = 100;
  const maxVisits = 1000;
  while (visits.length < maxVisits) {
    const resp = await db
      .collection(COLLECTIONS.visits)
      .where({ [field]: userId })
      .skip(visits.length)
      .limit(pageSize)
      .get();
    const page = resp.data || [];
    visits.push(...page);
    if (page.length < pageSize) break;
  }
  return visits;
}

async function getSubscriptionsByOwners(ownerUserIds) {
  const subscriptions = [];
  const pageSize = 100;
  const maxSubscriptions = 1000;
  try {
    for (const ownerUserId of ownerUserIds) {
      let offset = 0;
      while (offset < maxSubscriptions) {
        const resp = await db
          .collection(COLLECTIONS.subscriptions)
          .where({ ownerUserId })
          .skip(offset)
          .limit(pageSize)
          .get();
        const page = resp.data || [];
        subscriptions.push(...page);
        offset += page.length;
        if (page.length < pageSize) break;
      }
    }
  } catch (err) {
    console.warn("load reminder subscriptions failed", err);
    return [];
  }
  return subscriptions;
}

async function registerProfileReminderSubscription(event) {
  const token = sanitizeToken(event.token);
  const recipientUserId = getContextUserId();
  if (!token) return { success: false, code: "TOKEN_REQUIRED", message: "缺少 token" };
  if (!recipientUserId) return { success: false, code: "LOGIN_REQUIRED", message: "无法识别当前用户" };
  if (await getCurrentProfileForDisplay()) {
    return { success: false, code: "PROFILE_EXISTS", message: "你已经有呆猫名片了" };
  }

  const tagResp = await db.collection(COLLECTIONS.tags).where({ claimToken: token }).limit(1).get();
  const tag = tagResp.data[0];
  if (!tag || tag.status !== "bound" || !tag.ownerUserId) {
    return { success: false, code: "TAG_NOT_BOUND", message: "贴纸尚未绑定" };
  }
  if (tag.ownerUserId === recipientUserId) {
    return { success: false, code: "SELF_REMINDER", message: "不能订阅自己的提醒" };
  }

  const existingResp = await db
    .collection(COLLECTIONS.subscriptions)
    .where({
      ownerUserId: tag.ownerUserId,
      recipientUserId,
      templateId: PROFILE_REMINDER_TEMPLATE_ID,
    })
    .limit(1)
    .get();
  const existing = existingResp.data[0];

  if (existing && existing.status === "sent") {
    return { success: true, status: "sent", alreadySent: true };
  }

  const data = {
    ownerUserId: tag.ownerUserId,
    recipientUserId,
    tagId: tag._id,
    tagCode: tag.tagCode,
    templateId: PROFILE_REMINDER_TEMPLATE_ID,
    status: "available",
    authorizedAt: now(),
    updatedAt: now(),
  };

  if (existing) {
    await db.collection(COLLECTIONS.subscriptions).doc(existing._id).update({ data });
  } else {
    await db.collection(COLLECTIONS.subscriptions).add({
      data: {
        ...data,
        createdAt: now(),
      },
    });
  }

  return { success: true, status: "available" };
}

async function getMyConnections() {
  const currentProfile = await getCurrentProfileForDisplay();
  if (!currentProfile) return { success: false, code: "PROFILE_REQUIRED", message: "请先保存名片" };
  if (currentProfile.agreementVersion !== AGREEMENT_VERSION) {
    return { success: false, code: "AGREEMENT_REQUIRED", message: "请先同意更新后的隐私政策" };
  }
  const contextUserIds = Array.from(new Set([...getContextUserIds(), currentProfile.userId].filter(Boolean)));
  if (!SQL_SYNC_ENABLED || !contextUserIds.length) return { success: true, connections: [] };

  const currentUsers = await rdbSelect("users", "*", (request) => request.in("openid", contextUserIds).limit(20));
  const currentSqlIds = currentUsers.map((user) => user.id).filter(Boolean);
  if (!currentSqlIds.length) return { success: true, connections: [] };

  const connectionRows = await rdbSelect("user_connections", "*", (request) =>
    request.in("user_id", currentSqlIds).eq("status", "active").limit(200)
  );
  const friendIds = Array.from(new Set(connectionRows.map((row) => row.friend_user_id).filter(Boolean)));
  if (!friendIds.length) return { success: true, connections: [] };

  const [friendUsers, friendProfiles] = await Promise.all([
    rdbSelect("users", "*", (request) => request.in("id", friendIds).limit(200)),
    rdbSelect("user_profiles", "*", (request) => request.in("user_id", friendIds).limit(200)),
  ]);
  const usersById = new Map(friendUsers.map((user) => [Number(user.id), user]));
  const profilesByUserId = new Map(friendProfiles.map((profile) => [Number(profile.user_id), profile]));

  const latestConnectionByFriend = new Map();
  connectionRows.forEach((row) => {
    const friendId = Number(row.friend_user_id);
    const existing = latestConnectionByFriend.get(friendId);
    const rowTime = new Date(row.last_met_at || row.updated_at || row.created_at || 0).getTime();
    const existingTime = existing ? new Date(existing.last_met_at || existing.updated_at || existing.created_at || 0).getTime() : 0;
    if (!existing || rowTime >= existingTime) latestConnectionByFriend.set(friendId, row);
  });

  const result = (
    await Promise.all(
      Array.from(latestConnectionByFriend.entries()).map(async ([friendId, connection]) => {
        const user = usersById.get(friendId);
        const profile = profilesByUserId.get(friendId);
        const publicProfileData = publicSqlProfile(user, profile, await getUserCommunities(user && user.id));
        if (!publicProfileData || publicProfileData.agreementVersion !== AGREEMENT_VERSION) return null;
        return {
          ...publicProfileData,
          anonymous: false,
          metAt: connection.last_met_at || connection.updated_at || connection.created_at || "",
          source: connection.source || "other",
          visitCount: Number(connection.visit_count || 1),
        };
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => new Date(b.metAt).getTime() - new Date(a.metAt).getTime());

  return { success: true, connections: result };
}

async function sendProfileReminder(event) {
  const connectionId = String(event.connectionId || "").trim();
  const wxContext = cloud.getWXContext();
  const callerAppId = wxContext.FROM_APPID || wxContext.APPID || "";
  const currentProfile = await getCurrentProfileForDisplay();
  const currentUserIds = Array.from(new Set([...getContextUserIds(), currentProfile && currentProfile.userId].filter(Boolean)));
  if (!connectionId) return { success: false, code: "CONNECTION_REQUIRED", message: "缺少猫友记录" };
  if (!callerAppId) return { success: false, code: "APPID_REQUIRED", message: "无法识别调用方小程序" };
  if (callerAppId !== DAIMAO_APP_ID) {
    return { success: false, code: "APPID_MISMATCH", message: "订阅模板与当前小程序不匹配" };
  }
  if (!currentProfile) return { success: false, code: "PROFILE_REQUIRED", message: "请先保存名片" };
  if (currentProfile.agreementVersion !== AGREEMENT_VERSION) {
    return { success: false, code: "AGREEMENT_REQUIRED", message: "请先同意更新后的隐私政策" };
  }

  const visitResp = await db.collection(COLLECTIONS.visits).doc(connectionId).get();
  const visit = visitResp.data;
  if (!visit || !currentUserIds.includes(visit.ownerUserId) || !visit.visitorUserId) {
    return { success: false, code: "CONNECTION_NOT_FOUND", message: "没有找到可提醒的猫友" };
  }
  if (await getProfile(visit.visitorUserId)) {
    return { success: false, code: "PROFILE_ALREADY_EXISTS", message: "对方已经填写名片了" };
  }

  const subscriptionResp = await db
    .collection(COLLECTIONS.subscriptions)
    .where({
      ownerUserId: visit.ownerUserId,
      recipientUserId: visit.visitorUserId,
      templateId: PROFILE_REMINDER_TEMPLATE_ID,
    })
    .limit(1)
    .get();
  const subscription = subscriptionResp.data[0];
  if (!subscription) {
    return { success: false, code: "NOT_SUBSCRIBED", message: "对方还没有授权接收提醒" };
  }
  if (subscription.status === "sent") {
    return { success: false, code: "ALREADY_REMINDED", message: "已经提醒过对方了" };
  }
  if (subscription.status !== "available") {
    return { success: false, code: "SUBSCRIPTION_UNAVAILABLE", message: "对方当前无法接收提醒" };
  }

  const claimResult = await db
    .collection(COLLECTIONS.subscriptions)
    .where({ _id: subscription._id, status: "available" })
    .update({
      data: {
        status: "sending",
        updatedAt: now(),
      },
    });
  if (!claimResult.stats || claimResult.stats.updated !== 1) {
    return { success: false, code: "REMINDER_IN_PROGRESS", message: "提醒正在发送，请稍后查看" };
  }

  try {
    const sendResult = await cloud.openapi.subscribeMessage.send({
      touser: visit.visitorUserId,
      page: "pages/index/index",
      lang: "zh_CN",
      data: {
        thing5: { value: "完善你的呆猫名片" },
        thing3: { value: "有猫友提醒你填写名片" },
      },
      templateId: PROFILE_REMINDER_TEMPLATE_ID,
      miniprogramState: "formal",
    });
    if (sendResult.errCode && sendResult.errCode !== 0) {
      const sendError = new Error(sendResult.errMsg || "subscribe message send failed");
      sendError.errCode = sendResult.errCode;
      throw sendError;
    }

    await db.collection(COLLECTIONS.subscriptions).doc(subscription._id).update({
      data: {
        status: "sent",
        sentAt: now(),
        sentByUserId: currentProfile.userId,
        messageId: sendResult.msgId || sendResult.msgid || "",
        updatedAt: now(),
      },
    });
    return { success: true, status: "sent" };
  } catch (err) {
    const errorCode = Number(err.errCode || err.errcode || 0);
    await db.collection(COLLECTIONS.subscriptions).doc(subscription._id).update({
      data: {
        status: errorCode === 43101 ? "unavailable" : "available",
        lastErrorCode: errorCode,
        lastErrorMessage: String(err.errMsg || err.errmsg || err.message || "").slice(0, 200),
        updatedAt: now(),
      },
    });
    return {
      success: false,
      code: errorCode === 43101 ? "NOT_SUBSCRIBED" : "SEND_FAILED",
      message: errorCode === 43101 ? "对方的订阅授权已经失效" : "提醒发送失败，请稍后再试",
    };
  }
}

async function getAssetTempUrls(event) {
  const fileIDs = Array.isArray(event.fileIDs) ? event.fileIDs.filter(Boolean) : [];
  if (!fileIDs.length) {
    return { success: false, code: "FILE_IDS_REQUIRED", message: "缺少 fileIDs" };
  }

  const resp = await cloud.getTempFileURL({
    fileList: fileIDs,
  });

  const files = (resp.fileList || []).map((file) => ({
    fileID: file.fileID,
    tempFileURL: file.tempFileURL || "",
    status: file.status,
    errMsg: file.errMsg || "",
  }));
  const failed = files.filter((file) => !file.tempFileURL);

  return {
    success: failed.length === 0,
    code: failed.length ? "ASSET_TEMP_URL_FAILED" : "OK",
    files,
    failed,
  };
}

async function debugCurrentProfile() {
  const contextUserIds = getContextUserIds();
  const profiles = [];
  for (const userId of contextUserIds) {
    const profile = await getProfile(userId);
    profiles.push({ userId, found: !!profile, profile: profile ? publicProfile(profile) : null });
  }
  let sqlUsers = [];
  if (SQL_SYNC_ENABLED && contextUserIds.length) {
    try {
      sqlUsers = await rdbSelect("users", "id,openid,display_name,avatar_url,status,experience_points", (request) =>
        request.in("openid", contextUserIds)
      );
    } catch (err) {
      sqlUsers = [{ error: err.message }];
    }
  }
  return { success: true, contextUserIds, profiles, sqlUsers };
}

async function migrateProfilesToSql(event) {
  if (event.confirm !== "migrate-profiles-to-sql") {
    return { success: false, code: "CONFIRM_REQUIRED", message: "请传入 confirm=migrate-profiles-to-sql" };
  }
  const limit = Math.min(Math.max(Number(event.limit || 20), 1), 50);
  const profileResp = await db.collection(COLLECTIONS.profiles).limit(limit).get();
  const profiles = profileResp.data || [];
  let syncedProfiles = 0;
  let failedProfiles = 0;
  for (const profile of profiles) {
    try {
      await syncProfileToSql(profile, profile._id);
      syncedProfiles += 1;
    } catch (err) {
      failedProfiles += 1;
      console.error("migrate profile failed", profile._id, err);
    }
  }

  const visitResp = await db.collection(COLLECTIONS.visits).limit(limit).get();
  const visits = visitResp.data || [];
  let syncedConnections = 0;
  let failedConnections = 0;
  for (const visit of visits) {
    try {
      if (visit.ownerUserId && visit.visitorUserId && visit.ownerUserId !== visit.visitorUserId) {
        await upsertSqlConnection(visit.ownerUserId, visit.visitorUserId, visit.source || "migration");
        syncedConnections += 1;
      }
    } catch (err) {
      failedConnections += 1;
      console.error("migrate connection failed", visit._id, err);
    }
  }

  return {
    success: true,
    profiles: { checked: profiles.length, synced: syncedProfiles, failed: failedProfiles },
    visits: { checked: visits.length, synced: syncedConnections, failed: failedConnections },
  };
}

exports.main = async (event) => {
  switch (event.action) {
    case "getTagByToken":
      return getTagByToken(event);
    case "getProfileByUserId":
      return getProfileByUserId(event);
    case "bindTagToCurrentUser":
      return bindTagToCurrentUser(event);
    case "recordTagVisit":
      return recordTagVisit(event);
    case "registerProfileReminderSubscription":
      return registerProfileReminderSubscription(event);
    case "getCurrentProfile":
      return getCurrentProfile();
    case "getMyConnections":
      return getMyConnections();
    case "sendProfileReminder":
      return sendProfileReminder(event);
    case "acceptCurrentAgreement":
      return acceptCurrentAgreement();
    case "upsertCurrentUserProfile":
      return upsertCurrentUserProfile(event);
    case "getAssetTempUrls":
      return getAssetTempUrls(event);
    case "debugCurrentProfile":
      return debugCurrentProfile();
    case "migrateProfilesToSql":
      return migrateProfilesToSql(event);
    default:
      return { success: false, code: "UNKNOWN_ACTION", message: "未知操作" };
  }
};
