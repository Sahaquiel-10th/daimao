const api = require("../../utils/businessApi");
const secretaryBubble = require("../../utils/secretaryBubble");

Page({
  data: {
    projectId: "",
    loading: true,
    project: null,
    updates: [],
    showApplyForm: false,
    application: { message: "", canOffer: "", relatedExperience: "" },
    submitting: false,
    secretaryBubble: secretaryBubble.defaultState(),
  },

  onLoad(options) {
    this.setData({ projectId: options.id || "" });
    this.loadProject();
    secretaryBubble.start(this);
  },

  onShow() {
    secretaryBubble.start(this);
    if (this.data.projectId && !this.data.loading) this.loadProject();
  },

  onUnload() {
    secretaryBubble.stop(this);
  },

  loadProject() {
    this.setData({ loading: true });
    return api
      .request("getProject", { projectId: this.data.projectId })
      .then((result) => {
        const project = {
          ...result.project,
          tags: Array.isArray(result.project.tags) ? result.project.tags : [],
          can_apply: !!result.project.can_apply,
          is_watching: !!Number(result.project.is_watching),
          is_member: !!Number(result.project.is_member) || result.project.my_role === "creator",
        };
        this.setData({ project, updates: result.updates || [] });
        wx.setNavigationBarTitle({ title: project.name || "项目详情" });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ loading: false }));
  },

  toggleWatch() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api
      .request("toggleWatch", { projectId: this.data.projectId })
      .then((result) => {
        this.setData({
          "project.is_watching": result.watching,
          "project.star_count": result.starCount,
          "project.watch_count": result.watchCount,
        });
        wx.showToast({ title: result.watching ? "已围观" : "已取消围观", icon: "none" });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },

  openApplyForm() {
    if (this.data.project && !this.data.project.can_apply) {
      wx.showModal({
        title: "需要社区认证",
        content: "你现在可以围观和点星星。通过任一社区认证后，就能让小秘书先审核资料，再把申请递交给主理人。",
        showCancel: false,
        confirmText: "知道了",
      });
      return;
    }
    this.setData({ showApplyForm: true });
  },

  closeApplyForm() {
    this.setData({ showApplyForm: false });
  },

  onApplicationInput(e) {
    this.setData({ [`application.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  submitApplication() {
    const application = this.data.application;
    if (!application.message.trim() || !application.canOffer.trim()) {
      wx.showToast({ title: "请填写想参与什么和你能提供什么", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .request("applyProject", { projectId: this.data.projectId, request: application })
      .then((result) => {
        this.setData({ showApplyForm: false, application: { message: "", canOffer: "", relatedExperience: "" } });
        wx.showToast({
          title: result.queued ? "已提交，站内信通知结果" : "申请已提交",
          icon: "none",
          duration: 2200,
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },

  openSpace() {
    wx.navigateTo({ url: `/pages/project-space/index?id=${this.data.projectId}` });
  },

  openSecretary() {
    secretaryBubble.open(this, `/pages/project-detail/index?id=${this.data.projectId}`);
  },

  noop() {
    return false;
  },
});
