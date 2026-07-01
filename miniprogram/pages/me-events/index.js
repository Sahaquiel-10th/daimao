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
    calendarIcon: assets.getAsset("eventCalendar"),
  },

  onLoad() {
    this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  loadEvents() {
    this.setData({ loading: true });
    return api
      .request("listEvents")
      .then((result) => {
        const events = (result.events || [])
          .filter((item) => ["registered", "approved", "checked_in"].includes(item.registration_status))
          .map((item) => ({ ...item, dateLabel: formatDate(item.start_time) }));
        this.setData({ events });
      })
      .catch((err) => wx.showToast({ title: err.message || "活动暂时没加载出来", icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },
});
