const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_APP_ID = "wx2bc83fb7b03cd3d1";
const DEFAULT_MODEL_ID = "aV0oB7AtGe81GVtGLp2Dkw";
const DEFAULT_PAGE_PATH = "pages/tag-entry/index";
const DEFAULT_ENV_VERSION = "release";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_TOKEN_LENGTH = 16;
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_RETRIES = 5;
const OUTPUT_FILES = {
  records: "内部主清单_请勿删除.json",
  databaseImport: "需要导入云数据库的文档.json",
  factoryLinks: "需要交给工厂的链接.txt",
  comparison: "内部核对表.csv",
  progress: "生成进度_请勿删除.json",
  failures: "生成失败记录.json",
  requestPreview: "接口请求预览.json",
};

function outputPath(outputDir, fileName) {
  return path.join(outputDir, fileName);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function readRecords(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function randomToken(length = DEFAULT_TOKEN_LENGTH) {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += TOKEN_ALPHABET[crypto.randomInt(TOKEN_ALPHABET.length)];
  }
  return token;
}

function createRunId() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${parts.join("")}_${randomToken(4)}`;
}

function createRecords(count, batch) {
  const tokens = new Set();
  const createdAt = new Date().toISOString();
  return Array.from({ length: count }, () => {
    let claimToken = randomToken();
    while (tokens.has(claimToken)) claimToken = randomToken();
    tokens.add(claimToken);

    const tagCode = `TAG_${claimToken}`;
    return {
      tagCode,
      nfcSn: tagCode,
      claimToken,
      ownerUserId: "",
      status: "unbound",
      batchNo: `BATCH_${batch}`,
      createdAt,
      boundAt: "",
      lastVisitedAt: "",
    };
  });
}

function databaseRecord(record) {
  return {
    tagCode: record.tagCode,
    claimToken: record.claimToken,
    ownerUserId: record.ownerUserId || "",
    status: record.status || "unbound",
    batchNo: record.batchNo || "",
    createdAt: record.createdAt || new Date().toISOString(),
    boundAt: record.boundAt || "",
    lastVisitedAt: record.lastVisitedAt || "",
  };
}

function validateRecords(records) {
  const tagCodes = new Set();
  const tokens = new Set();
  const serials = new Set();

  records.forEach((record, index) => {
    const tagCode = String(record.tagCode || "").trim();
    const claimToken = String(record.claimToken || "").trim().toUpperCase();
    const nfcSn = String(record.nfcSn || tagCode).trim();
    if (!tagCode || !claimToken || !nfcSn) {
      throw new Error(`第 ${index + 1} 条缺少 tagCode、claimToken 或 nfcSn`);
    }
    if (tagCodes.has(tagCode)) throw new Error(`tagCode 重复：${tagCode}`);
    if (tokens.has(claimToken)) throw new Error(`claimToken 重复：${claimToken}`);
    if (serials.has(nfcSn)) throw new Error(`nfcSn 重复：${nfcSn}`);
    tagCodes.add(tagCode);
    tokens.add(claimToken);
    serials.add(nfcSn);
  });
}

function writeSourceFiles(outputDir, records) {
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.records),
    `${JSON.stringify(records, null, 2)}\n`
  );
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.databaseImport),
    `${records.map((record) => JSON.stringify(databaseRecord(record))).join("\n")}\n`
  );
}

function loadOrCreateRecords({ inputPath, outputDir, count, batch }) {
  if (inputPath) {
    return readRecords(inputPath).map((record) => ({
      ...record,
      claimToken: String(record.claimToken || "").trim().toUpperCase(),
      nfcSn: record.nfcSn || record.tagCode,
    }));
  }

  const recordsPath = outputPath(outputDir, OUTPUT_FILES.records);
  if (fs.existsSync(recordsPath)) {
    const records = readRecords(recordsPath);
    if (records.length !== count) {
      throw new Error(`已有原始记录 ${records.length} 条，与本次 --count ${count} 不一致`);
    }
    return records;
  }

  return createRecords(count, batch);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new Error(`微信接口返回非 JSON：HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`微信接口 HTTP ${response.status}：${JSON.stringify(body)}`);
  }
  return body;
}

async function getAccessToken(appId, appSecret) {
  const body = await requestJson("https://api.weixin.qq.com/cgi-bin/stable_token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credential",
      appid: appId,
      secret: appSecret,
      force_refresh: false,
    }),
  });
  if (!body.access_token) {
    throw new Error(`获取 access_token 失败：${body.errcode || ""} ${body.errmsg || ""}`.trim());
  }
  return body.access_token;
}

async function generateScheme({ accessToken, modelId, pagePath, envVersion, record }) {
  const payload = {
    model_id: modelId,
    sn: String(record.nfcSn || record.tagCode),
    jump_wxa: {
      path: pagePath,
      query: `token=${record.claimToken}`,
      env_version: envVersion,
    },
  };
  const url = `https://api.weixin.qq.com/wxa/generatenfcscheme?access_token=${encodeURIComponent(accessToken)}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const body = await requestJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (body.openlink) return body.openlink;

    const retryable = [45009, 44990, -1].includes(body.errcode);
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`${body.errcode || "UNKNOWN"} ${body.errmsg || "生成 NFC Scheme 失败"}`);
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error("生成 NFC Scheme 失败");
}

function csvValue(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeSchemeOutputs(outputDir, rows) {
  const complete = rows.filter((row) => row.scheme);
  const failures = rows.filter((row) => row.error);
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.progress),
    `${JSON.stringify(rows, null, 2)}\n`
  );
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.comparison),
    `\uFEFF${[
      ["序号", "tagCode", "nfcSn", "token", "scheme"],
      ...complete.map((row, index) => [
        index + 1,
        row.tagCode,
        row.nfcSn,
        row.claimToken,
        row.scheme,
      ]),
    ]
      .map((row) => row.map(csvValue).join(","))
      .join("\n")}\n`
  );
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.factoryLinks),
    complete.map((row) => row.scheme).join("\n") + (complete.length ? "\n" : "")
  );
  fs.writeFileSync(
    outputPath(outputDir, OUTPUT_FILES.failures),
    `${JSON.stringify(failures, null, 2)}\n`
  );
}

async function runPool(items, concurrency, handler) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await handler(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = Number(args.count || 0);
  const runId = createRunId();
  const batch = String(args.batch || runId).trim();
  const inputPath = args.input ? path.resolve(args.input) : "";
  const defaultName = count ? `scripts/生成结果_${runId}_${count}张` : `scripts/生成结果_${runId}`;
  const outputDir = path.resolve(args.output || defaultName);
  const appId = process.env.WECHAT_APP_ID || DEFAULT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET || "";
  const suppliedToken = process.env.WECHAT_ACCESS_TOKEN || "";
  const modelId = args["model-id"] || DEFAULT_MODEL_ID;
  const pagePath = args.path || DEFAULT_PAGE_PATH;
  const envVersion = args.env || DEFAULT_ENV_VERSION;
  const concurrency = Math.max(1, Math.min(Number(args.concurrency || DEFAULT_CONCURRENCY), 50));

  if (!inputPath && (!Number.isInteger(count) || count < 1)) {
    throw new Error("新批次请提供正整数 --count，例如 --count 20");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const records = loadOrCreateRecords({ inputPath, outputDir, count, batch });
  validateRecords(records);
  if (!records.length) throw new Error("输入文件没有贴纸记录");
  writeSourceFiles(outputDir, records);

  const existingPath = outputPath(outputDir, OUTPUT_FILES.progress);
  const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, "utf8")) : [];
  const existingByTagCode = new Map(existing.filter((row) => row.scheme).map((row) => [row.tagCode, row]));
  const rows = records.map((record) => ({
    tagCode: record.tagCode,
    nfcSn: record.nfcSn || record.tagCode,
    claimToken: record.claimToken,
    modelId,
    scheme: "",
    error: "",
  }));

  rows.forEach((row) => {
    const saved = existingByTagCode.get(row.tagCode);
    if (
      saved &&
      saved.claimToken === row.claimToken &&
      saved.nfcSn === row.nfcSn &&
      saved.modelId === row.modelId
    ) {
      row.scheme = saved.scheme;
    }
  });

  const pending = rows.filter((row) => !row.scheme);
  if (args["dry-run"]) {
    const requestPreview = pending.map((row) => ({
      model_id: modelId,
      sn: row.nfcSn,
      jump_wxa: {
        path: pagePath,
        query: `token=${row.claimToken}`,
        env_version: envVersion,
      },
    }));
    fs.writeFileSync(
      outputPath(outputDir, OUTPUT_FILES.requestPreview),
      `${JSON.stringify(requestPreview, null, 2)}\n`
    );
    console.log(`预检通过：${rows.length} 条；输出目录：${outputDir}`);
    return;
  }

  if (!suppliedToken && !appSecret) {
    throw new Error("请通过 WECHAT_APP_SECRET 或 WECHAT_ACCESS_TOKEN 环境变量提供微信服务端凭证");
  }
  const accessToken = suppliedToken || (await getAccessToken(appId, appSecret));

  console.log(`待生成 ${pending.length} 条，已完成 ${rows.length - pending.length} 条，并发 ${concurrency}`);
  await runPool(pending, concurrency, async (row) => {
    try {
      row.scheme = await generateScheme({
        accessToken,
        modelId,
        pagePath,
        envVersion,
        record: row,
      });
      console.log(`OK ${row.tagCode} ${row.scheme}`);
    } catch (err) {
      row.error = err.message;
      console.error(`FAIL ${row.tagCode} ${row.error}`);
    } finally {
      writeSchemeOutputs(outputDir, rows);
    }
  });

  const failed = rows.filter((row) => row.error);
  console.log(`完成 ${rows.length - failed.length}/${rows.length}，失败 ${failed.length}`);
  console.log(`输出目录：${outputDir}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
