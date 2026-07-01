const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ ...fallback, timedOut: true }), ms);
    }),
  ]);
}

Page({
  data: {
    loading: true,
    activeTab: "inbox",
    notifications: [],
    meetingRequests: [],
    projectApplications: [],
    invitations: [],
    recommendations: [],
    briefLines: [],
    stats: {
      pending: 0,
      unread: 0,
      recommended: 0,
    },
    secretarySrc: assets.getAsset("catLean"),
    processingId: "",
    closing: false,
    returnTo: "",
    icons: {
      watch: assets.getAsset("search"),
      innings: assets.getAsset("puzzle"),
      friends: assets.getAsset("friends"),
      me: assets.getAsset("projectTask"),
    },
  },

  onLoad(options) {
    this.setData({ returnTo: options.returnTo ? decodeURIComponent(options.returnTo) : "" });
    this.loadData();
  },

  onShow() {
    if (!this.data.loading) this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    return Promise.all([
      withTimeout(api.request("listNotifications"), 6000, {
        notifications: [],
        meetingRequests: [],
        projectApplications: [],
        invitations: [],
      }),
      withTimeout(api.request("getRecommendations"), 6000, { recommendations: [] }),
    ])
      .then(([inbox, recommendations]) => {
        this.setData({
          notifications: inbox.notifications || [],
          meetingRequests: inbox.meetingRequests || [],
          projectApplications: inbox.projectApplications || [],
          invitations: inbox.invitations || [],
          recommendations: recommendations.recommendations || [],
          ...this.buildBrief(inbox, recommendations),
        });
        if (inbox.timedOut || recommendations.timedOut) {
          wx.showToast({ title: "秘书稍后补全消息", icon: "none" });
        }
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  buildBrief(inbox, recommendations) {
    const notifications = inbox.notifications || [];
    const projectApplications = inbox.projectApplications || [];
    const meetingRequests = inbox.meetingRequests || [];
    const invitations = inbox.invitations || [];
    const recommendationList = recommendations.recommendations || [];
    const unread = notifications.filter((item) => item.read_status === "unread").length;
    const pending = projectApplications.length + meetingRequests.length + invitations.length;
    const briefLines = [
      pending ? `有 ${pending} 件事需要处理。` : "没有必须马上处理的事。",
      unread ? `${unread} 条新消息。` : "消息箱是干净的。",
      recommendationList.length ? `${recommendationList.length} 个项目值得先围观。` : "暂时没有新的项目推荐。",
    ];
    return {
      briefLines,
      stats: {
        pending,
        unread,
        recommended: recommendationList.length,
      },
    };
  },

  readNotification(e) {
    const notificationId = e.currentTarget.dataset.id;
    api.request("markNotificationRead", { notificationId }).then(() => {
      const notifications = this.data.notifications.map((item) =>
        Number(item.id) === Number(notificationId) ? { ...item, read_status: "read" } : item
      );
      this.setData({ notifications });
    });
  },

  respondMeeting(e) {
    const requestId = e.currentTarget.dataset.id;
    const decision = e.currentTarget.dataset.decision;
    this.setData({ processingId: requestId });
    api
      .request("respondMeetingRequest", { requestId, decision })
      .then(() => {
        wx.showToast({ title: decision === "accepted" ? "已接受约见" : "已暂拒", icon: "none" });
        this.loadData();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ processingId: "" }));
  },

  respondProjectApplication(e) {
    const applicationId = e.currentTarget.dataset.id;
    const decision = e.currentTarget.dataset.decision;
    this.setData({ processingId: applicationId });
    api
      .request("respondProjectApplication", { applicationId, decision })
      .then(() => {
        wx.showToast({ title: decision === "accepted" ? "已发出邀请" : "已暂拒", icon: "none" });
        this.loadData();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ processingId: "" }));
  },

  acceptInvitation(e) {
    const projectId = e.currentTarget.dataset.id;
    this.setData({ processingId: projectId });
    api
      .request("acceptProjectInvitation", { projectId })
      .then(() => wx.navigateTo({ url: `/pages/project-space/index?id=${projectId}` }))
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ processingId: "" }));
  },

  openRecommendation(e) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  closeSecretary() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: this.data.returnTo || "/pages/discover/index" });
  },
});
