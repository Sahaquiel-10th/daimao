const mockEnabled = import.meta.env.VITE_ADMIN_USE_MOCK === "true";
const proxyUrl = import.meta.env.VITE_ADMIN_API_URL || "/api/admin";
const mockRole = import.meta.env.VITE_ADMIN_MOCK_ROLE || "super_admin";

function getToken() {
  return localStorage.getItem("daimao_admin_session_token") || "";
}

export function saveToken(token) {
  localStorage.setItem("daimao_admin_session_token", token || "");
}

export function saveAccessKey(accessKey) {
  // 清理旧版本曾写入浏览器的 CloudBase Publishable Key。
  localStorage.removeItem("daimao_cloudbase_access_key");
}

export function hasToken() {
  return !!getToken();
}

export async function loginAdmin(username, password) {
  if (mockEnabled) {
    if (!String(username || "").trim() || !String(password || "")) throw new Error("请输入账号和密码");
    const sessionToken = `mock-${mockRole}`;
    saveToken(sessionToken);
    return { success: true, sessionToken, role: mockRole, communityIds: mockRole === "community_admin" ? [1] : [] };
  }
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
  // 管理操作一律经过同源后台代理。浏览器会话只用于代理鉴权，
  // ADMIN_WEB_TOKEN 和供应商 Key 都不能进入浏览器或直达云函数。
  return callAdminProxy(action, { adminSessionToken, ...data });
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
      const code = payload && payload.code;
      const message = (payload && payload.message) || `后台代理服务返回 HTTP ${response.status}`;
      const error = new Error(code ? `${code}: ${message}` : message);
      error.code = code;
      error.serverMessage = message;
      throw error;
    }
    return payload;
  } catch (err) {
    if (err.code) throw err;
    throw new Error(`后台代理服务连接失败：${err.message || err}`);
  }
}

const now = new Date().toISOString();
const mockState = {
  platformBillingSettings: {
    powerPerCny: 1000,
    referenceInputCnyPerMillion: 35,
    referenceOutputCnyPerMillion: 210,
    customerInputCnyPerMillion: 28,
    customerOutputCnyPerMillion: 168,
    inputFactor: 0.8,
    outputFactor: 0.8,
    displayFactor: 0.8,
    customerBillingFactor: 0.8,
    pricingLabel: "优惠价",
    pricingVersion: 12,
    pricingEffectiveAt: "2026-07-12 20:00:00",
  },
  users: [
    { id: 1, public_user_code: "001", openid: "demo_admin_opc", display_name: "OPC 数据中心主理人", status: "active", is_admin: 1, experience_points: 180, created_at: now, communities: [{ community_id: 1, status: "active", tags: ["主理人"], communityName: "OPC 共创营", badgeName: "OPC" }] },
    { id: 2, public_user_code: "002", openid: "demo_operator_ai", display_name: "阿里 AI 产品顾问", status: "active", is_admin: 0, experience_points: 76, created_at: now, communities: [{ community_id: 1, status: "active", tags: ["AI"], communityName: "OPC 共创营", badgeName: "OPC" }], referral: { referrer_user_id: 1, referrer_public_user_code: "001", referrer_display_name: "OPC 数据中心主理人", note: "测试引荐" } },
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
    { id: 101, project_id: 10, user_id: 2, message: "我想参与线索整理，并负责把现有销售线索清洗成可跟进的结构化名单。", can_offer: "AI 工作流搭建、销售数据清洗", related_experience: "曾为团队搭建过线索自动分类流程", status: "pending_admin_review", ai_review_status: "revise", ai_match_score: 82, ai_review_summary: "能力与项目目标较匹配，但需要人工确认可投入时间和历史交付情况。", ai_review_detail_json: { strengths: ["有相关自动化经验", "能力标签匹配"], risks: ["缺少可验证的交付链接"] }, admin_review_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), created_at: now, updated_at: now },
  ],
  evidence: [
    { id: 501, user_id: 2, evidence_type: "admin_interview", title: "管理员访谈记录", content: "申请人曾独立完成销售线索清洗与自动分类工作流。", confidence: 0.86, status: "candidate", created_at: now },
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
  aiProviderAccounts: [
    { id: 801, accountScope: "platform", communityId: null, name: "数据中心中转站", providerType: "relay", protocol: "openai_chat", baseUrl: "https://s-api.aiarrival.cn/v1", apiKeyLastFour: "1234", rechargeUrl: "https://example.com/recharge", status: "active", updatedAt: now },
    { id: 802, accountScope: "community", communityId: 1, name: "OPC 社区 AI", providerType: "relay", protocol: "openai_chat", baseUrl: "https://s-api.aiarrival.cn/v1", apiKeyLastFour: "5678", rechargeUrl: "https://example.com/recharge", status: "active", updatedAt: now },
  ],
  platformAiSettings: { billingEnabled: true, billingSource: "relay", aiProviderAccountId: 801, defaultModel: "gpt-5-mini", taskModels: { assistant_chat_turn: "gpt-5-mini" }, note: "Mock 平台线路" },
  billingClients: [
    { id: 3001, appid: "wx-opc-demo", name: "OPC 社区小程序", communityId: 1, communityName: "OPC 共创营", balanceSource: "ai_provider", billingSettings: { billingEnabled: true, billingSource: "relay", aiProviderAccountId: 802, defaultModel: "gpt-5-mini", taskModels: {} }, wallet: { status: "active", balanceUnits: 120000 } },
    { id: 3002, appid: "legacy-demo", name: "旧本地测试应用", communityId: 1, communityName: "OPC 共创营", balanceSource: "local_wallet", billingSettings: { billingEnabled: true, billingSource: "local", defaultModel: "legacy-model" }, wallet: { status: "active", balanceUnits: 88000 } },
  ],
};

async function mockCall(action, data) {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const mockExternalBilling = {
    providerAccount: mockState.aiProviderAccounts.find((item) => item.id === (data.appClientId ? 802 : 801)),
    account: { balance: 68.52, reserved: 1.25, availableBalance: 67.27, currentMonth: 12.44, totalUsage: 89.31 },
    usage: { items: [{ id: 1, createdAt: now, model: "gpt-5-mini", inputTokens: 1350, outputTokens: 420, cost: 0.043 }] },
    readError: null,
  };
  if (action === "adminGetPlatformAiSettings") return { success: true, platformAiSettings: { ...mockState.platformAiSettings }, providerAccount: mockState.aiProviderAccounts.find((item) => item.id === mockState.platformAiSettings.aiProviderAccountId), externalBilling: mockExternalBilling, configurationSource: "platform_database" };
  if (action === "adminUpdatePlatformAiSettings") {
    mockState.platformAiSettings = { ...mockState.platformAiSettings, ...(data.settings || {}) };
    return { success: true, platformAiSettings: { ...mockState.platformAiSettings } };
  }
  if (action === "adminCheckPlatformAiConnection") return { success: true, connected: true };
  if (action === "adminListAiProviderAccounts") {
    return { success: true, accounts: mockState.aiProviderAccounts.filter((item) => item.accountScope === data.accountScope && (!data.communityId || Number(item.communityId) === Number(data.communityId))) };
  }
  if (action === "adminUpsertAiProviderAccount") {
    const account = data.account || {};
    const existingId = Number(account.id || 0);
    if (existingId) {
      mockState.aiProviderAccounts = mockState.aiProviderAccounts.map((item) => item.id === existingId ? { ...item, ...account, apiKeyLastFour: account.apiKey ? account.apiKey.slice(-4) : item.apiKeyLastFour, updatedAt: new Date().toISOString() } : item);
    } else {
      mockState.aiProviderAccounts.push({ ...account, id: Date.now(), apiKeyLastFour: String(account.apiKey || "").slice(-4), updatedAt: new Date().toISOString() });
    }
    return { success: true, saved: true };
  }
  if (action === "adminGetAppClientBilling") {
    const clients = data.appClientId ? mockState.billingClients.filter((item) => item.id === Number(data.appClientId)) : mockState.billingClients;
    const selected = clients[0];
    return {
      success: true,
      clients,
      ...(selected?.balanceSource === "ai_provider" ? { externalBilling: mockExternalBilling } : {}),
      usageEvents: selected ? [{ id: 11, appClientId: selected.id, action: "assistant_chat_turn", model: "gpt-5-mini", totalTokens: 1770, chargedUnits: 44, createdAt: now }] : [],
      walletLedger: mockState.billingClients.filter((item) => item.balanceSource === "local_wallet").map((item) => ({ id: item.id, appClientId: item.id, entryType: "adjustment", unitsDelta: 88000, balanceAfter: 88000, reason: "历史余额", createdAt: now })),
      rechargeOrders: [],
      usageSummary: { requestCount: 1, totalTokens: 1770, chargedUnits: 44 },
      pagination: { page: 1, pageSize: 100, totalPages: 1 },
    };
  }
  if (action === "adminUpdateAppClientBillingSettings") {
    mockState.billingClients = mockState.billingClients.map((item) => item.id === Number(data.appClientId) ? { ...item, balanceSource: ["relay", "external"].includes(data.settings?.billingSource) ? "ai_provider" : "local_wallet", billingSettings: { ...item.billingSettings, ...(data.settings || {}) } } : item);
    return { success: true, saved: true };
  }
  if (action === "adminAdjustAppClientBalance") return { success: true, saved: true };
  if (action === "adminGetPlatformBillingSettings") {
    return { success: true, platformBillingSettings: { ...mockState.platformBillingSettings } };
  }
  if (action === "adminUpdatePlatformBillingSettings") {
    const settings = data.settings || {};
    const inputFactor = Number(settings.customerInputCnyPerMillion) / 35;
    const outputFactor = Number(settings.customerOutputCnyPerMillion) / 210;
    const displayFactor = Math.round((Math.max(inputFactor, outputFactor) + Number.EPSILON) * 100) / 100;
    mockState.platformBillingSettings = {
      ...mockState.platformBillingSettings,
      customerInputCnyPerMillion: Number(settings.customerInputCnyPerMillion),
      customerOutputCnyPerMillion: Number(settings.customerOutputCnyPerMillion),
      pricingLabel: settings.pricingLabel,
      inputFactor,
      outputFactor,
      displayFactor,
      customerBillingFactor: displayFactor,
      pricingVersion: Number(mockState.platformBillingSettings.pricingVersion || 0) + 1,
      pricingEffectiveAt: new Date().toISOString(),
    };
    return { success: true, platformBillingSettings: { ...mockState.platformBillingSettings } };
  }
  if (action === "adminList") return { success: true, adminSession: { role: mockRole, communityIds: mockRole === "community_admin" ? [1] : [] }, ...mockState };
  if (action === "adminListProjectApplicationReviews") {
    const statuses = data.statuses || [];
    const applications = mockState.projectApplications
      .filter((item) => !statuses.length || statuses.includes(item.status))
      .map((item) => ({
        ...item,
        project: mockState.projects.find((project) => project.id === item.project_id) || null,
        applicant: mockState.users.find((user) => user.id === item.user_id) || null,
      }));
    return { success: true, applications };
  }
  if (action === "adminGetProjectApplicationReview") {
    const application = mockState.projectApplications.find((item) => Number(item.id) === Number(data.applicationId));
    if (!application) return { success: false, message: "项目申请不存在" };
    const applicant = mockState.users.find((item) => item.id === application.user_id) || null;
    return {
      success: true,
      application,
      project: mockState.projects.find((item) => item.id === application.project_id) || null,
      applicant,
      profile: { name: applicant?.display_name || "", job: "AI 产品顾问", company: "示例科技", city: "上海" },
      evidenceRecords: mockState.evidence.filter((item) => item.user_id === application.user_id),
      reviewLogs: [],
    };
  }
  if (action === "adminDecideProjectApplication") {
    const statusByDecision = { promote_owner: "pending_owner_review", request_contact: "pending_contact_consent", reject: "rejected", extend_review: "pending_admin_review" };
    mockState.projectApplications = mockState.projectApplications.map((item) => Number(item.id) === Number(data.applicationId) ? {
      ...item,
      status: statusByDecision[data.decision] || item.status,
      admin_feedback: data.feedback || "",
      admin_review_deadline_at: data.decision === "extend_review" ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    } : item);
    return { success: true, applicationId: data.applicationId, decision: data.decision, status: statusByDecision[data.decision] };
  }
  if (action === "processProjectApplicationReviews") return { success: true, checked: 0, completed: 0, failed: 0 };
  if (action === "adminReviewCandidate") {
    if (data.targetType === "evidence") {
      mockState.evidence = mockState.evidence.map((item) => Number(item.id) === Number(data.targetId) ? { ...item, status: data.status } : item);
    }
    return { success: true, saved: true };
  }
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
