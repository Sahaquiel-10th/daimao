const KEYS = {
  projects: "daimao_2_projects",
  events: "daimao_2_events",
  notifications: "daimao_2_notifications",
  applications: "daimao_2_project_applications",
  agentProfile: "daimao_2_agent_profile",
  currentUser: "daimao_2_current_user",
};

const DEFAULT_COMMUNITIES = [
  { id: 1, name: "OPC 评审会", badge: "OPC", personality: "务实、重交付、看真实项目记录" },
  { id: 2, name: "周末产品营", badge: "产品营", personality: "爱试错、重产品原型、偏行动派" },
];

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function currentUser() {
  const stored = wx.getStorageSync(KEYS.currentUser);
  if (stored && stored.id) return stored;
  const user = {
    id: 101,
    display_name: "我",
    is_admin: 1,
    experience_points: 42,
    communities: [DEFAULT_COMMUNITIES[0]],
  };
  wx.setStorageSync(KEYS.currentUser, user);
  return user;
}

function seedProjects() {
  return [
    {
      id: 1,
      name: "OPC 城市会客厅",
      description: "让一个人公司在真实见面中找到合作伙伴、客户与同行。线上只围观，线下见过再入局。",
      project_type: "community",
      tags: ["OPC", "线下会客厅", "商务合作"],
      stage: "公开测试",
      goal: "在上海完成 10 场高质量小局",
      creator_user_id: 201,
      creator_name: "呆猫官方",
      visibility: "public",
      status: "active",
      star_count: 86,
      watch_count: 86,
      official_sort_weight: 100,
      is_official_recommended: 1,
      is_watching: 0,
      is_member: 0,
      updated_at: now(),
      updates: [
        {
          id: 11,
          title: "第一批城市主理人开始约见",
          content: "本周完成首批 12 位 OPC 的线下访谈，正在整理共同关注的协作议题。",
          visibility: "public",
          update_type: "progress",
          created_at: "2026-06-14T10:00:00+08:00",
        },
        {
          id: 12,
          title: "会客厅空间完成勘察",
          content: "已确认两个候选空间，下次开局会公布最终地点。",
          visibility: "public",
          update_type: "milestone",
          created_at: "2026-06-12T16:30:00+08:00",
        },
      ],
    },
    {
      id: 2,
      name: "AI 原生品牌实验室",
      description: "一组设计师、开发者与内容主理人，用两周时间共同完成一个 AI 原生品牌实验。",
      project_type: "ai_product",
      tags: ["AI产品", "品牌实验", "共创"],
      stage: "招募共创者",
      goal: "完成可公开演示的品牌工作流",
      creator_user_id: 202,
      creator_name: "林一",
      visibility: "public",
      status: "active",
      star_count: 43,
      watch_count: 43,
      official_sort_weight: 20,
      is_official_recommended: 1,
      is_watching: 1,
      is_member: 0,
      updated_at: now(),
      updates: [
        {
          id: 21,
          title: "方向从工具转向真实项目",
          content: "团队决定不再制作通用工具，改为用一个真实品牌验证完整流程。",
          visibility: "public",
          update_type: "progress",
          created_at: "2026-06-13T09:20:00+08:00",
        },
      ],
    },
    {
      id: 3,
      name: "独立开发者周末船坞",
      description: "周末集中推进各自产品，固定做短同步和 Demo，不设公开招聘。",
      project_type: "indie_hacker",
      tags: ["独立开发", "周末推进", "Demo"],
      stage: "持续进行",
      goal: "让每个成员每两周交付一次真实进展",
      creator_user_id: 101,
      creator_name: "我",
      visibility: "public",
      status: "active",
      star_count: 18,
      watch_count: 18,
      official_sort_weight: 0,
      is_official_recommended: 0,
      is_watching: 0,
      is_member: 1,
      my_role: "creator",
      updated_at: now(),
      members: [
        { user_id: 101, display_name: "我", role: "creator", status: "active" },
        { user_id: 203, display_name: "阿哲", role: "executor", status: "active" },
      ],
      updates: [
        {
          id: 31,
          title: "完成第一轮产品互评",
          content: "两位成员完成落地页互评，下一步各自验证真实用户反馈。",
          visibility: "public",
          update_type: "progress",
          created_at: "2026-06-15T11:00:00+08:00",
        },
        {
          id: 32,
          title: "内部资源清单",
          content: "已整理设计、前端和渠道资源，供项目成员内部使用。",
          visibility: "project_members",
          update_type: "resource_update",
          created_at: "2026-06-15T12:00:00+08:00",
        },
      ],
      records: [],
      reminderIntents: [],
      projectEvents: [
        {
          id: 301,
          project_id: 3,
          title: "周末产品同步",
          start_time: "2026-06-20T15:00:00+08:00",
          location: "上海静安",
          timezone: "Asia/Shanghai",
          status: "active",
        },
      ],
    },
  ];
}

function seedEvents() {
  return [
    {
      id: 1,
      title: "呆猫 OPC 开局夜",
      description: "6 位主理人的闭门小局。先讲正在做的事，再决定会后和谁继续见面。",
      event_type: "networking",
      location: "上海 · 静安",
      start_time: "2026-06-27T19:00:00+08:00",
      end_time: "2026-06-27T21:30:00+08:00",
      host_name: "呆猫官方",
      status: "published",
      visibility: "public",
      official_sort_weight: 100,
      capacity: 18,
      registration_count: 11,
      registration_status: "",
    },
    {
      id: 2,
      title: "AI 项目复盘工作坊",
      description: "带一份真实项目记录来，现场把它整理为进度、待办和下一次日程。",
      event_type: "workshop",
      location: "上海 · 徐汇",
      start_time: "2026-07-04T14:00:00+08:00",
      end_time: "2026-07-04T17:00:00+08:00",
      host_name: "呆猫官方",
      status: "published",
      visibility: "public",
      official_sort_weight: 80,
      capacity: 12,
      registration_count: 8,
      registration_status: "registered",
    },
  ];
}

function seedNotifications() {
  return [
    {
      id: 3,
      type: "daily_secretary_brief",
      title: "早上好，我替你看了 4 件事",
      content: "1 个项目有新进度，1 场官方开局快开始，2 个项目可能适合你围观。",
      read_status: "unread",
      created_at: "2026-06-16T09:00:00+08:00",
    },
    {
      id: 1,
      type: "project_update",
      title: "你围观的项目有新进展",
      content: "AI 原生品牌实验室发布了新的公开进度。",
      read_status: "unread",
      created_at: "2026-06-15T09:30:00+08:00",
    },
    {
      id: 2,
      type: "event_recommendation",
      title: "秘书推荐了一场开局",
      content: "呆猫 OPC 开局夜与你正在寻找的产品合作方向相关。",
      read_status: "unread",
      created_at: "2026-06-14T20:00:00+08:00",
    },
  ];
}

function get(key, seed) {
  const stored = wx.getStorageSync(key);
  if (Array.isArray(stored) && stored.length) return stored;
  const initial = seed();
  wx.setStorageSync(key, initial);
  return initial;
}

function save(key, value) {
  wx.setStorageSync(key, value);
}

function projectById(projectId) {
  return get(KEYS.projects, seedProjects).find((item) => Number(item.id) === Number(projectId));
}

function listProjects() {
  const projects = get(KEYS.projects, seedProjects)
    .filter((item) => item.visibility === "public" && ["active", "completed"].includes(item.status))
    .sort(
      (a, b) =>
        Number(b.is_official_recommended) - Number(a.is_official_recommended) ||
        b.official_sort_weight - a.official_sort_weight ||
        b.star_count - a.star_count
    );
  return { success: true, projects: clone(projects) };
}

function listMyProjects() {
  const user = currentUser();
  const projects = get(KEYS.projects, seedProjects)
    .filter((item) => item.creator_user_id === user.id || item.is_member)
    .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
  return { success: true, projects: clone(projects) };
}

function getProject({ projectId }) {
  const project = projectById(projectId);
  if (!project) return { success: false, code: "PROJECT_NOT_FOUND", message: "项目不存在" };
  const isMember = !!project.is_member || project.creator_user_id === currentUser().id;
  const identity = getMyIdentity().identity;
  const updates = (project.updates || []).filter((item) => item.visibility === "public" || isMember);
  return {
    success: true,
    project: clone({
      ...project,
      can_apply: identity.isCommunityMember || identity.isAdmin,
      viewer_role: identity.role,
      viewer_communities: identity.communities,
    }),
    updates: clone(updates),
  };
}

function createProject({ project }) {
  const projects = get(KEYS.projects, seedProjects);
  const user = currentUser();
  const item = {
    id: Date.now(),
    name: String(project.name || "").trim(),
    description: String(project.description || "").trim(),
    project_type: "official",
    tags: parseTags(project.tagsText || project.tags || project.projectType || ""),
    ideal_participant: project.idealParticipant || "",
    not_fit_participant: project.notFitParticipant || "",
    required_capabilities: parseTags(project.requiredCapabilitiesText || project.requiredCapabilities || ""),
    participation_roles: parseTags(project.participationRolesText || project.participationRoles || ""),
    stage: project.stage || "刚刚发起",
    goal: project.goal || "",
    creator_user_id: user.id,
    creator_name: user.display_name,
    visibility: project.visibility === "public" ? "public" : "private",
    status: project.status === "active" ? "active" : "draft",
    star_count: 0,
    watch_count: 0,
    official_sort_weight: 0,
    is_official_recommended: 0,
    is_watching: 0,
    is_member: 1,
    my_role: "creator",
    updated_at: now(),
    members: [{ user_id: user.id, display_name: user.display_name, role: "creator", status: "active" }],
    updates: [],
    records: [],
    reminderIntents: [],
    projectEvents: [],
  };
  if (!item.name || !item.description) return { success: false, code: "VALIDATION_ERROR", message: "项目名称和介绍不能为空" };
  save(KEYS.projects, [item, ...projects]);
  return { success: true, projectId: item.id };
}

function parseTags(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.replace(/^#/, "").trim())
    .filter(Boolean);
}

function toggleWatch({ projectId }) {
  const projects = get(KEYS.projects, seedProjects);
  const index = projects.findIndex((item) => Number(item.id) === Number(projectId));
  if (index < 0) return { success: false, code: "PROJECT_NOT_FOUND", message: "项目不存在" };
  const item = projects[index];
  item.is_watching = item.is_watching ? 0 : 1;
  item.star_count = Math.max(0, item.star_count + (item.is_watching ? 1 : -1));
  item.watch_count = item.star_count;
  projects[index] = item;
  save(KEYS.projects, projects);
  return { success: true, watching: !!item.is_watching, starCount: item.star_count, watchCount: item.watch_count };
}

function publishUpdate({ projectId, update }) {
  const projects = get(KEYS.projects, seedProjects);
  const index = projects.findIndex((item) => Number(item.id) === Number(projectId));
  if (index < 0) return { success: false, code: "PROJECT_NOT_FOUND", message: "项目不存在" };
  const item = {
    id: Date.now(),
    title: String(update.title || "").trim(),
    content: String(update.content || "").trim(),
    visibility: update.visibility === "public" ? "public" : "project_members",
    update_type: update.updateType || "progress",
    created_at: now(),
  };
  if (!item.title || !item.content) return { success: false, code: "VALIDATION_ERROR", message: "进度标题和内容不能为空" };
  projects[index].updates = [item, ...(projects[index].updates || [])];
  save(KEYS.projects, projects);
  return { success: true, updateId: item.id };
}

function createMeetingRequest({ projectId, request }) {
  const project = projectById(projectId);
  const summary = `想围绕「${project.name}」交流：${request.reason}${request.canOffer ? `；可提供：${request.canOffer}` : ""}`;
  const notifications = get(KEYS.notifications, seedNotifications);
  notifications.unshift({
    id: Date.now(),
    type: "meeting_request",
    title: `已提交约见：${project.name}`,
    content: summary,
    read_status: "unread",
    created_at: now(),
  });
  save(KEYS.notifications, notifications);
  return { success: true, requestId: Date.now(), aiSummary: summary, aiRecommendation: "notify" };
}

function applyProject({ projectId, request }) {
  const project = projectById(projectId);
  if (!project) return { success: false, code: "PROJECT_NOT_FOUND", message: "项目不存在" };
  const identity = getMyIdentity().identity;
  if (!identity.isCommunityMember && !identity.isAdmin) {
    return { success: false, code: "COMMUNITY_CERTIFICATION_REQUIRED", message: "通过任一社区认证后，才能申请参与项目" };
  }
  const applications = get(KEYS.applications, () => []);
  const application = {
    id: Date.now(),
    project_id: project.id,
    user_id: currentUser().id,
    project_name: project.name,
    requester_name: currentUser().display_name,
    message: request.message || "",
    can_offer: request.canOffer || "",
    related_experience: request.relatedExperience || "",
    ai_review_status: "pass",
    ai_review_summary: `小秘书初筛：申请人与「${project.name}」方向匹配，建议递交主理人确认。`,
    status: "pending_owner_review",
    updated_at: now(),
  };
  save(KEYS.applications, [application, ...applications.filter((item) => Number(item.project_id) !== Number(project.id))]);
  return {
    success: true,
    applicationId: application.id,
    aiReviewStatus: application.ai_review_status,
    aiSummary: application.ai_review_summary,
  };
}

function listEvents() {
  return { success: true, events: clone(get(KEYS.events, seedEvents)) };
}

function registerEvent({ eventId }) {
  const events = get(KEYS.events, seedEvents);
  const index = events.findIndex((item) => Number(item.id) === Number(eventId));
  if (index < 0) return { success: false, code: "EVENT_NOT_FOUND", message: "活动不存在" };
  events[index].registration_status = "registered";
  events[index].registration_count += 1;
  save(KEYS.events, events);
  return { success: true, status: "registered" };
}

function getAgentProfile() {
  const stored = wx.getStorageSync(KEYS.agentProfile);
  return {
    success: true,
    profile:
      stored ||
      {
        public_intro: "",
        current_role: "",
        current_goals_json: [],
        can_offer_json: [],
        looking_for_json: [],
        not_interested_in_json: [],
        preferred_project_types_json: [],
        collaboration_style: "",
        allow_matchmaking: 1,
        allow_ai_profile: 1,
      },
    memories: [],
  };
}

function getMyIdentity() {
  const user = currentUser();
  const communities = user.communities || [];
  const points = Number(user.experience_points || 0);
  return {
    success: true,
    identity: {
      userId: user.id,
      role: user.is_admin ? "admin" : communities.length ? "community_member" : "watcher",
      isAdmin: !!user.is_admin,
      isCommunityMember: communities.length > 0,
      communities,
      experiencePoints: points,
    },
  };
}

function saveAgentProfile({ profile }) {
  wx.setStorageSync(KEYS.agentProfile, {
    public_intro: profile.publicIntro,
    current_role: profile.currentRole,
    current_goals_json: profile.currentGoals || [],
    can_offer_json: profile.canOffer || [],
    looking_for_json: profile.lookingFor || [],
    not_interested_in_json: profile.notInterestedIn || [],
    preferred_project_types_json: profile.preferredProjectTypes || [],
    collaboration_style: profile.collaborationStyle,
    allow_matchmaking: profile.allowMatchmaking === false ? 0 : 1,
    allow_ai_profile: profile.allowAiProfile === false ? 0 : 1,
  });
  return { success: true, saved: true };
}

function listNotifications() {
  return {
    success: true,
    notifications: clone(get(KEYS.notifications, seedNotifications)),
    meetingRequests: [],
    projectApplications: clone(get(KEYS.applications, () => [])),
    invitations: [],
  };
}

function markNotificationRead({ notificationId }) {
  const notifications = get(KEYS.notifications, seedNotifications).map((item) =>
    Number(item.id) === Number(notificationId) ? { ...item, read_status: "read" } : item
  );
  save(KEYS.notifications, notifications);
  return { success: true, read: true };
}

function getProjectSpace({ projectId }) {
  const project = projectById(projectId);
  if (!project || (!project.is_member && project.creator_user_id !== currentUser().id)) {
    return { success: false, code: "FORBIDDEN", message: "你还不是该项目成员" };
  }
  return {
    success: true,
    project: clone(project),
    members: clone(project.members || []),
    updates: clone((project.updates || []).filter((item) => item.visibility === "project_members")),
    records: clone(project.records || []),
    reminderIntents: clone(project.reminderIntents || []),
    projectEvents: clone(project.projectEvents || []),
    inviteCandidates: clone(project.inviteCandidates || []),
  };
}

function inviteMember({ projectId, userId, role }) {
  const projects = get(KEYS.projects, seedProjects);
  const index = projects.findIndex((item) => Number(item.id) === Number(projectId));
  if (index < 0) return { success: false, code: "PROJECT_NOT_FOUND", message: "项目不存在" };
  const candidates = projects[index].inviteCandidates || [];
  const candidate = candidates.find((item) => Number(item.user_id) === Number(userId));
  projects[index].inviteCandidates = candidates.filter((item) => Number(item.user_id) !== Number(userId));
  projects[index].members = [
    ...(projects[index].members || []),
    {
      user_id: Number(userId),
      display_name: (candidate && candidate.display_name) || `用户 ${userId}`,
      role: role || "member",
      status: "invited",
    },
  ];
  save(KEYS.projects, projects);
  return { success: true, status: "invited" };
}

function createProjectRecord({ projectId, record }) {
  const projects = get(KEYS.projects, seedProjects);
  const index = projects.findIndex((item) => Number(item.id) === Number(projectId));
  const item = {
    id: Date.now(),
    title: record.title,
    record_type: record.recordType || "manual_note",
    raw_text: record.rawText || "",
    ai_process_status: "pending",
    created_at: now(),
  };
  projects[index].records = [item, ...(projects[index].records || [])];
  save(KEYS.projects, projects);
  return { success: true, recordId: item.id };
}

function analyzeProjectRecord({ recordId }) {
  const projects = get(KEYS.projects, seedProjects);
  let targetProject;
  let targetRecord;
  projects.forEach((project) => {
    const record = (project.records || []).find((item) => Number(item.id) === Number(recordId));
    if (record) {
      targetProject = project;
      targetRecord = record;
    }
  });
  if (!targetRecord) return { success: false, code: "RECORD_NOT_FOUND", message: "记录不存在" };
  targetRecord.ai_process_status = "completed";
  const intent = {
    id: Date.now() + 1,
    project_id: targetProject.id,
    source_record_id: targetRecord.id,
    type: "meeting",
    title: "下一次项目同步",
    time_text: "下周四下午三点",
    normalized_time: "2026-06-25T15:00:00+08:00",
    timezone: "Asia/Shanghai",
    source_quote: "那我们下周四下午三点再同步一次",
    confidence: 0.86,
    status: "pending",
  };
  targetProject.reminderIntents = [intent, ...(targetProject.reminderIntents || [])];
  save(KEYS.projects, projects);
  return {
    success: true,
    jobId: Date.now(),
    output: {
      summary: "项目完成一次阶段同步，并明确了下一次会议时间。",
      public_update_draft: {
        title: "项目完成阶段同步",
        content: "项目组完成需求拆解，并确定下一次同步时间。",
        suggested_visibility: "public",
        confidence: 0.78,
      },
      detected_events: [],
      detected_tasks: [],
      user_observations: [],
      profile_memory_candidates: [],
    },
  };
}

function confirmReminderIntent({ intentId, intent }) {
  const projects = get(KEYS.projects, seedProjects);
  let projectEventId = Date.now();
  projects.forEach((project) => {
    const target = (project.reminderIntents || []).find((item) => Number(item.id) === Number(intentId));
    if (!target) return;
    target.status = "confirmed";
    project.reminderIntents = project.reminderIntents.filter((item) => Number(item.id) !== Number(intentId));
    project.projectEvents = [
      {
        id: projectEventId,
        project_id: project.id,
        title: intent.title || target.title,
        start_time: intent.normalizedTime || target.normalized_time,
        timezone: "Asia/Shanghai",
        status: "active",
      },
      ...(project.projectEvents || []),
    ];
  });
  save(KEYS.projects, projects);
  return { success: true, projectEventId };
}

function getRecommendations() {
  const projects = listProjects().projects.slice(0, 3);
  return {
    success: true,
    recommendations: projects.map((project) => ({
      target_id: project.id,
      target_type: "project",
      name: project.name,
      description: project.description,
      star_count: project.star_count,
      reason_summary: project.is_official_recommended ? "官方推荐，与你关注的 OPC 协作方向相关" : `${project.star_count} 人正在围观`,
    })),
  };
}

function respondMeetingRequest() {
  return { success: true, status: "accepted" };
}

function respondProjectApplication({ applicationId, decision }) {
  const applications = get(KEYS.applications, () => []);
  const index = applications.findIndex((item) => Number(item.id) === Number(applicationId));
  if (index >= 0) {
    applications[index].status = decision === "accepted" ? "accepted" : "rejected";
    save(KEYS.applications, applications.filter((item) => item.status === "pending_owner_review"));
  }
  return { success: true, status: decision === "accepted" ? "accepted" : "rejected" };
}

function processRagIndexJobs() {
  return { success: true, checked: 0, completed: 0, failed: 0 };
}

function acceptProjectInvitation({ projectId }) {
  const projects = get(KEYS.projects, seedProjects);
  const index = projects.findIndex((item) => Number(item.id) === Number(projectId));
  if (index >= 0) projects[index].is_member = 1;
  save(KEYS.projects, projects);
  return { success: true, status: "active" };
}

function authorizeReminder() {
  return { success: true, authorized: true, templateId: "mock-template" };
}

const handlers = {
  listProjects,
  listMyProjects,
  getProject,
  createProject,
  toggleWatch,
  publishUpdate,
  createMeetingRequest,
  applyProject,
  listEvents,
  registerEvent,
  getAgentProfile,
  getMyIdentity,
  saveAgentProfile,
  listNotifications,
  markNotificationRead,
  getProjectSpace,
  createProjectRecord,
  analyzeProjectRecord,
  confirmReminderIntent,
  getRecommendations,
  respondMeetingRequest,
  respondProjectApplication,
  processRagIndexJobs,
  acceptProjectInvitation,
  authorizeReminder,
  inviteMember,
};

function call(action, data) {
  const handler = handlers[action];
  if (!handler) return { success: false, code: "MOCK_NOT_IMPLEMENTED", message: `Mock 未实现 ${action}` };
  return handler(data || {});
}

module.exports = { call, KEYS };
