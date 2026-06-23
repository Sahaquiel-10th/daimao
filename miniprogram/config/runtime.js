module.exports = {
  // Use "mock" while tuning UI locally. Use "cloud" for real NFC binding tests and release builds.
  apiMode: "cloud",
  // Profile data is now backed by CloudBase SQL, so DevTools should exercise the same write path.
  allowCloudWritesInDevelop: true,
};
