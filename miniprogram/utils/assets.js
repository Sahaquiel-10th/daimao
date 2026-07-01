const { remoteAssets } = require("../config/assets");
const sharedCloud = require("./cloud");

const TEMP_URL_CACHE_KEY = "daimao_asset_temp_url_cache";
const TEMP_URL_TTL_MS = 12 * 60 * 60 * 1000;

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

  const cached = getCachedTempUrl(fileID);
  if (cached) return Promise.resolve(cached);

  return getAssetTempUrls([fileID])
    .then((res) => {
      const file = res.files && res.files[0];
      if (file && file.tempFileURL) {
        setCachedTempUrls([{ fileID, tempFileURL: file.tempFileURL }]);
        return file.tempFileURL;
      }
      return fileID;
    })
    .catch(() => fileID);
}

function resolveCloudTempFileURL(fileID) {
  if (!isCloudFile(fileID)) return Promise.resolve(fileID);

  const cached = getCachedTempUrl(fileID);
  if (cached) return Promise.resolve(cached);

  return getAssetTempUrls([fileID]).then((res) => {
    const file = res.files && res.files[0];
    if (!file || !file.tempFileURL) {
      const status = file && (file.status || file.errMsg) ? file.status || file.errMsg : "no tempFileURL";
      throw new Error(`cloud asset unavailable: ${status} ${fileID}`);
    }
    setCachedTempUrls([{ fileID, tempFileURL: file.tempFileURL }]);
    return file.tempFileURL;
  });
}

function getAssetTempUrls(fileIDs) {
  const uniqueFileIDs = Array.from(new Set(fileIDs.filter(Boolean)));
  const cachedFiles = [];
  const missingFileIDs = [];
  uniqueFileIDs.forEach((fileID) => {
    const cached = getCachedTempUrl(fileID);
    if (cached) {
      cachedFiles.push({ fileID, tempFileURL: cached, status: 0, cached: true });
    } else {
      missingFileIDs.push(fileID);
    }
  });
  if (!missingFileIDs.length) {
    return Promise.resolve({ success: true, files: cachedFiles, failed: [] });
  }

  return sharedCloud
    .callFunction({
      name: "daimaoTagFunctions",
      data: {
        action: "getAssetTempUrls",
        fileIDs: missingFileIDs,
      },
    })
    .then((resp) => resp.result || {})
    .then((result) => {
      if (!result.files || !result.files.length) {
        throw new Error(`get asset temp urls failed: ${result.message || result.code || "empty files"}`);
      }
      setCachedTempUrls(result.files || []);
      result.files = [...cachedFiles, ...(result.files || [])];
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

function readTempUrlCache() {
  try {
    const cache = wx.getStorageSync(TEMP_URL_CACHE_KEY);
    return cache && typeof cache === "object" ? cache : {};
  } catch (err) {
    return {};
  }
}

function writeTempUrlCache(cache) {
  try {
    wx.setStorageSync(TEMP_URL_CACHE_KEY, cache);
  } catch (err) {
    // Cache failure should never block page rendering.
  }
}

function getCachedTempUrl(fileID) {
  const cache = readTempUrlCache();
  const item = cache[fileID];
  if (!item || !item.url || !item.expiresAt || item.expiresAt <= Date.now()) return "";
  return item.url;
}

function setCachedTempUrls(files) {
  const cache = readTempUrlCache();
  let changed = false;
  (files || []).forEach((file) => {
    if (!file || !file.fileID || !file.tempFileURL) return;
    cache[file.fileID] = {
      url: file.tempFileURL,
      expiresAt: Date.now() + TEMP_URL_TTL_MS,
    };
    changed = true;
  });
  if (changed) writeTempUrlCache(cache);
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
