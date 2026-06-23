const api = require("../../utils/businessApi");
const secretaryBubble = require("../../utils/secretaryBubble");

const ICONS = {
  watch: "/images/daimao2/search.png",
  innings: "/images/daimao2/puzzle.png",
  friends: "/images/daimao2/friends.png",
  me: "/images/daimao2/project-task.png",
};

Page({
  data: {
    loading: true,
    secretaryFrames: ["/images/daimao2/cat-lean-cutout.png", "/images/daimao2/cat-paw-cutout.png"],
    secretaryBubble: secretaryBubble.defaultState(),
    activeFrame: 0,
    icons: ICONS,
    notifications: [],
    recommendations: [],
    events: [],
    myProjects: [],
    stats: {
      unread: 0,
      recommended: 0,
      upcoming: 0,
      activeProjects: 0,
    },
    briefLines: [],
  },

  onLoad() {
    this.startSecretaryAnimation();
    this.loadBrief();
    secretaryBubble.start(this);
  },

  onShow() {
    secretaryBubble.start(this);
  },

  onUnload() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    secretaryBubble.stop(this);
  },

  onPullDownRefresh() {
    this.loadBrief().finally(() => wx.stopPullDownRefresh());
  },

  startSecretaryAnimation() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = setInterval(() => {
      this.setData({ activeFrame: this.data.activeFrame === 0 ? 1 : 0 });
    }, 850);
  },

  loadBrief() {
    this.setData({ loading: true });
    return Promise.all([
      api.request("listNotifications"),
      api.request("getRecommendations"),
      api.request("listEvents"),
      api.request("listMyProjects").catch(() => ({ projects: [] })),
    ])
      .then(([inbox, recommendations, events, myProjects]) => {
        const notifications = inbox.notifications || [];
        const recommendationList = recommendations.recommendations || [];
        const eventList = events.events || [];
        const projectList = myProjects.projects || [];
        const unread = notifications.filter((item) => item.read_status === "unread").length;
        const activeProjects = projectList.filter((item) => item.status === "active").length;
        const briefLines = [
          unread ? `你离开这段时间，有 ${unread} 条新消息。` : "你离开这段时间，没有必须马上处理的消息。",
          recommendationList.length ? `我挑了 ${recommendationList.length} 个项目，适合先围观。` : "暂时没有新的项目推荐。",
          eventList.length ? `最近有 ${eventList.length} 场官方开局可以看看。` : "最近还没有新的官方开局。",
          activeProjects ? `你参与的 ${activeProjects} 个项目还在推进。` : "你还没有进行中的开局，今天可以先找一个项目围观。",
        ];
        this.setData({
          notifications,
          recommendations: recommendationList.slice(0, 3),
          events: eventList.slice(0, 2),
          myProjects: projectList.slice(0, 3),
          stats: {
            unread,
            recommended: recommendationList.length,
            upcoming: eventList.length,
            activeProjects,
          },
          briefLines,
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  openProject(e) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  openEvent() {
    wx.redirectTo({ url: "/pages/innings/index?tab=events" });
  },

  openSecretary() {
    secretaryBubble.open(this, "/pages/home/index");
  },

  goNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      innings: "/pages/innings/index",
      friends: "/pages/index/index?tab=history",
      me: "/pages/me/index",
    };
    wx.redirectTo({ url: routes[e.currentTarget.dataset.target] });
  },
});
