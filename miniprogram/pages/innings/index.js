const api = require("../../utils/businessApi");
const secretaryBubble = require("../../utils/secretaryBubble");

const ICONS = {
  watch: "/images/daimao2/search.png",
  innings: "/images/daimao2/puzzle.png",
  friends: "/images/daimao2/friends.png",
  me: "/images/daimao2/project-task.png",
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    activeTab: "mine",
    loading: true,
    projects: [],
    events: [],
    icons: ICONS,
    secretaryBubble: secretaryBubble.defaultState(),
  },

  onLoad(options) {
    if (options.tab === "events") this.setData({ activeTab: "events" });
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
    return Promise.all([api.request("listMyProjects").catch(() => ({ projects: [] })), api.request("listEvents")])
      .then(([projectResult, eventResult]) => {
        this.setData({
          projects: (projectResult.projects || []).map((item) => ({ ...item, tags: Array.isArray(item.tags) ? item.tags : [] })),
          events: (eventResult.events || []).map((item) => ({
            ...item,
            dateLabel: formatDate(item.start_time),
            registered: ["registered", "approved"].includes(item.registration_status),
          })),
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  createProject() {
    wx.showModal({
      title: "想发起项目",
      content: "现在项目统一由营主/管理员审核发布。你可以先联系官方提项目线索，通过后再放进公开项目池。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/innings/index");
  },

  openProject(e) {
    const id = e.currentTarget.dataset.id;
    const isMember = e.currentTarget.dataset.member;
    wx.navigateTo({ url: isMember ? `/pages/project-space/index?id=${id}` : `/pages/project-detail/index?id=${id}` });
  },

  register(e) {
    api
      .request("registerEvent", { eventId: e.currentTarget.dataset.id })
      .then(() => {
        wx.showToast({ title: "报名成功", icon: "success" });
        this.loadData();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }));
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
