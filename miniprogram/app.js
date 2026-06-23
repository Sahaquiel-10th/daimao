const sharedCloud = require("./utils/cloud");

App({
  onLaunch() {
    this.globalData = {
      env: sharedCloud.config.env,
      resourceAppid: sharedCloud.config.resourceAppid,
    };

    if (wx.cloud) {
      sharedCloud.initSharedCloud().catch((err) => {
        console.error("shared cloud init failed", err);
      });
    }
  },
});
