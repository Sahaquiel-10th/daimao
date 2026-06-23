const mockStore = require("./tagMockStore");
const runtime = require("../config/runtime");
const sharedCloud = require("./cloud");

function shouldUseMock() {
  return runtime.apiMode === "mock";
}

function isDevelopEnv() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return info && info.miniProgram && info.miniProgram.envVersion === "develop";
  } catch (err) {
    return false;
  }
}

const WRITE_ACTIONS = new Set([
  "upsertCurrentUserProfile",
  "bindTagToCurrentUser",
  "recordTagVisit",
  "registerProfileReminderSubscription",
  "acceptCurrentAgreement",
  "sendProfileReminder",
]);

function shouldUseMockForAction(action) {
  if (shouldUseMock()) return true;
  return WRITE_ACTIONS.has(action) && isDevelopEnv() && !runtime.allowCloudWritesInDevelop;
}

function canUseCloud() {
  return !!(wx.cloud && wx.cloud.Cloud);
}

function callTagFunction(action, data) {
  if (!canUseCloud()) {
    return Promise.reject(new Error("wx.cloud is not available"));
  }
  return sharedCloud
    .callFunction({
      name: "daimaoTagFunctions",
      data: { action, ...data },
    })
    .then((resp) => resp.result);
}

function withMockFallback(action, data, mockHandler) {
  if (shouldUseMockForAction(action)) return Promise.resolve(mockHandler());
  return callTagFunction(action, data).catch((err) => {
    return Promise.reject(err);
  });
}

function getTagByToken(token) {
  return withMockFallback("getTagByToken", { token }, () => mockStore.getTagByToken(token));
}

function bindTagToCurrentUser(token) {
  return withMockFallback("bindTagToCurrentUser", { token }, () => mockStore.bindTagToCurrentUser(token));
}

function recordTagVisit(data) {
  return withMockFallback("recordTagVisit", data, () => mockStore.recordTagVisit(data));
}

function registerProfileReminderSubscription(data) {
  return withMockFallback(
    "registerProfileReminderSubscription",
    data,
    () => mockStore.registerProfileReminderSubscription(data)
  );
}

function upsertCurrentUserProfile(profile) {
  return withMockFallback("upsertCurrentUserProfile", { profile }, () => mockStore.upsertCurrentUserProfile(profile));
}

function getCurrentProfile() {
  return withMockFallback("getCurrentProfile", {}, () => mockStore.getCurrentProfile());
}

function getMyConnections() {
  return withMockFallback("getMyConnections", {}, () => mockStore.getMyConnections());
}

function getProfileByUserId(userId) {
  return withMockFallback("getProfileByUserId", { userId }, () => mockStore.getProfileByUserId(userId));
}

function acceptCurrentAgreement() {
  return withMockFallback("acceptCurrentAgreement", {}, () => mockStore.acceptCurrentAgreement());
}

function sendProfileReminder(connectionId) {
  return withMockFallback(
    "sendProfileReminder",
    { connectionId },
    () => mockStore.sendProfileReminder(connectionId)
  );
}

module.exports = {
  getTagByToken,
  bindTagToCurrentUser,
  recordTagVisit,
  registerProfileReminderSubscription,
  upsertCurrentUserProfile,
  getCurrentProfile,
  getProfileByUserId,
  getMyConnections,
  acceptCurrentAgreement,
  sendProfileReminder,
};
