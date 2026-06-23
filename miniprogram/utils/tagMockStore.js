const assets = require("./assets");

const STORAGE_KEYS = {
  tags: "daimao_mock_tags",
  profile: "daimao_profile",
  history: "daimao_met_history",
  visits: "daimao_mock_tag_visits",
  subscriptions: "daimao_mock_profile_reminder_subscriptions",
};

const DEMO_OWNER_PROFILE = {
  id: "demo-owner",
  name: "小葵",
  job: "咖啡店主理人",
  wechat: "daimao_kui",
  avatar: assets.getAsset("catRub"),
  intro: "白天做咖啡，晚上研究城市散步路线。喜欢把经历按“下次可以做什么”来记住。",
  answers: [
    { q: "休息日通常在干什么？", a: "逛菜市场、看展，顺手记录路边好看的招牌。" },
    { q: "最近最想聊的话题？", a: "怎样把一家小店做得温柔但不无聊。" },
    { q: "一个隐藏技能？", a: "能靠气味猜出咖啡豆大概的烘焙程度。" },
  ],
  tags: ["咖啡", "城市散步", "小店", "拍照"],
  stickerCode: "TAG_202605_000002",
};
const AGREEMENT_VERSION = "2026-06-13-v2";

function nowISO() {
  return new Date().toISOString();
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function createInitialTags() {
  return [
    {
      id: "tag_mock_unbound",
      tagCode: "TAG_202605_000001",
      claimToken: "8F3K2P9XQ7",
      ownerUserId: "",
      ownerProfile: null,
      status: "unbound",
      batchNo: "BATCH_202605",
      createdAt: nowISO(),
      boundAt: "",
      lastVisitedAt: "",
    },
    {
      id: "tag_mock_bound",
      tagCode: "TAG_202605_000002",
      claimToken: "BOUND2OWNER",
      ownerUserId: DEMO_OWNER_PROFILE.id,
      ownerProfile: DEMO_OWNER_PROFILE,
      status: "bound",
      batchNo: "BATCH_202605",
      createdAt: nowISO(),
      boundAt: nowISO(),
      lastVisitedAt: "",
    },
    {
      id: "tag_mock_frozen",
      tagCode: "TAG_202605_000003",
      claimToken: "FROZEN0001",
      ownerUserId: "",
      ownerProfile: null,
      status: "frozen",
      batchNo: "BATCH_202605",
      createdAt: nowISO(),
      boundAt: "",
      lastVisitedAt: "",
    },
    {
      id: "tag_mock_race",
      tagCode: "TAG_202605_000004",
      claimToken: "RACECLAIM1",
      ownerUserId: "",
      ownerProfile: null,
      status: "unbound",
      batchNo: "BATCH_202605",
      createdAt: nowISO(),
      boundAt: "",
      lastVisitedAt: "",
    },
  ];
}

function getTags() {
  const tags = wx.getStorageSync(STORAGE_KEYS.tags);
  if (Array.isArray(tags) && tags.length) return tags;
  const initialTags = createInitialTags();
  wx.setStorageSync(STORAGE_KEYS.tags, initialTags);
  return initialTags;
}

function saveTags(tags) {
  wx.setStorageSync(STORAGE_KEYS.tags, tags);
}

function sanitizeTag(tag) {
  if (!tag) return null;
  return {
    id: tag.id,
    tagCode: tag.tagCode,
    claimToken: tag.claimToken,
    ownerUserId: tag.ownerUserId || "",
    status: tag.status,
    batchNo: tag.batchNo || "",
    createdAt: tag.createdAt,
    boundAt: tag.boundAt || "",
    lastVisitedAt: tag.lastVisitedAt || "",
    ownerProfile: tag.status === "bound" ? tag.ownerProfile : null,
  };
}

function getCurrentProfile() {
  return wx.getStorageSync(STORAGE_KEYS.profile) || null;
}

function getCurrentUserId() {
  const profile = getCurrentProfile();
  return profile && profile.id ? profile.id : "";
}

function upsertCurrentUserProfile(profile) {
  const currentProfile = {
    ...profile,
    id: profile.id || `local-${Date.now()}`,
    boundTagCodes: profile.boundTagCodes || [],
  };
  wx.setStorageSync(STORAGE_KEYS.profile, currentProfile);
  return {
    success: true,
    userId: currentProfile.id,
    profile: currentProfile,
  };
}

function acceptCurrentAgreement() {
  const profile = getCurrentProfile();
  if (!profile || !profile.id) return { success: false, code: "PROFILE_REQUIRED" };
  wx.setStorageSync(STORAGE_KEYS.profile, { ...profile, agreementVersion: AGREEMENT_VERSION });
  return { success: true, agreementVersion: AGREEMENT_VERSION };
}

function getTagByToken(token) {
  const tag = getTags().find((item) => item.claimToken === token);
  if (!tag) {
    return { success: false, code: "TAG_NOT_FOUND", message: "这个贴纸不存在或链接无效" };
  }
  return {
    success: true,
    tag: sanitizeTag(tag),
    currentUserId: getCurrentUserId(),
  };
}

function getProfileByUserId(userId) {
  const profile = getCurrentProfile();
  if (profile && (profile.id === userId || profile.userId === userId)) {
    return { success: true, profile };
  }
  if (DEMO_OWNER_PROFILE.id === userId || DEMO_OWNER_PROFILE.userId === userId) {
    return { success: true, profile: DEMO_OWNER_PROFILE };
  }
  return { success: false, code: "PROFILE_NOT_FOUND", message: "这张名片暂时不可见" };
}

function bindTagToCurrentUser(token) {
  const currentProfile = getCurrentProfile();
  if (!currentProfile || !currentProfile.id) {
    return { success: false, code: "LOGIN_REQUIRED", message: "请先完善你的名片信息" };
  }

  const tags = getTags();
  const index = tags.findIndex((item) => item.claimToken === token);
  const tag = tags[index];

  if (!tag) return { success: false, code: "TAG_NOT_FOUND", message: "这个贴纸不存在或链接无效" };
  if (tag.status === "frozen") return { success: false, code: "TAG_FROZEN", message: "这个贴纸已失效" };
  if (tag.status === "bound" && tag.ownerUserId !== currentProfile.id) {
    return { success: false, code: "TAG_ALREADY_BOUND", message: "这张贴纸已被绑定", tag: sanitizeTag(tag) };
  }
  if (tag.status === "bound" && tag.ownerUserId === currentProfile.id) {
    return { success: true, tag: sanitizeTag(tag), ownerProfile: tag.ownerProfile };
  }

  const nextTag = {
    ...tag,
    ownerUserId: currentProfile.id,
    ownerProfile: clone({ ...currentProfile, stickerCode: tag.tagCode }),
    status: "bound",
    boundAt: nowISO(),
    lastVisitedAt: nowISO(),
  };
  tags[index] = nextTag;
  saveTags(tags);
  const boundTagCodes = Array.from(new Set([...(currentProfile.boundTagCodes || []), tag.tagCode]));
  const updatedProfile = { ...currentProfile, stickerCode: tag.tagCode, boundTagCodes };
  wx.setStorageSync(STORAGE_KEYS.profile, updatedProfile);
  return { success: true, tag: sanitizeTag(nextTag), ownerProfile: updatedProfile };
}

function recordTagVisit({ token, ownerUserId, visitorUserId, source = "unknown" }) {
  const tags = getTags();
  const index = tags.findIndex((item) => item.claimToken === token || item.ownerUserId === ownerUserId);
  if (index < 0) return { success: false, code: "TAG_NOT_FOUND" };

  const tag = tags[index];
  if (tag.status !== "bound" || !tag.ownerUserId) return { success: true, skipped: true };
  if (visitorUserId && visitorUserId === tag.ownerUserId) return { success: true, skipped: true };

  tag.lastVisitedAt = nowISO();
  tags[index] = tag;
  saveTags(tags);

  const visits = wx.getStorageSync(STORAGE_KEYS.visits) || [];
  const visit = {
    id: `visit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tagId: tag.id,
    token: tag.claimToken,
    ownerUserId: tag.ownerUserId,
    visitorUserId: visitorUserId || "",
    source,
    createdAt: nowISO(),
  };
  wx.setStorageSync(STORAGE_KEYS.visits, [visit, ...visits].slice(0, 100));

  if (visitorUserId && tag.ownerProfile) {
    const history = wx.getStorageSync(STORAGE_KEYS.history) || [];
    const metAt = formatTime(new Date());
    const nextHistory = [
      { ...tag.ownerProfile, metAt },
      ...history.filter((item) => item.id !== tag.ownerProfile.id),
    ].slice(0, 50);
    wx.setStorageSync(STORAGE_KEYS.history, nextHistory);
  }

  return { success: true, visit };
}

function registerProfileReminderSubscription({ token }) {
  const tag = getTags().find((item) => item.claimToken === token);
  if (!tag || !tag.ownerUserId) return { success: false, code: "TAG_NOT_BOUND" };
  const recipientUserId = getCurrentUserId() || "mock-anonymous";
  const subscriptions = wx.getStorageSync(STORAGE_KEYS.subscriptions) || [];
  const existingIndex = subscriptions.findIndex(
    (item) => item.ownerUserId === tag.ownerUserId && item.recipientUserId === recipientUserId
  );
  const subscription = {
    id: existingIndex >= 0 ? subscriptions[existingIndex].id : `subscription_${Date.now()}`,
    ownerUserId: tag.ownerUserId,
    recipientUserId,
    status: existingIndex >= 0 && subscriptions[existingIndex].status === "sent" ? "sent" : "available",
  };
  if (existingIndex >= 0) subscriptions[existingIndex] = subscription;
  else subscriptions.push(subscription);
  wx.setStorageSync(STORAGE_KEYS.subscriptions, subscriptions);
  return { success: true, status: subscription.status };
}

function getMyConnections() {
  const currentProfile = getCurrentProfile();
  if (!currentProfile || currentProfile.agreementVersion !== AGREEMENT_VERSION) {
    return { success: false, code: "AGREEMENT_REQUIRED" };
  }
  const history = wx.getStorageSync(STORAGE_KEYS.history) || [];
  return { success: true, connections: history };
}

function sendProfileReminder(connectionId) {
  const history = wx.getStorageSync(STORAGE_KEYS.history) || [];
  const connection = history.find((item) => item.connectionId === connectionId);
  if (!connection) return { success: false, code: "CONNECTION_NOT_FOUND" };
  if (connection.reminderStatus === "sent") return { success: false, code: "ALREADY_REMINDED" };
  if (connection.reminderStatus !== "available") return { success: false, code: "NOT_SUBSCRIBED" };
  const nextHistory = history.map((item) =>
    item.connectionId === connectionId ? { ...item, reminderStatus: "sent" } : item
  );
  wx.setStorageSync(STORAGE_KEYS.history, nextHistory);
  return { success: true, status: "sent" };
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  STORAGE_KEYS,
  createInitialTags,
  getTagByToken,
  getProfileByUserId,
  bindTagToCurrentUser,
  recordTagVisit,
  registerProfileReminderSubscription,
  upsertCurrentUserProfile,
  getMyConnections,
  acceptCurrentAgreement,
  sendProfileReminder,
};
