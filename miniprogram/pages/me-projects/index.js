const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");

function normalizeTags(tags) {
  return Array.isArray(tags) ? tags : [];
}

Page({
  data: {
    loading: true,
    projects: [],
    projectIcon: assets.getAsset("puzzle"),
  },

  onLoad() {
    this.loadProjects();
  },

  onPullDownRefresh() {
    this.loadProjects().finally(() => wx.stopPullDownRefresh());
  },

  loadProjects() {
    this.setData({ loading: true });
    return api
      .request("listMyProjects")
      .then((result) => {
        const projects = (result.projects || [])
          .filter((item) => item.is_creator || item.is_member || item.member_status === "active")
          .map((item) => ({ ...item, tags: normalizeTags(item.tags) }));
        this.setData({ projects });
      })
      .catch((err) => wx.showToast({ title: err.message || "项目暂时没加载出来", icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  openProject(e) {
    wx.navigateTo({ url: `/pages/project-space/index?id=${e.currentTarget.dataset.id}` });
  },
});
