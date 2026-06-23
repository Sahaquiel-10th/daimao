const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");
const secretaryBubble = require("../../utils/secretaryBubble");

Page({
  data: {
    loading: true,
    projects: [],
    recommendations: [],
    emptySrc: "",
    heroCat: "/images/daimao2/cat-laying-cutout.png",
    cardCats: [
      "/images/daimao2/cat-rub-cutout.png",
      "/images/daimao2/cat-stretch-cutout.png",
      "/images/daimao2/cat-paw-cutout.png",
    ],
    secretaryBubble: secretaryBubble.defaultState(),
    icons: {
      watch: "/images/daimao2/search.png",
      innings: "/images/daimao2/puzzle.png",
      friends: "/images/daimao2/friends.png",
      me: "/images/daimao2/project-task.png",
      project: "/images/daimao2/project-task.png",
      favorite: "/images/daimao2/favorite.png",
      cooperation: "/images/daimao2/cooperation.png",
    },
  },

  onLoad() {
    this.resolveAssets();
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

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  resolveAssets() {
    assets.resolveAssetsIndividually(["emptyProject"]).then((map) => {
      this.setData({ emptySrc: map.emptyProject || "" });
    });
  },

  loadData() {
    this.setData({ loading: true });
    return Promise.all([
      api.request("listProjects"),
      api.request("getRecommendations").catch(() => ({ recommendations: [] })),
    ])
      .then(([projectResult, recommendationResult]) => {
        this.setData({
          projects: (projectResult.projects || []).map(this.decorateProject),
          recommendations: recommendationResult.recommendations || [],
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  decorateProject(project) {
    return {
      ...project,
      tags: Array.isArray(project.tags) ? project.tags : [],
      stageLabel: project.stage || "进行中",
      starLabel: `${project.star_count || 0} 颗星`,
      catSrc: this.data.cardCats[(Number(project.id || 0) || 0) % this.data.cardCats.length],
    };
  },

  openProject(e) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  openRecommendation(e) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  createProject() {
    wx.showModal({
      title: "想发起项目",
      content: "呆猫 2.0 的项目先由营主/管理员统一审核发布。你可以把项目线索、资源或想法发给官方，我们审核后再放入项目池。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/discover/index");
  },

  goNav(e) {
    const routes = {
      innings: "/pages/innings/index",
      friends: "/pages/index/index?tab=history",
      me: "/pages/me/index",
    };
    const target = routes[e.currentTarget.dataset.target];
    if (target && target !== "/pages/discover/index") wx.redirectTo({ url: target });
  },
});
