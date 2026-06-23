module.exports = {
  // Use "cloud" to read the shared CloudBase SQL database. Switch to "mock" only for emergency local fallback.
  apiMode: "cloud",
  projectReminderTemplateId: "",
  maxUploadBytes: 10 * 1024 * 1024,
  allowedUploadExtensions: ["txt", "md", "docx", "pdf"],
  vectorSearchEnabled: false,
  secretaryReviewMode: "mock",
};
