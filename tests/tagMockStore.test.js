const assert = require("assert");

const storage = {};
global.wx = {
  getStorageSync(key) {
    return storage[key];
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
};

const store = require("../miniprogram/utils/tagMockStore");

function setProfile(profile) {
  wx.setStorageSync(store.STORAGE_KEYS.profile, profile);
}

function resetStorage() {
  Object.keys(storage).forEach((key) => delete storage[key]);
}

function run() {
  resetStorage();
  setProfile({
    id: "user-a",
    name: "用户A",
    job: "设计师",
    wechat: "user_a",
    avatar: "../../images/daimao/logo.png",
    intro: "喜欢认真做小东西。",
    answers: [],
    tags: ["设计"],
  });

  const unbound = store.getTagByToken("8F3K2P9XQ7");
  assert.equal(unbound.success, true);
  assert.equal(unbound.tag.status, "unbound");

  const bindA = store.bindTagToCurrentUser("8F3K2P9XQ7");
  assert.equal(bindA.success, true);
  assert.equal(bindA.tag.status, "bound");
  assert.equal(bindA.tag.ownerUserId, "user-a");

  setProfile({
    id: "user-b",
    name: "用户B",
    job: "产品经理",
    wechat: "user_b",
    avatar: "../../images/daimao/logo.png",
    intro: "喜欢把流程捋顺。",
    answers: [],
    tags: ["产品"],
  });

  const bindB = store.bindTagToCurrentUser("8F3K2P9XQ7");
  assert.equal(bindB.success, false);
  assert.equal(bindB.code, "TAG_ALREADY_BOUND");

  const bound = store.getTagByToken("BOUND2OWNER");
  assert.equal(bound.success, true);
  assert.equal(bound.tag.ownerUserId, "demo-owner");

  const visit = store.recordTagVisit({
    token: "BOUND2OWNER",
    visitorUserId: "user-b",
    source: "nfc",
  });
  assert.equal(visit.success, true);
  assert.equal(wx.getStorageSync(store.STORAGE_KEYS.history).length, 1);
  assert.equal(wx.getStorageSync(store.STORAGE_KEYS.history)[0].id, "demo-owner");
  const subscription = store.registerProfileReminderSubscription({ token: "BOUND2OWNER" });
  assert.equal(subscription.success, true);
  assert.equal(subscription.status, "available");

  const beforeAgreement = store.getMyConnections();
  assert.equal(beforeAgreement.code, "AGREEMENT_REQUIRED");
  assert.equal(store.acceptCurrentAgreement().success, true);
  wx.setStorageSync(store.STORAGE_KEYS.history, [
    ...wx.getStorageSync(store.STORAGE_KEYS.history),
    {
      id: "anonymous-visit-1",
      connectionId: "visit-1",
      anonymous: true,
      reminderStatus: "available",
    },
  ]);
  const connections = store.getMyConnections();
  assert.equal(connections.success, true);
  assert.equal(connections.connections.length, 2);
  assert.equal(store.sendProfileReminder("visit-1").success, true);
  assert.equal(store.sendProfileReminder("visit-1").code, "ALREADY_REMINDED");

  const missing = store.getTagByToken("NOTEXIST99");
  assert.equal(missing.success, false);
  assert.equal(missing.code, "TAG_NOT_FOUND");

  const frozen = store.getTagByToken("FROZEN0001");
  assert.equal(frozen.success, true);
  assert.equal(frozen.tag.status, "frozen");
  assert.equal(store.bindTagToCurrentUser("FROZEN0001").code, "TAG_FROZEN");

  setProfile({ id: "demo-owner", name: "小葵", job: "咖啡", wechat: "kui", intro: "hi", tags: [] });
  const ownerVisit = store.recordTagVisit({
    token: "BOUND2OWNER",
    visitorUserId: "demo-owner",
    source: "nfc",
  });
  assert.equal(ownerVisit.success, true);
  assert.equal(ownerVisit.skipped, true);

  resetStorage();
  setProfile({ id: "race-a", name: "A", job: "A", wechat: "a", intro: "A", tags: [] });
  const raceA = store.bindTagToCurrentUser("RACECLAIM1");
  setProfile({ id: "race-b", name: "B", job: "B", wechat: "b", intro: "B", tags: [] });
  const raceB = store.bindTagToCurrentUser("RACECLAIM1");
  assert.equal(raceA.success, true);
  assert.equal(raceB.success, false);
  assert.equal(raceB.code, "TAG_ALREADY_BOUND");

  console.log("tag mock tests passed");
}

run();
