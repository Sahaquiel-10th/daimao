const api = require("../../utils/businessApi");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    projectId: "",
    loading: true,
    activeTab: "progress",
    project: null,
    members: [],
    updates: [],
    records: [],
    reminderIntents: [],
    projectEvents: [],
    inviteCandidates: [],
    showUpdateForm: false,
    showRecordForm: false,
    editingUpdateId: "",
    updateForm: { title: "", content: "", visibility: "project_members", updateType: "progress" },
    recordForm: { title: "", rawText: "", recordType: "meeting_note", visibility: "project_members" },
    selectedFile: null,
    submitting: false,
    analyzingId: "",
  },

  onLoad(options) {
    this.setData({ projectId: options.id || "" });
    this.loadSpace();
  },

  onPullDownRefresh() {
    this.loadSpace().finally(() => wx.stopPullDownRefresh());
  },

  loadSpace() {
    this.setData({ loading: true });
    return api
      .request("getProjectSpace", { projectId: this.data.projectId })
      .then((result) => {
        this.setData({
          project: result.project,
          members: (result.members || []).map((item) => ({
            ...item,
            avatarText: String(item.display_name || "?").slice(0, 1),
          })),
          updates: (result.updates || []).map((item) => ({ ...item, dateLabel: formatDate(item.created_at) })),
          records: (result.records || []).map((item) => ({ ...item, dateLabel: formatDate(item.created_at) })),
          reminderIntents: (result.reminderIntents || []).map((item) => ({
            ...item,
            timeLabel: item.normalized_time ? formatDate(item.normalized_time) : item.time_text,
          })),
          projectEvents: (result.projectEvents || []).map((item) => ({ ...item, dateLabel: formatDate(item.start_time) })),
          inviteCandidates: result.inviteCandidates || [],
        });
        wx.setNavigationBarTitle({ title: result.project.name || "协作空间" });
      })
      .catch((err) => {
        wx.showModal({
          title: "暂时不能进入",
          content: err.message,
          showCancel: false,
          success: () => wx.navigateBack(),
        });
      })
      .finally(() => this.setData({ loading: false }));
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  toggleUpdateForm() {
    if (this.data.showUpdateForm) {
      this.cancelEditUpdate();
      return;
    }
    this.setData({ showUpdateForm: true });
  },

  toggleRecordForm() {
    this.setData({ showRecordForm: !this.data.showRecordForm });
  },

  onUpdateInput(e) {
    this.setData({ [`updateForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  onRecordInput(e) {
    this.setData({ [`recordForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  setUpdateVisibility(e) {
    this.setData({ "updateForm.visibility": e.currentTarget.dataset.value });
  },

  editUpdate(e) {
    const updateId = e.currentTarget.dataset.id;
    const update = this.data.updates.find((item) => Number(item.id) === Number(updateId));
    if (!update) return;
    this.setData({
      editingUpdateId: updateId,
      showUpdateForm: true,
      updateForm: {
        title: update.title || "",
        content: update.content || "",
        visibility: update.visibility === "public" ? "public" : "project_members",
        updateType: update.update_type || "progress",
      },
    });
  },

  cancelEditUpdate() {
    this.setData({
      showUpdateForm: false,
      editingUpdateId: "",
      updateForm: { title: "", content: "", visibility: "project_members", updateType: "progress" },
    });
  },

  publishUpdate() {
    const update = this.data.updateForm;
    if (!update.title.trim() || !update.content.trim()) {
      wx.showToast({ title: "请填写进度标题和内容", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    const action = this.data.editingUpdateId ? "updateProjectUpdate" : "publishUpdate";
    const payload = this.data.editingUpdateId
      ? { projectId: this.data.projectId, updateId: this.data.editingUpdateId, update }
      : { projectId: this.data.projectId, update };
    api
      .request(action, payload)
      .then(() => {
        wx.showToast({ title: this.data.editingUpdateId ? "进度已更新" : update.visibility === "public" ? "公开进度已发布" : "项目内进度已发布", icon: "success" });
        this.cancelEditUpdate();
        this.loadSpace();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: api.config.allowedUploadExtensions,
      success: (result) => {
        const file = result.tempFiles[0];
        if (file.size > api.config.maxUploadBytes) {
          wx.showToast({ title: "文件不能超过 10MB", icon: "none" });
          return;
        }
        this.setData({ selectedFile: file });
      },
    });
  },

  clearFile() {
    this.setData({ selectedFile: null });
  },

  submitRecord() {
    const form = this.data.recordForm;
    if (!form.title.trim() || (!form.rawText.trim() && !this.data.selectedFile)) {
      wx.showToast({ title: "请填写标题，并粘贴文字或上传文件", icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认有权上传",
      content:
        "上传后，系统会分析项目记录，用于生成会议纪要、待办、提醒、项目成员画像和后续项目推荐。请确保你有权上传该内容，并已获得相关参与人的同意。",
      confirmText: "确认上传",
      success: (res) => {
        if (res.confirm) this.doSubmitRecord();
      },
    });
  },

  doSubmitRecord() {
    this.setData({ submitting: true });
    let filePromise = Promise.resolve(null);
    if (this.data.selectedFile) {
      if (api.config.apiMode === "mock") {
        const extension = String(this.data.selectedFile.name || "").split(".").pop().toLowerCase();
        if (extension === "txt" || extension === "md") {
          filePromise = new Promise((resolve, reject) => {
            wx.getFileSystemManager().readFile({
              filePath: this.data.selectedFile.path,
              encoding: "utf8",
              success: (result) => resolve({ localText: result.data }),
              fail: reject,
            });
          });
        } else {
          wx.showToast({ title: "docx/pdf 提取需切换云端模式", icon: "none" });
          this.setData({ submitting: false });
          return;
        }
      } else {
        filePromise = api.uploadProjectFile(this.data.projectId, this.data.selectedFile);
      }
    }
    filePromise
      .then((file) => {
        const record = {
          ...this.data.recordForm,
          rawText: file && file.localText ? file.localText : this.data.recordForm.rawText,
          file: file && !file.localText ? file : null,
        };
        return api.request("createProjectRecord", { projectId: this.data.projectId, record });
      })
      .then((result) => {
        wx.showToast({ title: "记录已保存", icon: "success" });
        this.setData({
          showRecordForm: false,
          recordForm: { title: "", rawText: "", recordType: "meeting_note", visibility: "project_members" },
          selectedFile: null,
        });
        this.loadSpace();
        return result;
      })
      .catch((err) => wx.showToast({ title: err.message || "上传失败", icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },

  analyzeRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    this.setData({ analyzingId: recordId });
    api
      .request("analyzeProjectRecord", { recordId })
      .then((result) => {
        wx.showModal({
          title: "AI 草稿已生成",
          content: result.output.summary || "已生成项目摘要和提醒草稿，请确认后再生效。",
          showCancel: false,
          success: () => this.loadSpace(),
        });
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ analyzingId: "" }));
  },

  confirmIntent(e) {
    const intentId = e.currentTarget.dataset.id;
    const intent = this.data.reminderIntents.find((item) => Number(item.id) === Number(intentId));
    if (!intent || !intent.normalized_time) {
      wx.showToast({ title: "时间不明确，请后端或管理员补充后再确认", icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认创建项目日程？",
      content: `${intent.title}\n${intent.timeLabel}\n\n确认后项目成员都能看到，但每个人仍需自行授权微信提醒。`,
      success: (res) => {
        if (!res.confirm) return;
        api
          .request("confirmReminderIntent", {
            intentId,
            intent: { title: intent.title, normalizedTime: intent.normalized_time },
          })
          .then(() => {
            wx.showToast({ title: "日程已创建", icon: "success" });
            this.loadSpace();
          })
          .catch((err) => wx.showToast({ title: err.message, icon: "none" }));
      },
    });
  },

  authorizeReminder(e) {
    const eventId = e.currentTarget.dataset.id;
    if (api.config.apiMode === "mock") {
      api.request("authorizeReminder", { eventId }).then(() => wx.showToast({ title: "已模拟授权一次", icon: "none" }));
      return;
    }
    const templateId = api.config.projectReminderTemplateId;
    if (!templateId) {
      wx.showToast({ title: "订阅消息模板尚未配置", icon: "none" });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        if (!String(result[templateId] || "").startsWith("accept")) {
          wx.showToast({ title: "未授权，不影响站内提醒", icon: "none" });
          return;
        }
        api
          .request("authorizeReminder", { eventId })
          .then(() => wx.showToast({ title: "已授权本次提醒", icon: "success" }))
          .catch((err) => wx.showToast({ title: err.message, icon: "none" }));
      },
    });
  },

  inviteCandidate(e) {
    const userId = e.currentTarget.dataset.id;
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    api
      .request("inviteMember", { projectId: this.data.projectId, userId, role: "member" })
      .then(() => {
        wx.showToast({ title: "入局邀请已发送", icon: "success" });
        this.loadSpace();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },
});
