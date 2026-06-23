const assert = require("node:assert/strict");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
};

const store = require("../miniprogram/utils/businessMockStore");

const projects = store.call("listProjects");
assert.equal(projects.success, true);
assert.ok(projects.projects.length >= 3);
assert.equal(projects.projects[0].is_official_recommended, 1);

const initialProject = store.call("getProject", { projectId: 1 });
const initialStars = initialProject.project.star_count;
const watched = store.call("toggleWatch", { projectId: 1 });
assert.equal(watched.success, true);
assert.equal(watched.starCount, initialStars + 1);

const created = store.call("createProject", {
  project: {
    name: "测试协作项目",
    description: "用于验证呆猫 2.0 的完整 mock 数据流程。",
    visibility: "public",
    status: "active",
  },
});
assert.equal(created.success, true);

const update = store.call("publishUpdate", {
  projectId: created.projectId,
  update: {
    title: "完成第一步",
    content: "项目已经创建，并开始公开围观。",
    visibility: "public",
  },
});
assert.equal(update.success, true);

const record = store.call("createProjectRecord", {
  projectId: created.projectId,
  record: {
    title: "项目同步会",
    rawText: "那我们下周四下午三点再同步一次。",
    recordType: "meeting_note",
  },
});
assert.equal(record.success, true);

const analysis = store.call("analyzeProjectRecord", { recordId: record.recordId });
assert.equal(analysis.success, true);
assert.ok(analysis.output.summary);

const spaceAfterAnalysis = store.call("getProjectSpace", { projectId: created.projectId });
assert.equal(spaceAfterAnalysis.reminderIntents.length, 1);
const intent = spaceAfterAnalysis.reminderIntents[0];

const confirmed = store.call("confirmReminderIntent", {
  intentId: intent.id,
  intent: { title: intent.title, normalizedTime: intent.normalized_time },
});
assert.equal(confirmed.success, true);

const finalSpace = store.call("getProjectSpace", { projectId: created.projectId });
assert.equal(finalSpace.reminderIntents.length, 0);
assert.equal(finalSpace.projectEvents.length, 1);

const profileSaved = store.call("saveAgentProfile", {
  profile: {
    publicIntro: "独立开发者",
    currentRole: "产品开发",
    currentGoals: ["完成产品测试"],
    canOffer: ["前端开发"],
    lookingFor: ["真实用户反馈"],
    notInterestedIn: ["泛泛加微信"],
    preferredProjectTypes: ["AI 产品"],
    collaborationStyle: "短同步，明确下一步",
    allowMatchmaking: true,
    allowAiProfile: true,
  },
});
assert.equal(profileSaved.success, true);
assert.equal(store.call("getAgentProfile").profile.current_role, "产品开发");
