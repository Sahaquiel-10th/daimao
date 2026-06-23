const tagApi = require("../../utils/tagApi");
const assets = require("../../utils/assets");
const mockStore = require("../../utils/tagMockStore");

const CARD_STORAGE_KEY = "daimao_pending_card_profile";
const PROFILE_STORAGE_KEY = "daimao_profile";
const PENDING_BIND_TOKEN_KEY = "daimao_pending_bind_token";
const PENDING_VISIT_CONTEXT_KEY = "daimao_pending_visit_context";
const AGREEMENT_ACCEPTED_KEY = "daimao_agreement_accepted";
const AGREEMENT_VERSION = "2026-06-13-v2";

function decodeScene(scene) {
  if (!scene) return "";
  const decoded = decodeURIComponent(scene);
  if (decoded.indexOf("=") >= 0) {
    const pairs = decoded.split("&");
    const tokenPair = pairs.find((item) => item.indexOf("token=") === 0 || item.indexOf("t=") === 0);
    return tokenPair ? tokenPair.split("=")[1] : decoded;
  }
  return decoded;
}

Page({
  data: {
    token: "",
    status: "loading",
    title: "正在识别这张贴纸...",
    message: "",
    tag: null,
    ownerProfile: null,
    currentUserId: "",
    currentUserHasProfile: false,
    isOwner: false,
    entryCatSrc: "",
    agreementAccepted: false,
  },

  onLoad(options) {
    this.resolveCloudAssets();
    this.setData({ agreementAccepted: wx.getStorageSync(AGREEMENT_ACCEPTED_KEY) === AGREEMENT_VERSION });

    const token = options.token || decodeScene(options.scene);
    if (!token) {
      this.setError("呆猫闻了闻，没找到这张贴纸的气味。");
      return;
    }
    this.setData({ token });
    this.loadTag(token);
  },

  resolveCloudAssets() {
    assets
      .resolveAssets(["catTapSuccess"])
      .then((map) => {
        this.setData({ entryCatSrc: map.catTapSuccess || "" });
      })
      .catch((err) => {
        console.error("resolve entry assets failed", err);
      });
  },

  onShareAppMessage() {
    return {
      title: "碰一碰交换OPC名片，你也是同路人吗",
      path: `/pages/tag-entry/index?token=${this.data.token || ""}`,
    };
  },

  loadTag(token) {
    this.setData({
      status: "loading",
      title: "正在识别这张贴纸...",
      message: "",
    });

    tagApi
      .getTagByToken(token)
      .then((result) => {
        if ((!result || !result.success) && this.shouldUsePreviewMock(token, result && result.code)) {
          result = mockStore.getTagByToken(token);
        }
        if (!result || !result.success) {
          this.setError(this.friendlyError(result && result.code));
          return;
        }

        const tag = result.tag;
        const currentUserId = result.currentUserId || this.getLocalUserId();
        const currentUserHasProfile = !!result.currentUserHasProfile;
        const ownerProfile = result.ownerProfile || tag.ownerProfile || null;

        if (!tag || tag.status === "frozen") {
          this.setError("这张贴纸暂时睡着了，先不要用它打开名片。");
          return;
        }

        if (tag.status === "unbound") {
          this.setData({
            status: "unbound",
            title: "这张小贴纸还没有主人。",
            message: "把它收进你的猫窝后，别人碰一下就能看到你的介绍卡。",
            tag,
            currentUserId,
            currentUserHasProfile,
          });
          return;
        }

        if (tag.status === "bound") {
          const isOwner = !!currentUserId && currentUserId === tag.ownerUserId;
          if (!ownerProfile) {
            this.setError("这张贴纸已经绑定，但主人名片还没保存成功。请让对方先保存名片。");
            return;
          }
          this.setData({
            status: "redirecting",
            title: isOwner ? "这张贴纸认得你，正在打开你的名片。" : "贴纸响了一下，正在打开对方的名片。",
            message: "",
            tag,
            ownerProfile,
            currentUserId,
            currentUserHasProfile,
            isOwner,
          });
          this.openBoundTag(tag, ownerProfile, isOwner);
          return;
        }

        this.setError("这张小纸条有点陌生，呆猫还没在窝里见过它。");
      })
      .catch((err) => {
        console.error("load tag failed", err);
        this.setError(`云端识别失败：${this.formatCloudError(err)}`);
      });
  },

  bindToMe() {
    if (!this.requireAgreementAccepted()) return;

    const profile = wx.getStorageSync(PROFILE_STORAGE_KEY);
    if (!profile || !profile.id || String(profile.id).indexOf("local-") === 0) {
      wx.showModal({
        title: "先创建你的名片",
        content: "呆猫还不知道你是谁。先保存一张自己的云端名片，再回来认领这张贴纸。",
        confirmText: "去填写",
        cancelText: "取消",
        success: (res) => {
          if (res.confirm) {
            wx.setStorageSync(PENDING_BIND_TOKEN_KEY, this.data.token);
            wx.redirectTo({ url: "/pages/index/index" });
          }
        },
      });
      return;
    }

    wx.showModal({
      title: "确认认领这张贴纸？",
      content: "认领后，这张贴纸会绑定到你当前微信下的呆猫名片。你可以继续认领更多贴纸。",
      confirmText: "确认认领",
      cancelText: "再想想",
      success: (res) => {
        if (!res.confirm) return;
        this.doBindTag();
      },
    });
  },

  doBindTag() {
    if (!this.requireAgreementAccepted()) return;

    this.setData({ status: "binding", title: "呆猫正在把贴纸叼回你的猫窝..." });
    tagApi
      .acceptCurrentAgreement()
      .then(() => tagApi.bindTagToCurrentUser(this.data.token))
      .then((result) => {
        if (!result || !result.success) {
          this.setError(this.friendlyError(result && result.code));
          return;
        }

        const localProfile = wx.getStorageSync(PROFILE_STORAGE_KEY);
        const ownerProfile = {
          ...(result.ownerProfile || localProfile),
          stickerCode: result.tag && result.tag.tagCode ? result.tag.tagCode : localProfile.stickerCode,
          agreementVersion: AGREEMENT_VERSION,
        };
        wx.setStorageSync(PROFILE_STORAGE_KEY, ownerProfile);
        wx.setStorageSync(CARD_STORAGE_KEY, ownerProfile);
        this.setData({
          status: "boundSuccess",
          title: "认领成功！这张贴纸现在会替你递名片了。",
          message: "",
          tag: result.tag,
          ownerProfile,
          isOwner: true,
        });
      })
      .catch((err) => {
        console.error("bind tag failed", err);
        this.setError(`云端认领失败：${this.formatCloudError(err)}`);
      });
  },

  openMyCard() {
    const profile = this.data.ownerProfile || wx.getStorageSync(PROFILE_STORAGE_KEY);
    if (profile) wx.setStorageSync(CARD_STORAGE_KEY, profile);
    wx.redirectTo({ url: "/pages/index/index?card=mine" });
  },

  openBoundTag(tag, ownerProfile, isOwner) {
    if (ownerProfile) {
      wx.setStorageSync(CARD_STORAGE_KEY, ownerProfile);
    }

    const visitorUserId = this.getLocalUserId();
    if (!isOwner) {
      wx.setStorageSync(PENDING_VISIT_CONTEXT_KEY, {
        token: this.data.token,
        ownerUserId: tag.ownerUserId,
        currentUserHasProfile: this.data.currentUserHasProfile,
      });
    }
    tagApi
      .recordTagVisit({
        token: this.data.token,
        ownerUserId: tag.ownerUserId,
        visitorUserId,
        source: "nfc",
      })
      .finally(() => {
        const target = isOwner ? "/pages/index/index?card=mine" : "/pages/index/index?card=tag";
        wx.redirectTo({ url: target });
      });
  },

  retry() {
    this.loadTag(this.data.token);
  },

  setError(message) {
    this.setData({
      status: "error",
      title: "呆猫没有认出这张贴纸。",
      message,
    });
  },

  friendlyError(code) {
    const messages = {
      TAG_NOT_FOUND: "可能是贴纸还没登记，也可能是这张小纸条走错门了。",
      TAG_FROZEN: "这张贴纸暂时睡着了，先不要用它打开名片。",
      TAG_ALREADY_BOUND: "这张贴纸已经有主人啦，不能再抢回窝里。",
      LOGIN_REQUIRED: "先做一张自己的名片，呆猫才知道要把贴纸交给谁。",
    };
    return messages[code] || "呆猫刚刚打了个盹，没识别成功。再试一次看看。";
  },

  shouldUsePreviewMock(token, code) {
    const previewTokens = ["BOUND2OWNER", "8F3K2P9XQ7", "FROZEN0001", "RACECLAIM1"];
    return code === "TAG_NOT_FOUND" && previewTokens.indexOf(token) >= 0;
  },

  toggleAgreement() {
    const agreementAccepted = !this.data.agreementAccepted;
    wx.setStorageSync(AGREEMENT_ACCEPTED_KEY, agreementAccepted ? AGREEMENT_VERSION : "");
    this.setData({ agreementAccepted });
  },

  openAgreement(e) {
    const type = e.currentTarget.dataset.type;
    const url = type === "privacy" ? "/pages/agreement/privacy-policy" : "/pages/agreement/user-service";
    wx.navigateTo({ url });
  },

  requireAgreementAccepted() {
    if (this.data.agreementAccepted) return true;
    wx.showToast({ title: "请先阅读并同意用户服务协议和隐私政策", icon: "none" });
    return false;
  },

  formatCloudError(err) {
    const message = err && (err.errMsg || err.message) ? err.errMsg || err.message : "请检查云函数是否部署到当前环境";
    return String(message).slice(0, 42);
  },

  getLocalUserId() {
    const profile = wx.getStorageSync(PROFILE_STORAGE_KEY);
    return profile && profile.id ? profile.id : "";
  },
});
