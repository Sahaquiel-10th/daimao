const cloudConfig = require("../config/cloud");

let sharedCloud = null;
let initPromise = null;

function canUseCloud() {
  return !!(wx.cloud && wx.cloud.Cloud);
}

function getSharedCloud() {
  if (sharedCloud) return sharedCloud;
  if (!canUseCloud()) return null;

  sharedCloud = new wx.cloud.Cloud({
    resourceAppid: cloudConfig.resourceAppid,
    resourceEnv: cloudConfig.env,
  });
  return sharedCloud;
}

function initSharedCloud() {
  const cloud = getSharedCloud();
  if (!cloud) return Promise.reject(new Error("wx.cloud.Cloud is not available"));
  if (!initPromise) {
    initPromise = cloud.init({ traceUser: true });
  }
  return initPromise.then(() => cloud);
}

function callFunction(options) {
  return initSharedCloud().then((cloud) => cloud.callFunction(options));
}

function getTempFileURL(options) {
  return initSharedCloud().then((cloud) => cloud.getTempFileURL(options));
}

function uploadFile(options) {
  return initSharedCloud().then((cloud) => cloud.uploadFile(options));
}

module.exports = {
  config: cloudConfig,
  initSharedCloud,
  callFunction,
  getTempFileURL,
  uploadFile,
};
