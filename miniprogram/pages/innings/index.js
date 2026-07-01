const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");
const secretaryBubble = require("../../utils/secretaryBubble");

const ICONS = {
  watch: assets.getAsset("search"),
  innings: assets.getAsset("puzzle"),
  friends: assets.getAsset("friends"),
  me: assets.getAsset("projectTask"),
  empty: assets.getAsset("emptyProject"),
};

Page({
  data: {
    loading: true,
    projects: [],
    icons: ICONS,
    secretaryBubble: secretaryBubble.defaultState(),
  },

  onLoad() {
    this.loadData();
    secretaryBubble.start(this);
  },

  onShow() {
    secretaryBubble.start(this);
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  onUnload() {
    secretaryBubble.stop(this);
  },

  loadData() {
    this.setData({ loading: true });
    return api
      .request("listMyProjects")
      .then((projectResult) => {
        this.setData({
          projects: (projectResult.projects || [])
            .filter((item) => item.is_creator || item.is_member || item.member_status === "active")
            .map((item) => ({ ...item, tags: Array.isArray(item.tags) ? item.tags : [] })),
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/innings/index");
  },

  openProject(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/project-space/index?id=${id}` });
  },

  goNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      friends: "/pages/index/index?tab=history",
      me: "/pages/me/index",
    };
    wx.redirectTo({ url: routes[e.currentTarget.dataset.target] });
  },
});
