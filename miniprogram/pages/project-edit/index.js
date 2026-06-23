const api = require("../../utils/businessApi");

Page({
  data: {
    project: {
      name: "",
      description: "",
      projectType: "other",
      tagsText: "",
      stage: "",
      goal: "",
      idealParticipant: "",
      notFitParticipant: "",
      requiredCapabilitiesText: "",
      participationRolesText: "",
      visibility: "private",
      status: "draft",
    },
    typeIndex: 0,
    types: [
      { label: "其他", value: "other" },
      { label: "社区 / 活动", value: "community" },
      { label: "AI 产品", value: "ai_product" },
      { label: "独立开发", value: "indie_hacker" },
      { label: "内容 / 品牌", value: "content_brand" },
    ],
    submitting: false,
  },

  onInput(e) {
    this.setData({ [`project.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onTypeChange(e) {
    const typeIndex = Number(e.detail.value);
    this.setData({ typeIndex, "project.projectType": this.data.types[typeIndex].value });
  },

  onVisibilityChange(e) {
    const isPublic = e.detail.value;
    this.setData({
      "project.visibility": isPublic ? "public" : "private",
      "project.status": isPublic ? "active" : "draft",
    });
  },

  submit() {
    const project = this.data.project;
    if (!project.name.trim() || !project.description.trim()) {
      wx.showToast({ title: "请填写项目名称和介绍", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    api
      .request("createProject", { project })
      .then((result) => {
        wx.showToast({ title: "项目已创建", icon: "success" });
        setTimeout(() => wx.redirectTo({ url: `/pages/project-detail/index?id=${result.projectId}` }), 500);
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },
});
