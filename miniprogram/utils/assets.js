const { remoteAssets } = require("../config/assets");
const sharedCloud = require("./cloud");

function getAsset(key) {
  return remoteAssets[key] || "";
}

function getPosterAsset(key) {
  return remoteAssets[key] || "";
}

function isCloudFile(path) {
  return typeof path === "string" && path.indexOf("cloud://") === 0;
}

function getCloudTempFileURL(fileID) {
  if (!isCloudFile(fileID)) {
    return Promise.resolve(fileID);
  }

  return getAssetTempUrls([fileID])
    .then((res) => {
      const file = res.files && res.files[0];
      return file && file.tempFileURL ? file.tempFileURL : fileID;
    })
    .catch(() => fileID);
}

function resolveCloudTempFileURL(fileID) {
  if (!isCloudFile(fileID)) return Promise.resolve(fileID);

  return getAssetTempUrls([fileID]).then((res) => {
    const file = res.files && res.files[0];
    if (!file || !file.tempFileURL) {
      const status = file && (file.status || file.errMsg) ? file.status || file.errMsg : "no tempFileURL";
      throw new Error(`cloud asset unavailable: ${status} ${fileID}`);
    }
    return file.tempFileURL;
  });
}

function getAssetTempUrls(fileIDs) {
  return sharedCloud
    .callFunction({
      name: "daimaoTagFunctions",
      data: {
        action: "getAssetTempUrls",
        fileIDs,
      },
    })
    .then((resp) => resp.result || {})
    .then((result) => {
      if (!result.files || !result.files.length) {
        throw new Error(`get asset temp urls failed: ${result.message || result.code || "empty files"}`);
      }
      return result;
    });
}

function resolveAssets(keys) {
  const pairs = keys.map((key) => ({
    key,
    fileID: getAsset(key),
  }));
  const fileIDs = pairs.map((item) => item.fileID).filter(Boolean);

  return getAssetTempUrls(fileIDs).then((result) => {
    if (result.failed && result.failed.length) {
      console.error("resolve cloud assets partial failed", result.failed);
    }
    const urlByFileID = (result.files || []).reduce((map, file) => {
      map[file.fileID] = file.tempFileURL;
      return map;
    }, {});
    return pairs.reduce((map, item) => {
      map[item.key] = urlByFileID[item.fileID] || "";
      return map;
    }, {});
  });
}

function resolveAssetsIndividually(keys) {
  return Promise.all(
    keys.map((key) =>
      resolveCloudTempFileURL(getAsset(key))
        .then((url) => ({
        key,
        url,
        }))
        .catch((err) => {
          console.error("resolve cloud asset failed", { key, fileID: getAsset(key), err });
          return { key, url: "" };
        })
    )
  ).then((items) =>
    items.reduce((map, item) => {
      map[item.key] = item.url;
      return map;
    }, {})
  );
}

module.exports = {
  getAsset,
  getPosterAsset,
  getCloudTempFileURL,
  resolveCloudTempFileURL,
  resolveAssets,
  resolveAssetsIndividually,
  isCloudFile,
};
