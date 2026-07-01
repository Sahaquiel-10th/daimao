const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");
const experience = require("../../utils/experience");
const secretaryBubble = require("../../utils/secretaryBubble");

const PROFILE_KEY = "daimao_profile";
const ICONS = {
  watch: assets.getAsset("search"),
  innings: assets.getAsset("puzzle"),
  friends: assets.getAsset("friends"),
  me: assets.getAsset("projectTask"),
  profileCat: assets.getAsset("catLean"),
  calendar: assets.getAsset("eventCalendar"),
};
const RULE_KEYS = [
  "register_profile",
  "card_viewed_by_other",
  "view_other_card",
  "apply_project",
  "join_project",
  "project_completed_member",
];
const RULES_BY_KEY = experience.RULES.reduce((map, rule) => {
  map[rule.key] = rule;
  return map;
}, {});

Page({
  data: {
    loading: true,
    icons: ICONS,
    profile: null,
    showLevelHelp: false,
    identity: {
      role: "watcher",
      isAdmin: false,
      isCommunityMember: false,
      experiencePoints: 0,
      communities: [],
    },
    level: experience.getLevel(0),
    experienceRules: RULE_KEYS.map((key) => RULES_BY_KEY[key]).filter(Boolean),
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
      api.request("getMyIdentity").catch(() => ({ identity: null })),
    ])
      .then(([identityResult]) => {
        const identity = identityResult.identity || {
          role: "watcher",
          isCommunityMember: false,
          experiencePoints: 0,
          communities: [],
        };
        this.setData({
          identity,
          level: experience.getLevel(identity.experiencePoints || 0),
        });
      })
      .finally(() => this.setData({ loading: false }));
  },

  previewCard() {
    wx.navigateTo({ url: "/pages/index/index?card=mine" });
  },

  editCard() {
    wx.navigateTo({ url: "/pages/index/index?edit=1" });
  },

  openAgentSettings() {
    wx.navigateTo({ url: "/pages/secretary/index" });
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/me/index");
  },

  openLevelHelp() {
    this.setData({ showLevelHelp: true });
  },

  closeLevelHelp() {
    this.setData({ showLevelHelp: false });
  },

  noop() {},

  openProject(e) {
    wx.navigateTo({ url: `/pages/project-space/index?id=${e.currentTarget.dataset.id}` });
  },

  openRecordPage(e) {
    const target = e.currentTarget.dataset.target;
    const routes = {
      records: "/pages/me-records/index",
      projects: "/pages/me-projects/index",
      events: "/pages/me-events/index",
    };
    const url = routes[target];
    if (url) wx.navigateTo({ url });
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
