const api = require("../../utils/businessApi");
const assets = require("../../utils/assets");

function toText(value) {
  return Array.isArray(value) ? value.join("、") : "";
}

function toList(value) {
  return String(value || "")
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

Page({
  data: {
    loading: true,
    saving: false,
    form: {
      publicIntro: "",
      currentRole: "",
      currentGoalsText: "",
      canOfferText: "",
      lookingForText: "",
      notInterestedInText: "",
      preferredProjectTypesText: "",
      collaborationStyle: "",
      allowMatchmaking: true,
      allowAiProfile: true,
    },
    memories: [],
    icons: {
      watch: assets.getAsset("search"),
      innings: assets.getAsset("puzzle"),
      friends: assets.getAsset("friends"),
      me: assets.getAsset("projectTask"),
    },
  },

  onLoad() {
    this.loadProfile();
  },

  loadProfile() {
    this.setData({ loading: true });
    api
      .request("getAgentProfile")
      .then((result) => {
        const profile = result.profile || {};
        this.setData({
          form: {
            publicIntro: profile.public_intro || "",
            currentRole: profile.current_role || "",
            currentGoalsText: toText(profile.current_goals_json),
            canOfferText: toText(profile.can_offer_json),
            lookingForText: toText(profile.looking_for_json),
            notInterestedInText: toText(profile.not_interested_in_json),
            preferredProjectTypesText: toText(profile.preferred_project_types_json),
            collaborationStyle: profile.collaboration_style || "",
            allowMatchmaking: profile.allow_matchmaking !== 0,
            allowAiProfile: profile.allow_ai_profile !== 0,
          },
          memories: result.memories || [],
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onSwitch(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  save() {
    const form = this.data.form;
    this.setData({ saving: true });
    api
      .request("saveAgentProfile", {
        profile: {
          publicIntro: form.publicIntro,
          currentRole: form.currentRole,
          currentGoals: toList(form.currentGoalsText),
          canOffer: toList(form.canOfferText),
          lookingFor: toList(form.lookingForText),
          notInterestedIn: toList(form.notInterestedInText),
          preferredProjectTypes: toList(form.preferredProjectTypesText),
          collaborationStyle: form.collaborationStyle,
          allowMatchmaking: form.allowMatchmaking,
          allowAiProfile: form.allowAiProfile,
        },
      })
      .then(() => wx.showToast({ title: "秘书资料已保存", icon: "success" }))
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ saving: false }));
  },

  openCard() {
    wx.navigateTo({ url: "/pages/index/index" });
  },

  goNav(e) {
    const routes = {
      watch: "/pages/discover/index",
      innings: "/pages/innings/index",
      friends: "/pages/index/index?tab=history",
    };
    wx.redirectTo({ url: routes[e.currentTarget.dataset.target] });
  },
});
