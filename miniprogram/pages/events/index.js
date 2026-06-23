const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");

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
    loading: true,
    events: [],
    calendarSrc: "",
    locationSrc: "",
    emptySrc: "",
    registeringId: "",
    icons: {
      watch: "/images/daimao2/search.png",
      innings: "/images/daimao2/puzzle.png",
      friends: "/images/daimao2/friends.png",
      me: "/images/daimao2/project-task.png",
    },
  },

  onLoad() {
    assets.resolveAssetsIndividually(["eventCalendar", "eventLocation", "emptyEvent"]).then((map) => {
      this.setData({
        calendarSrc: map.eventCalendar || "",
        locationSrc: map.eventLocation || "",
        emptySrc: map.emptyEvent || "",
      });
    });
    this.loadEvents();
  },

  onShow() {
    if (!this.data.loading) this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  loadEvents() {
    this.setData({ loading: true });
    return api
      .request("listEvents")
      .then((result) => {
        const events = (result.events || []).map((item) => ({
          ...item,
          dateLabel: formatDate(item.start_time),
          capacityLabel: item.capacity ? `${item.registration_count || 0}/${item.capacity} 人` : `${item.registration_count || 0} 人报名`,
          registered: ["registered", "approved"].includes(item.registration_status),
        }));
        this.setData({ events });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  register(e) {
    const eventId = e.currentTarget.dataset.id;
    if (this.data.registeringId) return;
    this.setData({ registeringId: eventId });
    api
      .request("registerEvent", { eventId })
      .then(() => {
        wx.showToast({ title: "报名成功", icon: "success" });
        this.loadEvents();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ registeringId: "" }));
  },

  goNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      innings: "/pages/innings/index?tab=events",
      friends: "/pages/index/index?tab=history",
      me: "/pages/me/index",
    };
    wx.redirectTo({ url: routes[e.currentTarget.dataset.target] });
  },
});
