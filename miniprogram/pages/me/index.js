const api = require("../../utils/businessApi");
const experience = require("../../utils/experience");
const secretaryBubble = require("../../utils/secretaryBubble");

const PROFILE_KEY = "daimao_profile";
const ICONS = {
  watch: "/images/daimao2/search.png",
  innings: "/images/daimao2/puzzle.png",
  friends: "/images/daimao2/friends.png",
  me: "/images/daimao2/project-task.png",
};

Page({
  data: {
    loading: true,
    icons: ICONS,
    profile: null,
    identity: {
      role: "watcher",
      isAdmin: false,
      isCommunityMember: false,
      experiencePoints: 0,
      communities: [],
    },
    level: experience.getLevel(0),
    levelNextText: "距离 Lv.02 还差 10 经验",
    experienceRules: [
      experience.RULES.register_profile,
      experience.RULES.card_viewed_by_other,
      experience.RULES.view_other_card,
      experience.RULES.apply_project,
      experience.RULES.join_project,
      experience.RULES.project_completed_member,
    ],
    projects: [],
    events: [],
    memories: [],
    secretaryBubble: secretaryBubble.defaultState(),
  },

  onLoad() {
    this.loadData();
    secretaryBubble.start(this);
  },

  onShow() {
    secretaryBubble.start(this);
    if (!this.data.loading) this.loadData();
  },

  onUnload() {
    secretaryBubble.stop(this);
  },

  loadData() {
    this.setData({ loading: true, profile: wx.getStorageSync(PROFILE_KEY) || null });
    return Promise.all([
      api.request("listMyProjects").catch(() => ({ projects: [] })),
      api.request("listEvents").catch(() => ({ events: [] })),
      api.request("getAgentProfile").catch(() => ({ memories: [] })),
      api.request("getMyIdentity").catch(() => ({ identity: null })),
    ])
      .then(([projects, events, agent, identityResult]) => {
        const identity = identityResult.identity || {
          role: "watcher",
          isCommunityMember: false,
          experiencePoints: 0,
          communities: [],
        };
        this.setData({
          identity,
          level: experience.getLevel(identity.experiencePoints || 0),
          levelNextText: this.buildLevelNextText(identity.experiencePoints || 0),
          projects: (projects.projects || []).slice(0, 3),
          events: (events.events || []).filter((item) => ["registered", "approved"].includes(item.registration_status)).slice(0, 3),
          memories: (agent.memories || []).slice(0, 3),
        });
      })
      .finally(() => this.setData({ loading: false }));
  },

  openCard() {
    wx.navigateTo({ url: "/pages/index/index?tab=me" });
  },

  openAgentSettings() {
    wx.navigateTo({ url: "/pages/agent-profile/index" });
  },

  buildLevelNextText(points) {
    const level = experience.getLevel(points);
    if (!level.next) return "已经到达当前最高等级";
    return `距离 ${level.next.name} 还差 ${level.pointsToNext} 经验`;
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/me/index");
  },

  openProject(e) {
    wx.navigateTo({ url: `/pages/project-space/index?id=${e.currentTarget.dataset.id}` });
  },

  goNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      innings: "/pages/innings/index",
      friends: "/pages/index/index?tab=history",
    };
    wx.redirectTo({ url: routes[e.currentTarget.dataset.target] });
  },
});
