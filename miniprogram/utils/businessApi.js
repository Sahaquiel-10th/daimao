const config = require("../config/business");
const sharedCloud = require("./cloud");
const mockStore = require("./businessMockStore");

function call(action, data = {}) {
  if (config.apiMode === "mock") {
    return Promise.resolve(mockStore.call(action, data));
  }
  return sharedCloud
    .callFunction({
      name: "daimaoBusiness",
      data: { action, ...data },
    })
    .then((response) => response.result);
}

function ensureSuccess(result) {
  if (!result || !result.success) {
    const error = new Error((result && result.message) || "服务暂时不可用");
    error.code = result && result.code;
    throw error;
  }
  return result;
}

function request(action, data) {
  return call(action, data).then(ensureSuccess);
}

function uploadProjectFile(projectId, file) {
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  const cloudPath = `projects/${projectId}/records/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  return sharedCloud.uploadFile({ cloudPath, filePath: file.path }).then((result) => ({
    fileName: file.name,
    fileType: extension,
    fileSize: file.size,
    storageKey: result.fileID,
  }));
}

module.exports = {
  request,
  uploadProjectFile,
  config,
};
