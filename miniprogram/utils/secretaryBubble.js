const assets = require("./assets");

function defaultState() {
  return {
    visible: true,
    frame: 0,
    frames: [assets.getAsset("catLean") || assets.getAsset("catLaying"), assets.getAsset("catPaw")],
  };
}

function tick(page) {
  const bubble = page.data.secretaryBubble || defaultState();
  page.setData({ "secretaryBubble.frame": bubble.frame === 0 ? 1 : 0 });
}

function start(page) {
  if (page.secretaryBubbleTimer) clearInterval(page.secretaryBubbleTimer);
  page.secretaryBubbleTimer = setInterval(() => tick(page), 900);
}

function stop(page) {
  if (page.secretaryBubbleTimer) clearInterval(page.secretaryBubbleTimer);
  page.secretaryBubbleTimer = null;
}

function open(page, returnTo) {
  wx.navigateTo({ url: `/pages/secretary/index?returnTo=${encodeURIComponent(returnTo || "")}` });
}

module.exports = {
  defaultState,
  start,
  stop,
  open,
};
