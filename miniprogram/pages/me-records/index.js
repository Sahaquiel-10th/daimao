const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ memories: [], timedOut: true }), ms);
    }),
  ]);
}

Page({
  data: {
    loading: true,
    memories: [],
    friendsIcon: assets.getAsset("friends"),
  },

  onLoad() {
    this.loadRecords();
  },

  loadRecords() {
    this.setData({ loading: true });
    withTimeout(api.request("getAgentProfile"), 6000)
      .then((result) => {
        this.setData({ memories: result.memories || [] });
        if (result.timedOut) wx.showToast({ title: "动态稍后再看", icon: "none" });
      })
      .catch((err) => {
        console.warn("load me records failed", err);
        wx.showToast({ title: "动态暂时没加载出来", icon: "none" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  goBack() {
    wx.navigateBack();
  },
});
