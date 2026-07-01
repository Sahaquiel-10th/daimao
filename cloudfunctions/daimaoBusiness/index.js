const cloud = require("wx-server-sdk");
const mysql = require("mysql2/promise");
const cloudbase = require("@cloudbase/node-sdk");
const https = require("https");
const crypto = require("crypto");
const Ajv = require("ajv");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const aiOutputSchema = require("./ai-schema");
const defaultPrompts = require("./prompts");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TIMEZONE = "Asia/Shanghai";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["txt", "md", "docx", "pdf"]);
const REMINDER_TEMPLATE_ID = process.env.WECHAT_PROJECT_REMINDER_TEMPLATE_ID || "";
const VECTOR_SEARCH_URL = process.env.VECTOR_SEARCH_URL || "";
const VECTOR_UPSERT_URL = process.env.VECTOR_UPSERT_URL || "";
const VECTOR_SEARCH_API_KEY = process.env.VECTOR_SEARCH_API_KEY || "";
const VECTOR_UPSERT_API_KEY = process.env.VECTOR_UPSERT_API_KEY || VECTOR_SEARCH_API_KEY;
const VECTOR_PROVIDER = (process.env.VECTOR_PROVIDER || "http_adapter").toLowerCase();
const VECTOR_COLLECTION = process.env.VECTOR_COLLECTION || "daimao_rag_chunks";
const VECTOR_NAMESPACE = process.env.VECTOR_NAMESPACE || "default";
const REAI_VDB_BASE_URL = process.env.REAI_VDB_BASE_URL || "https://api.cn.reai.com";
const REAI_VDB_PID = process.env.REAI_VDB_PID || "";
const REAI_VDB_ID = process.env.REAI_VDB_ID || "";
const REAI_API_KEY = process.env.REAI_API_KEY || VECTOR_SEARCH_API_KEY;
const REAI_VDB_UPSERT_URL = process.env.REAI_VDB_UPSERT_URL || "";
const REAI_USER_TAG_PREFIX = process.env.REAI_USER_TAG_PREFIX || "daimao_user_";
const SECRETARY_PROJECT_REVIEW_PROMPT = process.env.SECRETARY_PROJECT_REVIEW_PROMPT || defaultPrompts.PROJECT_REVIEW_PROMPT;
const SECRETARY_RETRIEVAL_PROMPT = process.env.SECRETARY_RETRIEVAL_PROMPT || defaultPrompts.RETRIEVAL_PROMPT;
const VECTOR_TOP_K = Math.min(Math.max(Number(process.env.VECTOR_TOP_K || 4), 1), 10);
const RAG_RETRIEVAL_QUERY_COUNT = Math.min(Math.max(Number(process.env.RAG_RETRIEVAL_QUERY_COUNT || 6), 5), 6);
const RAG_RETRIEVAL_TOP_K = Math.min(Math.max(Number(process.env.RAG_RETRIEVAL_TOP_K || 3), 1), 3);
const RAG_RETRIEVAL_CANDIDATE_TOP_K = Math.min(
  Math.max(Number(process.env.RAG_RETRIEVAL_CANDIDATE_TOP_K || 12), RAG_RETRIEVAL_TOP_K),
  20
);
const RAG_MAX_CHUNK_CHARS = Math.min(Math.max(Number(process.env.RAG_MAX_CHUNK_CHARS || 700), 300), 1200);
const RAG_CHUNK_OVERLAP_CHARS = Math.min(Math.max(Number(process.env.RAG_CHUNK_OVERLAP_CHARS || 80), 0), 200);
const MYSQL_CONNECT_TIMEOUT = Number(process.env.MYSQL_CONNECT_TIMEOUT || 20000);
const AI_BASE_URL = process.env.AI_BASE_URL || process.env.YYLX_BASE_URL || "https://app.yylx.io/v1";
const AI_API_KEY = process.env.AI_API_KEY || process.env.YYLX_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || process.env.YYLX_MODEL || "";
const AI_TEMPERATURE = Math.min(Math.max(Number(process.env.AI_TEMPERATURE || 0.1), 0), 1);
const AI_REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.AI_REQUEST_TIMEOUT_MS || 25000), 5000), 55000);
const VECTOR_REQUEST_TIMEOUT_MS = Math.min(Math.max(Number(process.env.VECTOR_REQUEST_TIMEOUT_MS || 12000), 3000), 30000);
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validateAiOutput = ajv.compile(aiOutputSchema);
let pool;
let cloudbaseApp;
let rdbClient;
const userRagTagCache = new Map();

function getPool() {
  if (!pool) {
    const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw codedError("DATABASE_NOT_CONFIGURED", `缺少环境变量: ${missing.join(", ")}`);
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      charset: "utf8mb4",
      timezone: "+08:00",
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 5),
      connectTimeout: MYSQL_CONNECT_TIMEOUT,
      ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined
    });
  }
  return pool;
}

function getRdb() {
  if (!rdbClient) {
    cloudbaseApp = cloudbase.init({
      env: process.env.CLOUDBASE_ENV || cloudbase.SYMBOL_CURRENT_ENV || cloudbase.SYMBOL_DEFAULT_ENV
    });
    rdbClient = cloudbaseApp.rdb();
  }
  return rdbClient;
}

function useRdb() {
  return process.env.BUSINESS_DB_DRIVER === "cloudbase_rdb";
}

function codedError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertRdb(result, action) {
  if (result && result.error) {
    throw codedError("RDB_ERROR", `${action || "CloudBase RDB"} 失败`, result.error);
  }
  return result || {};
}

async function rdbSelect(table, columns = "*", build) {
  let request = getRdb().from(table).select(columns);
  if (build) request = build(request);
  const result = assertRdb(await request, `查询 ${table}`);
  return result.data || [];
}

function withTimeout(promise, timeoutMs, code, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(codedError(code, message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function rdbInsert(table, values, options) {
  const result = assertRdb(await getRdb().from(table).insert(values, options), `新增 ${table}`);
  return result.data || [];
}

async function rdbUpdate(table, values, build) {
  let request = getRdb().from(table).update(values);
  if (build) request = build(request);
  const result = assertRdb(await request, `更新 ${table}`);
  return result.data || null;
}

async function rdbDelete(table, build) {
  let request = getRdb().from(table).delete();
  if (build) request = build(request);
  const result = assertRdb(await request, `删除 ${table}`);
  return result.data || null;
}

async function rdbUpsert(table, values, options) {
  const result = assertRdb(await getRdb().from(table).upsert(values, options), `保存 ${table}`);
  return result.data || [];
}

function defaultPublicUserCode(userId) {
  const value = Number(userId || 0);
  if (!value) return "";
  return String(value).padStart(3, "0");
}

async function ensurePublicUserCode(user) {
  if (!useRdb() || !user || !user.id || user.public_user_code) return user;
  const publicUserCode = defaultPublicUserCode(user.id);
  if (!publicUserCode) return user;
  await rdbUpdate("users", { public_user_code: publicUserCode }, (request) => request.eq("id", user.id)).catch(() => {});
  return { ...user, public_user_code: publicUserCode };
}

function text(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw codedError("VALIDATION_ERROR", "上传文件内容格式不正确");
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function fileExt(filename, contentType) {
  const ext = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  if (ext) return ext[1];
  if (/markdown/.test(contentType || "")) return "md";
  if (/text\//.test(contentType || "")) return "txt";
  if (/wordprocessingml/.test(contentType || "")) return "docx";
  if (/pdf/.test(contentType || "")) return "pdf";
  return "";
}

async function extractEvidenceFileText(file) {
  if (!file || !file.dataUrl) return "";
  const { contentType, buffer } = decodeDataUrl(file.dataUrl);
  if (buffer.length > MAX_FILE_SIZE) throw codedError("VALIDATION_ERROR", "证据文件不能超过 10MB");
  const ext = fileExt(file.filename, contentType);
  if (!ALLOWED_FILE_TYPES.has(ext)) throw codedError("VALIDATION_ERROR", "证据文件仅支持 txt、md、docx、pdf");
  if (ext === "txt" || ext === "md") return buffer.toString("utf8").trim();
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return text(result.value, 120000);
  }
  if (ext === "pdf") {
    const result = await pdfParse(buffer);
    return text(result.text, 120000);
  }
  return "";
}

function id(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw codedError("INVALID_ID", "参数 id 不合法");
  return parsed;
}

function json(value, fallback = []) {
  if (value === undefined || value === null || value === "") return JSON.stringify(fallback);
  return JSON.stringify(value);
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 40)).filter(Boolean);
  return String(value || "")
    .split(/\s+/)
    .map((item) => text(item.replace(/^#/, ""), 40))
    .filter(Boolean);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function unique(items) {
  const list = Array.isArray(items) ? items : String(items || "").split(/\s+/);
  return Array.from(new Set(list.map((item) => text(item, 80)).filter(Boolean)));
}

function parseList(value) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value || "").split(/[,\s]+/));
}

function truncate(value, max = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function generateReaiTagId(prefix = "") {
  const suffix = crypto.randomBytes(6).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return text(`${prefix}${suffix}`, 40);
}

function nowDateTime() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function splitChunks(value, maxChars = RAG_MAX_CHUNK_CHARS, overlapChars = RAG_CHUNK_OVERLAP_CHARS) {
  const source = String(value || "").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!source) return [];
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    const end = Math.min(source.length, start + maxChars);
    let nextEnd = end;
    if (end < source.length) {
      const punctuation = Math.max(source.lastIndexOf("。", end), source.lastIndexOf("\n", end), source.lastIndexOf("；", end));
      if (punctuation > start + Math.floor(maxChars * 0.55)) nextEnd = punctuation + 1;
    }
    chunks.push(source.slice(start, nextEnd).trim());
    if (nextEnd >= source.length) break;
    start = Math.max(0, nextEnd - overlapChars);
  }
  return chunks.filter(Boolean);
}

function detectPolarity(value) {
  const content = String(value || "");
  if (/(不擅长|不想做|不接|避免|讨厌|没经验|不熟|退出|延期|没完成|不适合|不考虑|负面|投诉)/.test(content)) {
    if (/(不想做|不接|避免|讨厌|不考虑)/.test(content)) return "preference";
    return "negative";
  }
  if (/(完成|主导|负责|擅长|交付|上线|通过|获邀|复盘|解决|被确认|好评|推荐)/.test(content)) return "positive";
  return "neutral";
}

function confidenceForSource(sourceType, polarity) {
  const base = {
    feedback: 0.9,
    project_record: 0.86,
    event_record: 0.82,
    admin_note: 0.88,
    offline_transcript: 0.84,
    profile: 0.62,
    card: 0.58,
    project: 0.7,
    event: 0.7,
  }[sourceType] || 0.65;
  return polarity === "negative" || polarity === "preference" ? Math.max(base, 0.78) : base;
}

function ragVisibility(value) {
  return ["private", "profile_visible", "agent_chat", "match_only", "project_visible", "public", "admin_only", "sealed"].includes(value)
    ? value
    : "match_only";
}

function ragSourceTrust(value) {
  return [
    "self_reported",
    "system_observed",
    "owner_review",
    "admin_note",
    "admin_interview",
    "verified_record",
    "transcript_raw",
    "transcript_verified",
  ].includes(value)
    ? value
    : "self_reported";
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

async function healthCheck() {
  if (useRdb()) {
    const expectedTables = [
      "users",
      "projects",
      "project_applications",
      "rag_sources",
      "rag_chunks",
      "rag_index_jobs"
    ];
    const rdb = getRdb();
    const checks = await Promise.all(expectedTables.map(async (table) => {
      try {
        const result = await rdb.from(table).select("id").limit(1);
        return { table, ok: !result.error, error: result.error && (result.error.message || result.error) };
      } catch (err) {
        return { table, ok: false, error: err.message };
      }
    }));
    let querySmoke = { ok: true, count: 0, error: null };
    try {
      const result = assertRdb(
        await rdb
          .from("projects")
          .select("id,name,status,visibility,updated_at")
          .eq("visibility", "public")
          .in("status", ["active", "completed"])
          .order("updated_at", { ascending: false })
          .limit(3),
        "RDB 查询烟测"
      );
      querySmoke = { ok: true, count: (result.data || []).length, error: null };
    } catch (err) {
      querySmoke = { ok: false, count: 0, error: err.message };
    }
    return {
      driver: "cloudbase_rdb",
      database: process.env.MYSQL_DATABASE || process.env.CLOUDBASE_RDB_DATABASE || "",
      vector: {
        provider: VECTOR_PROVIDER,
        collection: VECTOR_COLLECTION,
        namespace: VECTOR_NAMESPACE,
        searchConfigured: vectorSearchConfigured(),
        upsertConfigured: vectorUpsertConfigured(),
        reai: VECTOR_PROVIDER === "reai_vdb" ? {
          baseUrl: REAI_VDB_BASE_URL,
          pidConfigured: Boolean(REAI_VDB_PID),
          vdbIdConfigured: Boolean(REAI_VDB_ID),
          defaultTags: getReaiDefaultTags(),
          apiKeyConfigured: Boolean(REAI_API_KEY),
          explicitUpsertUrlConfigured: Boolean(REAI_VDB_UPSERT_URL),
        } : undefined,
      },
      ai: {
        configured: aiConfigured(),
        baseUrl: AI_BASE_URL,
        modelConfigured: Boolean(AI_MODEL),
        apiKeyConfigured: Boolean(AI_API_KEY),
        retrievalQueryCount: RAG_RETRIEVAL_QUERY_COUNT,
        retrievalTopK: RAG_RETRIEVAL_TOP_K,
      },
      tableCount: null,
      requiredTables: expectedTables,
      existingTables: checks.filter((item) => item.ok).map((item) => item.table),
      missingTables: checks.filter((item) => !item.ok).map((item) => item.table),
      querySmoke,
      checks
    };
  }
  const rows = await query(
    `SELECT DATABASE() AS database_name,
            COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()`
  );
  const expectedTables = [
    "users",
    "projects",
    "project_applications",
    "rag_sources",
    "rag_chunks",
    "rag_index_jobs"
  ];
  const existingRows = await query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${expectedTables.map(() => "?").join(",")})
      ORDER BY table_name`,
    expectedTables
  );
  const existing = existingRows.map((row) => row.table_name);
  return {
    database: rows[0] && rows[0].database_name,
    tableCount: Number((rows[0] && rows[0].table_count) || 0),
    requiredTables: expectedTables,
    existingTables: existing,
    missingTables: expectedTables.filter((name) => !existing.includes(name))
  };
}

async function testAiConnection(event) {
  if (event.confirm !== "test-ai-connection") {
    throw codedError("CONFIRM_REQUIRED", "请传入 confirm=test-ai-connection 后再测试 AI");
  }
  const generated = await callAi({
    task: "ai_connection_test",
    instruction: "你是接口连通性测试助手。只返回JSON: {\"ok\":true,\"message\":\"不超过30字\"}",
    schema: {
      type: "object",
      required: ["ok", "message"],
      properties: {
        ok: { type: "boolean" },
        message: { type: "string" },
      },
    },
    payload: { ping: "daimao", time: new Date().toISOString() },
  });
  return {
    aiConfigured: aiConfigured(),
    baseUrl: AI_BASE_URL,
    model: AI_MODEL,
    result: generated,
  };
}

function assertAdminWebToken(event) {
  if (!event.adminWebToken || !process.env.ADMIN_WEB_TOKEN || event.adminWebToken !== process.env.ADMIN_WEB_TOKEN) {
    throw codedError("FORBIDDEN", "管理员网页令牌不正确");
  }
}

async function adminDebugDirectSqlSmoke(event) {
  assertAdminWebToken(event);
  const projectId = id(event.projectId || 1);
  const applicantUserId = id(event.applicantUserId || event.userId || 1);
  const startedAt = Date.now();
  if (useRdb()) {
    const [projects, applicants, admins] = await withTimeout(
      Promise.all([
        rdbSelect("projects", "id,name,status,visibility", (request) => request.eq("id", projectId).limit(1)),
        rdbSelect("users", "id,openid,display_name,status,is_admin,experience_points", (request) => request.eq("id", applicantUserId).limit(1)),
        rdbSelect("users", "id,display_name,status,is_admin", (request) =>
          request.eq("status", "active").eq("is_admin", 1).order("id", { ascending: true }).limit(1)
        ),
      ]),
      8000,
      "DEBUG_SQL_TIMEOUT",
      "CloudBase RDB 诊断查询超过 8 秒"
    );
    return {
      elapsedMs: Date.now() - startedAt,
      driver: "cloudbase_rdb",
      project: projects[0] || null,
      applicant: applicants[0] || null,
      admin: admins[0] || null,
    };
  }
  const [projects, applicants, admins] = await withTimeout(
    Promise.all([
      query("SELECT id,name,status,visibility FROM projects WHERE id=? LIMIT 1", [projectId]),
      query("SELECT id,openid,display_name,status,is_admin,experience_points FROM users WHERE id=? LIMIT 1", [applicantUserId]),
      query("SELECT id,display_name,status,is_admin FROM users WHERE status='active' AND is_admin=1 ORDER BY id ASC LIMIT 1"),
    ]),
    8000,
    "DEBUG_SQL_TIMEOUT",
    "MySQL 诊断查询超过 8 秒"
  );
  return {
    elapsedMs: Date.now() - startedAt,
    driver: "mysql",
    project: projects[0] || null,
    applicant: applicants[0] || null,
    admin: admins[0] || null,
  };
}

async function ensureRdbRecord(table, find, values) {
  const existing = await rdbSelect(table, "*", find);
  if (existing[0]) return existing[0];
  await rdbInsert(table, values);
  const created = await rdbSelect(table, "*", find);
  if (!created[0]) throw codedError("SEED_FAILED", `写入 ${table} 后未能读回记录`);
  return created[0];
}

async function seedDemoData(event) {
  if (!useRdb()) throw codedError("RDB_REQUIRED", "seedDemoData 需要 BUSINESS_DB_DRIVER=cloudbase_rdb");
  if (process.env.SEED_DEMO_SECRET && event.seedSecret !== process.env.SEED_DEMO_SECRET) {
    throw codedError("FORBIDDEN", "种子数据密钥不正确");
  }
  if (!process.env.SEED_DEMO_SECRET && event.confirm !== "seed-demo-data") {
    throw codedError("CONFIRM_REQUIRED", "请传入 confirm=seed-demo-data 后再写入模拟数据");
  }

  const admin = await ensureRdbRecord(
    "users",
    (request) => request.eq("openid", "demo_admin_daimao").limit(1),
    {
      openid: "demo_admin_daimao",
      display_name: "呆猫主理人",
      avatar_url: "",
      status: "active",
      is_admin: 1,
      experience_points: 180,
    }
  );
  const operator = await ensureRdbRecord(
    "users",
    (request) => request.eq("openid", "demo_operator_ai").limit(1),
    {
      openid: "demo_operator_ai",
      display_name: "阿里 AI 产品顾问",
      avatar_url: "",
      status: "active",
      is_admin: 0,
      experience_points: 76,
    }
  );
  const sales = await ensureRdbRecord(
    "users",
    (request) => request.eq("openid", "demo_sales_growth").limit(1),
    {
      openid: "demo_sales_growth",
      display_name: "增长销售合伙人",
      avatar_url: "",
      status: "active",
      is_admin: 0,
      experience_points: 63,
    }
  );

  const community = await ensureRdbRecord(
    "communities",
    (request) => request.eq("name", "OPC 共创营").limit(1),
    {
      name: "OPC 共创营",
      badge_name: "OPC",
      description: "面向一人公司和自由职业者的项目共创社区。",
      personality_tags_json: json(["务实", "接单", "共创"]),
      certification_method: "review_meeting",
      status: "active",
      sort_weight: 100,
    }
  );

  const members = [
    [community.id, operator.id, ["AI产品", "需求梳理"]],
    [community.id, sales.id, ["销售", "渠道合作"]],
  ];
  for (const [communityId, userId, tags] of members) {
    await ensureRdbRecord(
      "community_memberships",
      (request) => request.eq("community_id", communityId).eq("user_id", userId).limit(1),
      {
        community_id: communityId,
        user_id: userId,
        status: "active",
        tags_json: json(tags),
        certified_by: admin.id,
        certified_at: "2026-06-21 18:00:00",
      }
    );
  }

  const projectSeeds = [
    {
      name: "AI 销售线索整理小助手",
      description: "为中小 B2B 团队做一个从聊天记录、表格、会议纪要里自动整理销售线索的小工具，先跑 MVP，再看是否产品化。",
      tags: ["AI", "销售", "SaaS", "MVP"],
      ideal: "懂 B2B 销售流程、能把客户话术拆成需求字段、愿意一起验证真实付费场景的人。",
      role: ["产品顾问", "销售验证", "小程序开发"],
      weight: 100,
      stars: 42,
    },
    {
      name: "城市私董会活动运营系统",
      description: "给多个线下私董会社区做活动报名、成员认证、活动留痕和后续项目撮合的轻量系统。",
      tags: ["社区", "活动", "私域", "项目撮合"],
      ideal: "有线下活动运营经验，或者懂社区商业化、会员服务和招商合作。",
      role: ["活动运营", "商务拓展", "内容记录"],
      weight: 80,
      stars: 31,
    },
    {
      name: "品牌主理人短视频共创局",
      description: "撮合品牌主理人、脚本策划、拍摄剪辑和投放顾问，做一组可复用的短视频获客实验。",
      tags: ["短视频", "品牌", "内容", "增长"],
      ideal: "能稳定交付内容，或有品牌客户资源、投放复盘经验。",
      role: ["脚本策划", "剪辑", "投放复盘"],
      weight: 60,
      stars: 24,
    },
  ];
  const projects = [];
  for (const item of projectSeeds) {
    const project = await ensureRdbRecord(
      "projects",
      (request) => request.eq("name", item.name).limit(1),
      {
        name: item.name,
        description: item.description,
        project_type: "official",
        tags_json: json(item.tags),
        ideal_participant: item.ideal,
        not_fit_participant: "只想围观但短期没有投入意愿的人，建议先收藏观察。",
        required_capabilities_json: json(item.tags.slice(0, 3)),
        participation_roles_json: json(item.role),
        stage: "招募共创",
        goal: "先找到 3-5 个靠谱参与者，完成一次小范围验证。",
        creator_user_id: admin.id,
        visibility: "public",
        status: "active",
        star_count: item.stars,
        watch_count: item.stars,
        official_sort_weight: item.weight,
        is_official_recommended: 1,
      }
    );
    projects.push(project);
    await ensureRdbRecord(
      "project_members",
      (request) => request.eq("project_id", project.id).eq("user_id", admin.id).limit(1),
      {
        project_id: project.id,
        user_id: admin.id,
        role: "creator",
        status: "active",
        invited_by: admin.id,
        joined_at: "2026-06-21 18:05:00",
      }
    );
    await ensureRdbRecord(
      "project_updates",
      (request) => request.eq("project_id", project.id).eq("title", "项目已开放围观").limit(1),
      {
        project_id: project.id,
        creator_user_id: admin.id,
        title: "项目已开放围观",
        content: `呆猫已把「${item.name}」放入项目池，欢迎先围观点星，社区成员可以申请参与。`,
        visibility: "public",
        update_type: "announcement",
        status: "published",
      }
    );
  }

  const demoEvent = await ensureRdbRecord(
    "official_events",
    (request) => request.eq("title", "OPC 项目评审会 · 呆猫内测场").limit(1),
    {
      title: "OPC 项目评审会 · 呆猫内测场",
      description: "线下评审项目、确认成员能力标签，并把有效讨论沉淀进呆猫经验档案。",
      event_type: "project_review",
      location: "上海 · 线下小场",
      start_time: "2026-07-02 19:30:00",
      end_time: "2026-07-02 21:30:00",
      host_user_id: admin.id,
      status: "published",
      visibility: "public",
      official_sort_weight: 100,
      capacity: 20,
    }
  );

  return {
    seeded: true,
    users: [admin.id, operator.id, sales.id],
    communityId: community.id,
    projectIds: projects.map((item) => item.id),
    eventId: demoEvent.id,
  };
}

function dateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.display_name || "",
    avatarUrl: user.avatar_url || "",
    experiencePoints: Number(user.experience_points || 0),
  };
}

function requireDashboardAccess(event) {
  if (process.env.DASHBOARD_PUBLIC_TOKEN && event.dashboardToken !== process.env.DASHBOARD_PUBLIC_TOKEN) {
    throw codedError("FORBIDDEN", "大屏接口密钥不正确");
  }
}

async function publicDashboardStats() {
  if (!useRdb()) throw codedError("RDB_REQUIRED", "publicDashboardStats 需要 BUSINESS_DB_DRIVER=cloudbase_rdb");
  const [users, communities, memberships, projects, events, projectMembers] = await Promise.all([
    rdbSelect("users", "id,status,experience_points", (request) => request.eq("status", "active").limit(1000)),
    rdbSelect("communities", "id,name,badge_name,status,sort_weight", (request) => request.eq("status", "active").limit(100)),
    rdbSelect("community_memberships", "id,community_id,user_id,status", (request) => request.eq("status", "active").limit(3000)),
    rdbSelect("projects", "id,name,status,visibility,star_count,watch_count", (request) => request.eq("visibility", "public").limit(500)),
    rdbSelect("official_events", "id,status,visibility,start_time", (request) => request.eq("visibility", "public").limit(500)),
    rdbSelect("project_members", "id,project_id,user_id,status", (request) => request.eq("status", "active").limit(3000)),
  ]);
  const activeProjects = projects.filter((item) => item.status === "active");
  const completedProjects = projects.filter((item) => item.status === "completed");
  const upcomingEvents = events.filter((item) => ["published", "closed"].includes(item.status));
  const certifiedUserIds = new Set(memberships.map((item) => Number(item.user_id)));
  const memberByCommunity = new Map();
  memberships.forEach((item) => {
    const key = Number(item.community_id);
    memberByCommunity.set(key, (memberByCommunity.get(key) || 0) + 1);
  });
  return {
    stats: {
      activeUsers: users.length,
      certifiedUsers: certifiedUserIds.size,
      communities: communities.length,
      publicProjects: projects.length,
      activeProjects: activeProjects.length,
      completedProjects: completedProjects.length,
      upcomingEvents: upcomingEvents.length,
      activeProjectMembers: projectMembers.length,
      totalStars: projects.reduce((sum, item) => sum + Number(item.star_count || 0), 0),
      totalWatches: projects.reduce((sum, item) => sum + Number(item.watch_count || 0), 0),
    },
    communities: communities.map((item) => ({
      id: item.id,
      name: item.name,
      badge: item.badge_name,
      memberCount: memberByCommunity.get(Number(item.id)) || 0,
    })),
    generatedAt: new Date().toISOString(),
  };
}

async function publicProjectTown(event) {
  if (!useRdb()) throw codedError("RDB_REQUIRED", "publicProjectTown 需要 BUSINESS_DB_DRIVER=cloudbase_rdb");
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 300);
  const projects = await rdbSelect("projects", "*", (request) =>
    request
      .eq("visibility", "public")
      .in("status", ["active", "completed"])
      .order("is_official_recommended", { ascending: false })
      .order("official_sort_weight", { ascending: false })
      .order("star_count", { ascending: false })
      .limit(limit)
  );
  const projectIds = projects.map((item) => Number(item.id)).filter(Boolean);
  const creatorIds = unique(projects.map((item) => item.creator_user_id)).map(Number).filter(Boolean);
  const [members, creators, communities, events] = await Promise.all([
    projectIds.length ? rdbSelect("project_members", "*", (request) => request.in("project_id", projectIds).in("status", ["active", "invited"]).limit(3000)) : Promise.resolve([]),
    creatorIds.length ? rdbSelect("users", "id,display_name,avatar_url,experience_points", (request) => request.in("id", creatorIds)) : Promise.resolve([]),
    rdbSelect("communities", "id,name,badge_name,status", (request) => request.eq("status", "active").limit(100)),
    rdbSelect("official_events", "id,title,event_type,location,start_time,status,visibility,capacity", (request) =>
      request.eq("visibility", "public").in("status", ["published", "closed"]).order("start_time", { ascending: true }).limit(100)
    ),
  ]);
  const memberUserIds = unique(members.map((item) => item.user_id)).map(Number).filter(Boolean);
  const memberUsers = memberUserIds.length
    ? await rdbSelect("users", "id,display_name,avatar_url,experience_points", (request) => request.in("id", memberUserIds).limit(3000))
    : [];
  const memberships = memberUserIds.length
    ? await rdbSelect("community_memberships", "community_id,user_id,status,tags_json", (request) => request.in("user_id", memberUserIds).eq("status", "active").limit(3000))
    : [];
  const userMap = new Map([...creators, ...memberUsers].map((item) => [Number(item.id), item]));
  const communityMap = new Map(communities.map((item) => [Number(item.id), item]));
  const membershipMap = new Map();
  memberships.forEach((item) => {
    const key = Number(item.user_id);
    const list = membershipMap.get(key) || [];
    const community = communityMap.get(Number(item.community_id));
    if (community) {
      list.push({
        id: community.id,
        name: community.name,
        badge: community.badge_name,
        tags: parseJson(item.tags_json, []),
      });
    }
    membershipMap.set(key, list);
  });
  const membersByProject = new Map();
  members.forEach((item) => {
    const list = membersByProject.get(Number(item.project_id)) || [];
    const user = userMap.get(Number(item.user_id));
    if (user) {
      list.push({
        ...publicUser(user),
        role: item.role,
        status: item.status,
        communities: membershipMap.get(Number(item.user_id)) || [],
      });
    }
    membersByProject.set(Number(item.project_id), list);
  });
  return {
    town: {
      projects: projects.map((project, index) => ({
        id: project.id,
        name: project.name,
        description: truncate(project.description, 240),
        status: project.status,
        stage: project.stage,
        tags: parseJson(project.tags_json, []),
        starCount: Number(project.star_count || 0),
        watchCount: Number(project.watch_count || 0),
        houseType: ["studio", "workshop", "hall", "lab"][index % 4],
        position: {
          x: (index % 5) * 220,
          y: Math.floor(index / 5) * 180,
        },
        creator: publicUser(userMap.get(Number(project.creator_user_id))),
        members: membersByProject.get(Number(project.id)) || [],
      })),
      communities: communities.map((item) => ({
        id: item.id,
        name: item.name,
        badge: item.badge_name,
      })),
      events: events.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.event_type,
        location: item.location,
        date: dateOnly(item.start_time),
        status: item.status,
        capacity: item.capacity,
      })),
    },
    generatedAt: new Date().toISOString(),
  };
}

async function transaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function upsertRagSource(connection, source) {
  const content = text(source.content, 120000);
  if (!content) return null;
  const sourceType = text(source.sourceType, 40);
  const sourceId = Number(source.sourceId);
  if (!sourceType || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  const tags = unique(source.tags || []);
  const metadata = source.metadata || {};
  const hash = sha256(content);
  const [existingRows] = await connection.execute(
    "SELECT id,text_hash,version FROM rag_sources WHERE source_type=? AND source_id=? ORDER BY version DESC LIMIT 1",
    [sourceType, sourceId]
  );
  let sourceRowId = existingRows[0] && existingRows[0].id;
  let version = existingRows[0] ? Number(existingRows[0].version || 1) : 1;
  if (existingRows[0] && existingRows[0].text_hash !== hash) version += 1;
  if (sourceRowId && existingRows[0].text_hash === hash) {
    await connection.execute(
      `UPDATE rag_sources SET title=?,summary=?,tags_json=?,visibility=?,source_trust=?,status='pending',metadata_json=?,updated_at=NOW()
       WHERE id=?`,
      [
        text(source.title, 180),
        text(source.summary, 3000),
        json(tags),
        ragVisibility(source.visibility),
        ragSourceTrust(source.sourceTrust || metadata.source_trust),
        json(metadata, {}),
        sourceRowId,
      ]
    );
    await connection.execute("DELETE FROM rag_chunks WHERE source_id=?", [sourceRowId]);
  } else {
    const [result] = await connection.execute(
      `INSERT INTO rag_sources
       (source_type,source_id,owner_user_id,project_id,event_id,community_id,title,summary,tags_json,visibility,source_trust,status,version,text_hash,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
      [
        sourceType,
        sourceId,
        source.ownerUserId || null,
        source.projectId || null,
        source.eventId || null,
        source.communityId || null,
        text(source.title, 180),
        text(source.summary, 3000),
        json(tags),
        ragVisibility(source.visibility),
        ragSourceTrust(source.sourceTrust || metadata.source_trust),
        version,
        hash,
        json(metadata, {}),
      ]
    );
    sourceRowId = result.insertId;
  }
  const chunks = splitChunks(content);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const polarity = detectPolarity(chunk);
    await connection.execute(
      `INSERT INTO rag_chunks
       (source_id,chunk_index,content,content_summary,vector_doc_id,evidence_polarity,confidence,status)
       VALUES (?,?,?,?,?,?,?,'pending')
       ON DUPLICATE KEY UPDATE content=VALUES(content),content_summary=VALUES(content_summary),
        vector_doc_id=VALUES(vector_doc_id),evidence_polarity=VALUES(evidence_polarity),
        confidence=VALUES(confidence),status='pending',updated_at=NOW()`,
      [
        sourceRowId,
        index,
        chunk,
        truncate(chunk, 240),
        `rag_${sourceRowId}_${index}`,
        polarity,
        confidenceForSource(sourceType, polarity),
      ]
    );
  }
  await connection.execute(
    `INSERT INTO rag_index_jobs (source_id,job_type,status)
     VALUES (?,'upsert','pending')`,
    [sourceRowId]
  );
  return { sourceId: sourceRowId, chunks: chunks.length };
}

async function upsertRagSourceRdb(source) {
  const content = text(source.content, 120000);
  if (!content) return null;
  const sourceType = text(source.sourceType, 40);
  const sourceId = Number(source.sourceId);
  if (!sourceType || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  const tags = unique(source.tags || []);
  const metadata = source.metadata || {};
  const hash = sha256(content);
  const existingRows = await rdbSelect("rag_sources", "*", (request) =>
    request.eq("source_type", sourceType).eq("source_id", sourceId).order("version", { ascending: false }).limit(1)
  );
  const existing = existingRows[0];
  let sourceRowId = existing && existing.id;
  let version = existing ? Number(existing.version || 1) : 1;
  const payload = {
    source_type: sourceType,
    source_id: sourceId,
    owner_user_id: source.ownerUserId || null,
    project_id: source.projectId || null,
    event_id: source.eventId || null,
    community_id: source.communityId || null,
    title: text(source.title, 180),
    summary: text(source.summary, 3000),
    tags_json: json(tags),
    visibility: ragVisibility(source.visibility),
    source_trust: ragSourceTrust(source.sourceTrust || metadata.source_trust),
    status: "pending",
    text_hash: hash,
    metadata_json: json(metadata, {}),
  };
  if (existing && existing.text_hash !== hash) version += 1;
  payload.version = version;
  if (sourceRowId && existing.text_hash === hash) {
    await rdbUpdate("rag_sources", payload, (request) => request.eq("id", sourceRowId));
    await rdbDelete("rag_chunks", (request) => request.eq("source_id", sourceRowId));
  } else {
    await rdbInsert("rag_sources", payload);
    const created = await rdbSelect("rag_sources", "id", (request) =>
      request.eq("source_type", sourceType).eq("source_id", sourceId).eq("version", version).limit(1)
    );
    sourceRowId = created[0] && created[0].id;
  }
  if (!sourceRowId) throw codedError("RAG_SOURCE_CREATE_FAILED", "RAG source 写入后未能读回");
  const chunks = splitChunks(content);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const polarity = detectPolarity(chunk);
    await rdbInsert("rag_chunks", {
      source_id: sourceRowId,
      chunk_index: index,
      content: chunk,
      content_summary: truncate(chunk, 240),
      vector_doc_id: `rag_${sourceRowId}_${index}`,
      evidence_polarity: polarity,
      confidence: confidenceForSource(sourceType, polarity),
      status: "pending",
    });
  }
  await rdbInsert("rag_index_jobs", {
    source_id: sourceRowId,
    job_type: "upsert",
    status: "pending",
  });
  return { sourceId: sourceRowId, chunks: chunks.length };
}

async function upsertRagSourceForCurrentDriver(source) {
  if (useRdb()) return upsertRagSourceRdb(source);
  return transaction((connection) => upsertRagSource(connection, source));
}

async function currentUser(event = {}) {
  const context = cloud.getWXContext();
  const openid = context.FROM_OPENID || context.OPENID;
  const unionid = context.FROM_UNIONID || context.UNIONID || "";
  const sourceAppid = context.FROM_APPID || context.APPID || process.env.WX_APPID || "cloudbase-default";
  if (event.adminWebToken) {
    if (!process.env.ADMIN_WEB_TOKEN || event.adminWebToken !== process.env.ADMIN_WEB_TOKEN) {
      throw codedError("FORBIDDEN", "管理员网页令牌不正确");
    }
    const buildAdminQuery = (request) => {
      const base = request.eq("status", "active").eq("is_admin", 1);
      return process.env.ADMIN_WEB_OPENID
        ? base.eq("openid", process.env.ADMIN_WEB_OPENID).limit(1)
        : base.order("id", { ascending: true }).limit(1);
    };
    const admins = useRdb()
      ? await rdbSelect("users", "*", buildAdminQuery)
      : await query(
          `SELECT * FROM users
           WHERE status='active' AND is_admin=1 ${process.env.ADMIN_WEB_OPENID ? "AND openid=?" : ""}
           ORDER BY id ASC LIMIT 1`,
          process.env.ADMIN_WEB_OPENID ? [process.env.ADMIN_WEB_OPENID] : []
    );
    if (!admins[0]) throw codedError("FORBIDDEN", "未找到可用于网页后台的管理员账号");
    return admins[0];
  }
  if (!openid) throw codedError("LOGIN_REQUIRED", "无法识别当前微信用户");
  const displayName = text(context.NICKNAME, 80);
  if (useRdb()) {
    const identityRows = await rdbSelect("user_identities", "*", (request) =>
      request.eq("source_appid", sourceAppid).eq("openid", openid).eq("status", "active").limit(1)
    ).catch(() => []);
    if (identityRows[0]) {
      await rdbUpdate(
        "user_identities",
        { last_seen_at: nowDateTime(), unionid: unionid || identityRows[0].unionid || "" },
        (request) => request.eq("id", identityRows[0].id)
      ).catch(() => {});
      if (displayName) await rdbUpdate("users", { display_name: displayName }, (request) => request.eq("id", identityRows[0].user_id));
      const user = await ensurePublicUserCode((await rdbSelect("users", "*", (request) => request.eq("id", identityRows[0].user_id).limit(1)))[0]);
      if (!user || user.status !== "active") throw codedError("USER_DISABLED", "当前账号不可用");
      return user;
    }

    const legacyUsers = await rdbSelect("users", "*", (request) => request.eq("openid", openid).limit(1));
    let user = legacyUsers[0];
    if (user && displayName) await rdbUpdate("users", { display_name: displayName }, (request) => request.eq("id", user.id));
    if (!user) {
      const inserted = await rdbInsert("users", { openid, unionid, display_name: displayName });
      user = Array.isArray(inserted) && inserted[0] ? inserted[0] : (await rdbSelect("users", "*", (request) => request.eq("openid", openid).limit(1)))[0];
    }
    user = await ensurePublicUserCode(user);
    if (user) {
      await rdbInsert("user_identities", {
        user_id: user.id,
        source_appid: sourceAppid,
        openid,
        unionid,
        identity_type: "wechat_miniprogram",
        status: "active",
        last_seen_at: nowDateTime(),
      }).catch(async () => {
        await rdbUpdate("user_identities", { user_id: user.id, unionid, status: "active", last_seen_at: nowDateTime() }, (request) =>
          request.eq("source_appid", sourceAppid).eq("openid", openid)
        ).catch(() => {});
      });
    }
    if (!user || user.status !== "active") throw codedError("USER_DISABLED", "当前账号不可用");
    return user;
  }
  await query(
    `INSERT INTO users (openid, display_name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name))`,
    [openid, displayName]
  );
  const rows = await query("SELECT * FROM users WHERE openid = ? LIMIT 1", [openid]);
  const user = rows[0];
  if (!user || user.status !== "active") throw codedError("USER_DISABLED", "当前账号不可用");
  return user;
}

async function getCommunityMemberships(userId) {
  try {
    if (useRdb()) {
      const memberships = await rdbSelect("community_memberships", "*", (request) =>
        request.eq("user_id", userId).eq("status", "active").order("certified_at", { ascending: false })
      );
      const communityIds = unique(memberships.map((item) => item.community_id)).map(Number).filter(Boolean);
      if (!communityIds.length) return [];
      const communities = await rdbSelect("communities", "*", (request) =>
        request.in("id", communityIds).eq("status", "active").order("sort_weight", { ascending: false })
      );
      const byId = new Map(communities.map((item) => [Number(item.id), item]));
      return memberships
        .map((item) => {
          const community = byId.get(Number(item.community_id));
          if (!community) return null;
          return {
            ...item,
            name: community.name,
            badge_name: community.badge_name,
            logo_url: community.logo_url || "",
            personality_tags_json: community.personality_tags_json,
          };
        })
        .filter(Boolean);
    }
    return await query(
      `SELECT cm.*, c.name, c.badge_name, c.logo_url, c.personality_tags_json
       FROM community_memberships cm
       JOIN communities c ON c.id = cm.community_id
       WHERE cm.user_id = ? AND cm.status = 'active' AND c.status = 'active'
       ORDER BY c.sort_weight DESC, cm.certified_at DESC`,
      [userId]
    );
  } catch (err) {
    console.warn("community tables unavailable", err.message);
    return [];
  }
}

async function getActiveUserRagTag(userId) {
  const numericUserId = Number(userId || 0);
  if (!numericUserId) return null;
  const cacheKey = `${VECTOR_PROVIDER}:${numericUserId}`;
  if (userRagTagCache.has(cacheKey)) return userRagTagCache.get(cacheKey);
  try {
    const rows = useRdb()
      ? await rdbSelect("user_rag_tags", "*", (request) =>
          request.eq("user_id", numericUserId).eq("provider", "reai_vdb").eq("status", "active").limit(1)
        )
      : await query("SELECT * FROM user_rag_tags WHERE user_id=? AND provider='reai_vdb' AND status='active' LIMIT 1", [numericUserId]);
    const tag = rows[0] || null;
    userRagTagCache.set(cacheKey, tag);
    return tag;
  } catch (err) {
    console.warn("user_rag_tags unavailable", err.message);
    userRagTagCache.set(cacheKey, null);
    return null;
  }
}

async function saveUserRagTagRecord({ userId, userTagId, tagName, status = "active", createdReason = "admin" }) {
  const numericUserId = id(userId);
  const payload = {
    user_id: numericUserId,
    provider: "reai_vdb",
    project_tag_id: getReaiDefaultTags()[0] || "",
    user_tag_id: text(userTagId, 80),
    tag_name: text(tagName, 120),
    status,
    created_reason: text(createdReason, 60),
    error_message: null,
  };
  if (!payload.user_tag_id) throw codedError("VALIDATION_ERROR", "userTagId 不能为空");
  if (!payload.tag_name) payload.tag_name = `${REAI_USER_TAG_PREFIX}${numericUserId}`;

  if (useRdb()) {
    const existing = await rdbSelect("user_rag_tags", "*", (request) =>
      request.eq("user_id", numericUserId).eq("provider", "reai_vdb").limit(1)
    );
    if (existing[0]) {
      await rdbUpdate("user_rag_tags", payload, (request) => request.eq("id", existing[0].id));
    } else {
      await rdbInsert("user_rag_tags", payload);
    }
    userRagTagCache.delete(`reai_vdb:${numericUserId}`);
    return (await rdbSelect("user_rag_tags", "*", (request) =>
      request.eq("user_id", numericUserId).eq("provider", "reai_vdb").limit(1)
    ))[0];
  }

  await query(
    `INSERT INTO user_rag_tags
     (user_id,provider,project_tag_id,user_tag_id,tag_name,status,created_reason,error_message)
     VALUES (?,?,?,?,?,?,?,NULL)
     ON DUPLICATE KEY UPDATE project_tag_id=VALUES(project_tag_id),user_tag_id=VALUES(user_tag_id),
       tag_name=VALUES(tag_name),status=VALUES(status),created_reason=VALUES(created_reason),error_message=NULL,updated_at=NOW()`,
    [
      payload.user_id,
      payload.provider,
      payload.project_tag_id,
      payload.user_tag_id,
      payload.tag_name,
      payload.status,
      payload.created_reason,
    ]
  );
  userRagTagCache.delete(`reai_vdb:${numericUserId}`);
  const rows = await query("SELECT * FROM user_rag_tags WHERE user_id=? AND provider='reai_vdb' LIMIT 1", [numericUserId]);
  return rows[0] || null;
}

async function getMyIdentity(event, user) {
  const memberships = await getCommunityMemberships(user.id);
  const profiles = useRdb()
    ? await rdbSelect("user_profiles", "*", (request) => request.eq("user_id", user.id).limit(1)).catch(() => [])
    : await query("SELECT * FROM user_profiles WHERE user_id = ? LIMIT 1", [user.id]).catch(() => []);
  const profile = profiles[0] || null;
  const connections = useRdb()
    ? await rdbSelect("user_connections", "id,friend_user_id,status,last_met_at,visit_count", (request) =>
        request.eq("user_id", user.id).eq("status", "active").limit(200)
      ).catch(() => [])
    : [];
  return {
    identity: {
      userId: user.id,
      openid: user.openid,
      role: user.is_admin ? "admin" : memberships.length ? "community_member" : "watcher",
      isAdmin: !!user.is_admin,
      isCommunityMember: memberships.length > 0,
      experiencePoints: Number(user.experience_points || 0),
      profile: profile
        ? {
            name: profile.name,
            job: profile.job,
            wechat: profile.wechat,
            avatarUrl: profile.avatar_url,
            intro: profile.intro,
            tags: parseJson(profile.tags_json, []),
            answers: parseJson(profile.answers_json, []),
            agreementVersion: profile.agreement_version,
          }
        : null,
      connectionCount: connections.length,
      communities: memberships.map((item) => ({
        id: item.community_id,
        name: item.name,
        badge: item.badge_name,
        logoUrl: item.logo_url || "",
        personality: parseJson(item.personality_tags_json, []).join("、"),
        tags: parseJson(item.tags_json, []),
      })),
    },
  };
}

async function requireAdmin(user) {
  if (!user.is_admin) throw codedError("FORBIDDEN", "需要管理员权限");
}

async function adminLog(user, action, targetType, targetId, detail) {
  const payload = {
    admin_user_id: user.id,
    action,
    target_type: targetType,
    target_id: targetId || null,
    detail_json: json(detail || {}, {}),
  };
  if (useRdb()) {
    await rdbInsert("admin_logs", payload);
    return;
  }
  await query(
    "INSERT INTO admin_logs (admin_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?)",
    [payload.admin_user_id, payload.action, payload.target_type, payload.target_id, payload.detail_json]
  );
}

function eventPayload(input, userId) {
  const title = text(input.title, 180);
  if (!title || !input.startTime) throw codedError("VALIDATION_ERROR", "活动标题和开始时间不能为空");
  const communityId = input.communityId !== undefined ? input.communityId : input.community_id;
  return {
    title,
    description: text(input.description, 10000),
    event_type: text(input.eventType, 40) || "other",
    location: text(input.location, 255),
    start_time: sqlDateTime(input.startTime),
    end_time: input.endTime ? sqlDateTime(input.endTime) : null,
    host_user_id: userId,
    community_id: communityId ? id(communityId, "communityId") : null,
    status: ["draft", "published", "closed", "cancelled", "completed"].includes(input.status) ? input.status : "published",
    visibility: input.visibility === "private" ? "private" : "public",
    official_sort_weight: Number(input.officialSortWeight || 0),
    capacity: input.capacity ? Number(input.capacity) : null,
  };
}

function projectPayload(input, userId) {
  const name = text(input.name, 160);
  if (!name) throw codedError("VALIDATION_ERROR", "项目名称不能为空");
  const creatorUserId = input.creatorUserId || input.creator_user_id ? id(input.creatorUserId || input.creator_user_id) : userId;
  const communityId = input.communityId !== undefined ? input.communityId : input.community_id;
  return {
    name,
    description: text(input.description, 10000),
    project_type: text(input.projectType || input.project_type, 60) || "official",
    tags_json: json(parseTags(input.tagsText || input.tags), []),
    ideal_participant: text(input.idealParticipant || input.ideal_participant, 5000),
    not_fit_participant: text(input.notFitParticipant || input.not_fit_participant, 5000),
    stage: text(input.stage, 80),
    goal: text(input.goal, 5000),
    creator_user_id: creatorUserId,
    community_id: communityId ? id(communityId) : null,
    visibility: input.visibility === "public" ? "public" : "private",
    status: ["draft", "active", "paused", "completed", "archived"].includes(input.status) ? input.status : "draft",
    official_sort_weight: Number(input.officialSortWeight || input.official_sort_weight || 0),
    is_official_recommended: input.isOfficialRecommended || input.is_official_recommended ? 1 : 0,
  };
}

function sqlDateTime(value) {
  const raw = text(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return `${raw.replace("T", " ")}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) return raw.replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 16 ? `${raw}:00` : raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw codedError("VALIDATION_ERROR", "活动时间格式不正确");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function projectRole(projectId, userId) {
  if (useRdb()) {
    const projects = await rdbSelect("projects", "id,creator_user_id,visibility,status", (request) => request.eq("id", projectId).limit(1));
    if (!projects[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
    const members = await rdbSelect("project_members", "role,status", (request) =>
      request.eq("project_id", projectId).eq("user_id", userId).limit(1)
    );
    const member = members[0] || {};
    return {
      ...projects[0],
      role: member.role,
      member_status: member.status,
      isCreator: Number(projects[0].creator_user_id) === Number(userId),
      isMember: member.status === "active"
    };
  }
  const rows = await query(
    `SELECT p.creator_user_id, p.visibility, p.status, pm.role, pm.status AS member_status
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? LIMIT 1`,
    [userId, projectId]
  );
  if (!rows[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
  const row = rows[0];
  return {
    ...row,
    isCreator: Number(row.creator_user_id) === Number(userId),
    isMember: row.member_status === "active"
  };
}

async function requireProjectMember(projectId, userId) {
  const role = await projectRole(projectId, userId);
  if (!role.isCreator && !role.isMember) throw codedError("FORBIDDEN", "只有项目成员可以执行此操作");
  return role;
}

async function listProjects(event, user) {
  const limit = Math.min(Math.max(Number(event.limit || 30), 1), 50);
  if (useRdb()) {
    const projects = await rdbSelect("projects", "*", (request) =>
      request
        .eq("visibility", "public")
        .in("status", ["active", "completed"])
        .order("is_official_recommended", { ascending: false })
        .order("official_sort_weight", { ascending: false })
        .order("star_count", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit)
    );
    const creatorIds = unique(projects.map((project) => project.creator_user_id)).map(Number).filter(Boolean);
    const projectIds = projects.map((project) => Number(project.id)).filter(Boolean);
    const [creators, watchers, members] = await Promise.all([
      creatorIds.length ? rdbSelect("users", "id,display_name", (request) => request.in("id", creatorIds)) : Promise.resolve([]),
      projectIds.length ? rdbSelect("project_watchers", "project_id,status", (request) => request.in("project_id", projectIds).eq("user_id", user.id)) : Promise.resolve([]),
      projectIds.length ? rdbSelect("project_members", "project_id,status", (request) => request.in("project_id", projectIds).eq("user_id", user.id)) : Promise.resolve([]),
    ]);
    const creatorMap = new Map(creators.map((item) => [Number(item.id), item.display_name]));
    const watcherMap = new Map(watchers.map((item) => [Number(item.project_id), item.status]));
    const memberMap = new Map(members.map((item) => [Number(item.project_id), item.status]));
    return {
      projects: projects.map((project) => ({
        ...project,
        creator_name: creatorMap.get(Number(project.creator_user_id)) || "",
        is_watching: watcherMap.get(Number(project.id)) === "watching" ? 1 : 0,
        is_member: memberMap.get(Number(project.id)) === "active" ? 1 : 0,
        tags: parseJson(project.tags_json, []),
      }))
    };
  }
  const rows = await query(
    `SELECT p.*, u.display_name AS creator_name,
       IF(pw.status = 'watching', 1, 0) AS is_watching,
       IF(pm.status = 'active', 1, 0) AS is_member,
       p.tags_json AS tags
     FROM projects p
     JOIN users u ON u.id = p.creator_user_id
     LEFT JOIN project_watchers pw ON pw.project_id = p.id AND pw.user_id = ?
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.visibility = 'public' AND p.status IN ('active','completed')
     ORDER BY p.is_official_recommended DESC, p.official_sort_weight DESC, p.star_count DESC, p.updated_at DESC
     LIMIT ${limit}`,
    [user.id, user.id]
  );
  return { projects: rows.map((project) => ({ ...project, tags: parseJson(project.tags, []) })) };
}

async function listMyProjects(event, user) {
  if (useRdb()) {
    const [created, memberships] = await Promise.all([
      rdbSelect("projects", "*", (request) => request.eq("creator_user_id", user.id).order("updated_at", { ascending: false }).limit(100)),
      rdbSelect("project_members", "*", (request) => request.eq("user_id", user.id).in("status", ["active", "invited"]).limit(100))
    ]);
    const memberProjectIds = memberships.map((item) => Number(item.project_id)).filter(Boolean);
    const joined = memberProjectIds.length
      ? await rdbSelect("projects", "*", (request) => request.in("id", memberProjectIds).limit(100))
      : [];
    const byId = new Map();
    [...created, ...joined].forEach((project) => byId.set(Number(project.id), project));
    const projects = Array.from(byId.values());
    const creatorIds = unique(projects.map((project) => project.creator_user_id)).map(Number).filter(Boolean);
    const creators = creatorIds.length ? await rdbSelect("users", "id,display_name", (request) => request.in("id", creatorIds)) : [];
    const creatorMap = new Map(creators.map((item) => [Number(item.id), item.display_name]));
    const memberMap = new Map(memberships.map((item) => [Number(item.project_id), item]));
    return {
      projects: projects.map((project) => {
        const member = memberMap.get(Number(project.id)) || {};
        return {
          ...project,
          creator_name: creatorMap.get(Number(project.creator_user_id)) || "",
          my_role: member.role,
          member_status: member.status,
          is_creator: Number(project.creator_user_id) === Number(user.id) ? 1 : 0,
          is_member: member.status === "active" ? 1 : 0,
          tags: parseJson(project.tags_json, []),
        };
      })
    };
  }
  const rows = await query(
    `SELECT p.*, u.display_name AS creator_name, pm.role AS my_role, pm.status AS member_status,
      p.tags_json AS tags,
      IF(p.creator_user_id = ?, 1, 0) AS is_creator,
      IF(pm.status = 'active', 1, 0) AS is_member
     FROM projects p
     JOIN users u ON u.id = p.creator_user_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.creator_user_id = ? OR pm.status IN ('active','invited')
     ORDER BY p.updated_at DESC
     LIMIT 100`,
    [user.id, user.id, user.id]
  );
  return { projects: rows.map((project) => ({ ...project, tags: parseJson(project.tags, []) })) };
}

async function getProject(event, user) {
  const projectId = id(event.projectId);
  const role = await projectRole(projectId, user.id);
  if (role.visibility !== "public" && !role.isMember && !role.isCreator && !user.is_admin) {
    throw codedError("FORBIDDEN", "你没有权限查看该项目");
  }
  if (useRdb()) {
    const [projects, watchers, members] = await Promise.all([
      rdbSelect("projects", "*", (request) => request.eq("id", projectId).limit(1)),
      rdbSelect("project_watchers", "status", (request) => request.eq("project_id", projectId).eq("user_id", user.id).limit(1)),
      rdbSelect("project_members", "role,status", (request) => request.eq("project_id", projectId).eq("user_id", user.id).limit(1))
    ]);
    if (!projects[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
    const creatorRows = await rdbSelect("users", "id,display_name", (request) => request.eq("id", projects[0].creator_user_id).limit(1));
    const allowedVisibility = role.isMember || role.isCreator || user.is_admin ? ["public", "project_members"] : ["public"];
    const updates = await rdbSelect("project_updates", "*", (request) =>
      request.eq("project_id", projectId).eq("status", "published").in("visibility", allowedVisibility).order("created_at", { ascending: false }).limit(50)
    );
    const updateCreatorIds = unique(updates.map((item) => item.creator_user_id)).map(Number).filter(Boolean);
    const updateCreators = updateCreatorIds.length ? await rdbSelect("users", "id,display_name", (request) => request.in("id", updateCreatorIds)) : [];
    const updateCreatorMap = new Map(updateCreators.map((item) => [Number(item.id), item.display_name]));
    const identity = await getMyIdentity({}, user);
    const watcher = watchers[0] || {};
    const member = members[0] || {};
    return {
      project: {
        ...projects[0],
        creator_name: creatorRows[0] ? creatorRows[0].display_name : "",
        is_watching: watcher.status === "watching" ? 1 : 0,
        is_member: member.status === "active" ? 1 : 0,
        my_role: member.role,
        tags: parseJson(projects[0].tags_json, []),
        can_apply: identity.identity.isCommunityMember || identity.identity.isAdmin,
        viewer_role: identity.identity.role,
        viewer_communities: identity.identity.communities,
      },
      updates: updates.map((item) => ({ ...item, creator_name: updateCreatorMap.get(Number(item.creator_user_id)) || "" })),
    };
  }
  const projects = await query(
    `SELECT p.*, u.display_name AS creator_name,
      IF(pw.status = 'watching', 1, 0) AS is_watching,
      IF(pm.status = 'active', 1, 0) AS is_member,
      pm.role AS my_role,
      p.tags_json AS tags
     FROM projects p
     JOIN users u ON u.id = p.creator_user_id
     LEFT JOIN project_watchers pw ON pw.project_id = p.id AND pw.user_id = ?
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? LIMIT 1`,
    [user.id, user.id, projectId]
  );
  const allowedVisibility = role.isMember || role.isCreator || user.is_admin ? ["public", "project_members"] : ["public"];
  const updates = await query(
    `SELECT pu.*, u.display_name AS creator_name
     FROM project_updates pu JOIN users u ON u.id = pu.creator_user_id
     WHERE pu.project_id = ? AND pu.status = 'published' AND pu.visibility IN (${allowedVisibility.map(() => "?").join(",")})
     ORDER BY pu.created_at DESC LIMIT 50`,
    [projectId, ...allowedVisibility]
  );
  const identity = await getMyIdentity({}, user);
  return {
    project: {
      ...projects[0],
      tags: parseJson(projects[0] && projects[0].tags, []),
      can_apply: identity.identity.isCommunityMember || identity.identity.isAdmin,
      viewer_role: identity.identity.role,
      viewer_communities: identity.identity.communities,
    },
    updates,
  };
}

async function createProject(event, user) {
  await requireAdmin(user);
  const input = event.project || {};
  const name = text(input.name, 160);
  const description = text(input.description, 10000);
  if (!name || !description) throw codedError("VALIDATION_ERROR", "项目名称和介绍不能为空");
  const visibility = input.visibility === "public" ? "public" : "private";
  const status = input.status === "active" ? "active" : "draft";
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO projects
       (name, description, project_type, tags_json, ideal_participant, not_fit_participant, required_capabilities_json,
        participation_roles_json, stage, goal, creator_user_id, visibility, status)
       VALUES (?, ?, 'official', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description,
        json(parseTags(input.tagsText || input.tags), []),
        text(input.idealParticipant, 3000),
        text(input.notFitParticipant, 3000),
        json(unique(input.requiredCapabilities || parseTags(input.requiredCapabilitiesText))),
        json(unique(input.participationRoles || parseTags(input.participationRolesText))),
        text(input.stage, 80),
        text(input.goal, 5000),
        user.id,
        visibility,
        status,
      ]
    );
    await connection.execute(
      `INSERT INTO project_members (project_id, user_id, role, status, joined_at)
      VALUES (?, ?, 'creator', 'active', NOW())`,
      [result.insertId, user.id]
    );
    await upsertRagSource(connection, {
      sourceType: "project",
      sourceId: result.insertId,
      ownerUserId: user.id,
      projectId: result.insertId,
      title: name,
      summary: text(input.goal || description, 3000),
      tags: parseTags(input.tagsText || input.tags),
      visibility: visibility === "public" ? "public" : "project_visible",
      content: [
        `项目：${name}`,
        `介绍：${description}`,
        input.goal ? `目标：${input.goal}` : "",
        input.idealParticipant ? `希望参与者：${input.idealParticipant}` : "",
        input.notFitParticipant ? `不适合：${input.notFitParticipant}` : "",
        input.requiredCapabilitiesText ? `需要能力：${input.requiredCapabilitiesText}` : "",
      ].filter(Boolean).join("\n"),
      metadata: { source: "createProject" },
    });
    return { projectId: result.insertId };
  });
}

async function applyProject(event, user) {
  const identity = await getMyIdentity({}, user);
  if (!identity.identity.isCommunityMember && !identity.identity.isAdmin) {
    throw codedError("COMMUNITY_CERTIFICATION_REQUIRED", "通过任一社区认证后，才能申请参与项目");
  }
  const projectId = id(event.projectId);
  const request = event.request || {};
  const message = text(request.message, 3000);
  const canOffer = text(request.canOffer, 2000);
  const relatedExperience = text(request.relatedExperience || request.reason, 2000);
  if (!message || !canOffer) throw codedError("VALIDATION_ERROR", "请填写想参与什么和你能提供什么");
  if (useRdb()) {
    const projects = await rdbSelect("projects", "*", (request) =>
      request.eq("id", projectId).eq("visibility", "public").limit(1)
    );
    const project = projects[0];
    if (!project) throw codedError("PROJECT_NOT_FOUND", "项目不存在或暂不开放申请");
    const existing = await rdbSelect("project_applications", "*", (request) =>
      request.eq("project_id", projectId).eq("user_id", user.id).limit(1)
    );
    const summary = "小秘书已收到申请，正在整理你的资料和可信证据。审核结果会通过站内信通知。";
    const payload = {
      project_id: projectId,
      user_id: user.id,
      message,
      can_offer: canOffer,
      related_experience: relatedExperience,
      ai_review_status: "pending",
      ai_review_summary: summary,
      status: "pending_secretary_review",
    };
    if (existing[0]) {
      await rdbUpdate("project_applications", payload, (request) => request.eq("id", existing[0].id));
    } else {
      await rdbInsert("project_applications", payload);
    }
    const rows = await rdbSelect("project_applications", "id", (request) =>
      request.eq("project_id", projectId).eq("user_id", user.id).limit(1)
    );
    const applicationId = rows[0] ? rows[0].id : existing[0] && existing[0].id;
    if (applicationId) {
      await rdbInsert("in_app_notifications", {
        user_id: user.id,
        project_id: projectId,
        type: "project_review",
        title: "项目申请已提交",
        content: `你对「${project.name}」的申请已提交。小秘书会先整理资料，结果会通过站内信通知。`,
        related_id: applicationId,
      });
    }
    return { applicationId, aiReviewStatus: "pending", aiSummary: summary, queued: true };
  }
  const projects = await query("SELECT * FROM projects WHERE id=? AND visibility='public' LIMIT 1", [projectId]);
  if (!projects[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在或暂不开放申请");
  const summary = "小秘书已收到申请，正在整理你的资料和可信证据。审核结果会通过站内信通知。";
  const result = await query(
    `INSERT INTO project_applications
     (project_id,user_id,message,can_offer,related_experience,ai_review_status,ai_review_summary,status)
     VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE message=VALUES(message),can_offer=VALUES(can_offer),
      related_experience=VALUES(related_experience),ai_review_status=VALUES(ai_review_status),
      ai_review_summary=VALUES(ai_review_summary),status=VALUES(status),updated_at=NOW()`,
    [projectId, user.id, message, canOffer, relatedExperience, "pending", summary, "pending_secretary_review"]
  );
  const applicationRows = await query("SELECT id FROM project_applications WHERE project_id=? AND user_id=? LIMIT 1", [projectId, user.id]);
  const applicationId = applicationRows[0] ? applicationRows[0].id : result.insertId || 0;
  if (applicationId) {
    await query(
      `INSERT INTO in_app_notifications (user_id,project_id,type,title,content,related_id)
       VALUES (?,?,'project_review','项目申请已提交',?,?)`,
      [user.id, projectId, `你对「${projects[0].name}」的申请已提交。小秘书会先整理资料，结果会通过站内信通知。`, applicationId]
    );
  }
  return { applicationId, aiReviewStatus: "pending", aiSummary: summary, queued: true };
}

async function processProjectApplicationReviews(event, user) {
  if (event.schedulerSecret) {
    if (!process.env.SCHEDULER_SECRET || event.schedulerSecret !== process.env.SCHEDULER_SECRET) {
      throw codedError("FORBIDDEN", "定时任务密钥不正确");
    }
  } else {
    await requireAdmin(user);
  }
  const limit = Math.min(Math.max(Number(event.limit || 3), 1), 10);
  if (useRdb()) return processProjectApplicationReviewsRdb(limit);
  return processProjectApplicationReviewsMysql(limit);
}

async function processProjectApplicationReviewsRdb(limit) {
  const applications = await rdbSelect("project_applications", "*", (request) =>
    request
      .eq("ai_review_status", "pending")
      .eq("status", "pending_secretary_review")
      .order("updated_at", { ascending: true })
      .limit(limit)
  );
  let completed = 0;
  let failed = 0;
  const results = [];
  for (const application of applications) {
    try {
      const [project, applicant] = await Promise.all([
        findProjectById(application.project_id),
        findUserById(application.user_id),
      ]);
      const identity = await getMyIdentity({}, applicant);
      const review = await runProjectApplicationAiReview({
        user: applicant,
        project,
        application: {
          message: application.message,
          canOffer: application.can_offer,
          relatedExperience: application.related_experience,
        },
        identity,
      });
      const nextStatus = review.status === "pass" ? "pending_owner_review" : "pending_secretary_review";
      await rdbUpdate(
        "project_applications",
        {
          ai_review_status: review.status,
          ai_review_summary: review.summary,
          status: nextStatus,
        },
        (request) => request.eq("id", application.id)
      );
      await rdbInsert("in_app_notifications", {
        user_id: applicant.id,
        project_id: project.id,
        type: "project_review",
        title: review.status === "pass" ? "项目申请已通过小秘书初筛" : "项目申请已完成小秘书初筛",
        content: review.status === "pass"
          ? `你对「${project.name}」的申请已通过小秘书初筛，接下来等待主理人确认。${review.summary}`
          : `你对「${project.name}」的申请已进入秘书审核。${review.summary}`,
        related_id: application.id,
      });
      if (review.status === "pass" && project.creator_user_id) {
        await rdbInsert("in_app_notifications", {
          user_id: project.creator_user_id,
          project_id: project.id,
          type: "project_review",
          title: "有新的项目参与申请",
          content: `「${project.name}」有新的申请已通过小秘书初筛：${review.summary}`,
          related_id: application.id,
        });
      }
      completed += 1;
      results.push({ applicationId: application.id, status: review.status, summary: review.summary });
    } catch (err) {
      failed += 1;
      await rdbUpdate(
        "project_applications",
        {
          ai_review_status: "revise",
          ai_review_summary: `小秘书暂时没有完成自动初筛：${text(err.message, 300)}。已转人工秘书处理。`,
          status: "pending_secretary_review",
        },
        (request) => request.eq("id", application.id)
      ).catch(() => null);
      results.push({ applicationId: application.id, error: err.message });
    }
  }
  return { checked: applications.length, completed, failed, results };
}

async function processProjectApplicationReviewsMysql(limit) {
  const applications = await query(
    `SELECT * FROM project_applications
     WHERE ai_review_status='pending' AND status='pending_secretary_review'
     ORDER BY updated_at ASC LIMIT ?`,
    [limit]
  );
  let completed = 0;
  let failed = 0;
  const results = [];
  for (const application of applications) {
    try {
      const [project, applicant] = await Promise.all([
        findProjectById(application.project_id),
        findUserById(application.user_id),
      ]);
      const identity = await getMyIdentity({}, applicant);
      const review = await runProjectApplicationAiReview({
        user: applicant,
        project,
        application: {
          message: application.message,
          canOffer: application.can_offer,
          relatedExperience: application.related_experience,
        },
        identity,
      });
      const nextStatus = review.status === "pass" ? "pending_owner_review" : "pending_secretary_review";
      await query(
        "UPDATE project_applications SET ai_review_status=?, ai_review_summary=?, status=?, updated_at=NOW() WHERE id=?",
        [review.status, review.summary, nextStatus, application.id]
      );
      await query(
        `INSERT INTO in_app_notifications (user_id,project_id,type,title,content,related_id)
         VALUES (?,?,'project_review',?,?,?)`,
        [
          applicant.id,
          project.id,
          review.status === "pass" ? "项目申请已通过小秘书初筛" : "项目申请已完成小秘书初筛",
          review.status === "pass"
            ? `你对「${project.name}」的申请已通过小秘书初筛，接下来等待主理人确认。${review.summary}`
            : `你对「${project.name}」的申请已进入秘书审核。${review.summary}`,
          application.id,
        ]
      );
      if (review.status === "pass" && project.creator_user_id) {
        await query(
          `INSERT INTO in_app_notifications (user_id,project_id,type,title,content,related_id)
           VALUES (?,?,'project_review','有新的项目参与申请',?,?)`,
          [project.creator_user_id, project.id, `「${project.name}」有新的申请已通过小秘书初筛：${review.summary}`, application.id]
        );
      }
      completed += 1;
      results.push({ applicationId: application.id, status: review.status, summary: review.summary });
    } catch (err) {
      failed += 1;
      await query(
        "UPDATE project_applications SET ai_review_status='revise', ai_review_summary=?, status='pending_secretary_review', updated_at=NOW() WHERE id=?",
        [`小秘书暂时没有完成自动初筛：${text(err.message, 300)}。已转人工秘书处理。`, application.id]
      ).catch(() => null);
      results.push({ applicationId: application.id, error: err.message });
    }
  }
  return { checked: applications.length, completed, failed, results };
}

async function toggleWatch(event, user) {
  const projectId = id(event.projectId);
  const role = await projectRole(projectId, user.id);
  if (role.visibility !== "public") throw codedError("FORBIDDEN", "私密项目不能围观");
  if (useRdb()) {
    const rows = await rdbSelect("project_watchers", "*", (request) =>
      request.eq("project_id", projectId).eq("user_id", user.id).limit(1)
    );
    const existing = rows[0];
    const watching = !(existing && existing.status === "watching");
    const payload = { project_id: projectId, user_id: user.id, status: watching ? "watching" : "cancelled" };
    if (existing) {
      await rdbUpdate("project_watchers", payload, (request) => request.eq("id", existing.id));
    } else {
      await rdbInsert("project_watchers", payload);
    }
    const watchers = await rdbSelect("project_watchers", "id", (request) =>
      request.eq("project_id", projectId).eq("status", "watching").limit(10000)
    );
    const total = watchers.length;
    await rdbUpdate("projects", { watch_count: total, star_count: total }, (request) => request.eq("id", projectId));
    return { watching, starCount: total, watchCount: total };
  }
  return transaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT id, status FROM project_watchers WHERE project_id = ? AND user_id = ? FOR UPDATE",
      [projectId, user.id]
    );
    const watching = !(rows[0] && rows[0].status === "watching");
    await connection.execute(
      `INSERT INTO project_watchers (project_id, user_id, status) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [projectId, user.id, watching ? "watching" : "cancelled"]
    );
    const [countRows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM project_watchers WHERE project_id = ? AND status = 'watching'",
      [projectId]
    );
    const total = Number(countRows[0].total);
    await connection.execute("UPDATE projects SET watch_count = ?, star_count = ? WHERE id = ?", [total, total, projectId]);
    return { watching, starCount: total, watchCount: total };
  });
}

async function publishUpdate(event, user) {
  const projectId = id(event.projectId);
  await requireProjectMember(projectId, user.id);
  const input = event.update || {};
  const title = text(input.title, 180);
  const content = text(input.content, 10000);
  if (!title || !content) throw codedError("VALIDATION_ERROR", "进度标题和内容不能为空");
  const visibility = input.visibility === "public" ? "public" : "project_members";
  const result = await query(
    `INSERT INTO project_updates (project_id, creator_user_id, title, content, visibility, update_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, user.id, title, content, visibility, text(input.updateType, 40) || "progress"]
  );
  return { updateId: result.insertId };
}

async function updateProjectUpdate(event, user) {
  const projectId = id(event.projectId);
  const updateId = id(event.updateId);
  const role = await requireProjectMember(projectId, user.id);
  const rows = await query("SELECT * FROM project_updates WHERE id=? AND project_id=? LIMIT 1", [updateId, projectId]);
  const existing = rows[0];
  if (!existing) throw codedError("UPDATE_NOT_FOUND", "这条项目进度不存在");
  const canEdit = role.isCreator || user.is_admin || Number(existing.creator_user_id) === Number(user.id);
  if (!canEdit) throw codedError("FORBIDDEN", "只有项目主理人、管理员或发布者可以编辑项目进度");
  const input = event.update || {};
  const title = text(input.title, 180);
  const content = text(input.content, 10000);
  if (!title || !content) throw codedError("VALIDATION_ERROR", "进度标题和内容不能为空");
  const visibility = input.visibility === "public" ? "public" : "project_members";
  await query(
    "UPDATE project_updates SET title=?, content=?, visibility=?, update_type=?, updated_at=NOW() WHERE id=? AND project_id=?",
    [title, content, visibility, text(input.updateType, 40) || existing.update_type || "progress", updateId, projectId]
  );
  return { updateId };
}

async function createMeetingRequest(event, user) {
  const projectId = id(event.projectId);
  const projects = await query("SELECT creator_user_id, name, description FROM projects WHERE id = ? LIMIT 1", [projectId]);
  if (!projects[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
  if (Number(projects[0].creator_user_id) === Number(user.id)) throw codedError("INVALID_REQUEST", "不能向自己发起约见");
  const request = event.request || {};
  const message = text(request.message, 3000);
  const canOffer = text(request.canOffer, 2000);
  const reason = text(request.reason, 2000);
  if (!message || !reason) throw codedError("VALIDATION_ERROR", "请说明想聊什么和为什么想见");

  let summary = `想围绕「${projects[0].name}」交流：${reason}${canOffer ? `；可提供：${canOffer}` : ""}`;
  let recommendation = "neutral";
  try {
    const generated = await callAi({
      task: "meeting_request",
      instruction: "用不超过120字总结约见请求，并给出 notify、revise 或 neutral 建议。只返回JSON。",
      payload: { project: projects[0], message, canOffer, reason }
    });
    if (generated && generated.summary) summary = text(generated.summary, 1000);
    if (["notify", "revise", "neutral"].includes(generated.recommendation)) recommendation = generated.recommendation;
  } catch (err) {
    console.warn("meeting request AI fallback", err.message);
  }
  return transaction(async (connection) => {
    const [result] = await connection.execute(
      `INSERT INTO meeting_requests
       (requester_user_id, target_user_id, project_id, request_type, message, can_offer, reason, ai_summary, ai_recommendation, status)
       VALUES (?, ?, ?, 'join_project', ?, ?, ?, ?, ?, 'pending_owner_review')`,
      [user.id, projects[0].creator_user_id, projectId, message, canOffer, reason, summary, recommendation]
    );
    await connection.execute(
      `INSERT INTO in_app_notifications
       (user_id, project_id, type, title, content, related_id)
       VALUES (?, ?, 'meeting_request', ?, ?, ?)`,
      [projects[0].creator_user_id, projectId, `新的约见请求：${projects[0].name}`, summary, result.insertId]
    );
    return { requestId: result.insertId, aiSummary: summary, aiRecommendation: recommendation };
  });
}

async function respondMeetingRequest(event, user) {
  const requestId = id(event.requestId);
  const decision = event.decision === "accepted" ? "accepted" : "rejected";
  const rows = await query("SELECT * FROM meeting_requests WHERE id = ? LIMIT 1", [requestId]);
  const request = rows[0];
  if (!request || Number(request.target_user_id) !== Number(user.id)) throw codedError("FORBIDDEN", "无权处理该约见请求");
  await query("UPDATE meeting_requests SET status = ? WHERE id = ?", [decision, requestId]);
  await query(
    `INSERT INTO in_app_notifications (user_id, project_id, type, title, content, related_id)
     VALUES (?, ?, 'meeting_request', ?, ?, ?)`,
    [
      request.requester_user_id,
      request.project_id,
      decision === "accepted" ? "约见请求已接受" : "约见请求暂未接受",
      decision === "accepted" ? "请在线下继续确认见面时间。AI 秘书不会代替双方聊天。" : "你可以完善合作理由后再发起新的请求。",
      requestId
    ]
  );
  return { status: decision };
}

async function respondProjectApplication(event, user) {
  const applicationId = id(event.applicationId);
  const decision = event.decision === "accepted" ? "accepted" : "rejected";
  const rows = await query(
    `SELECT pa.*, p.creator_user_id, p.name AS project_name
     FROM project_applications pa
     JOIN projects p ON p.id = pa.project_id
     WHERE pa.id = ? LIMIT 1`,
    [applicationId]
  );
  const application = rows[0];
  if (!application || (Number(application.creator_user_id) !== Number(user.id) && !user.is_admin)) {
    throw codedError("FORBIDDEN", "无权处理该项目申请");
  }
  await transaction(async (connection) => {
    await connection.execute("UPDATE project_applications SET status = ? WHERE id = ?", [decision, applicationId]);
    if (decision === "accepted") {
      await connection.execute(
        `INSERT INTO project_members (project_id, user_id, role, status, invited_by)
         VALUES (?, ?, 'member', 'invited', ?)
         ON DUPLICATE KEY UPDATE status='invited', invited_by=VALUES(invited_by), updated_at=NOW()`,
        [application.project_id, application.user_id, user.id]
      );
    }
    await connection.execute(
      `INSERT INTO in_app_notifications (user_id, project_id, type, title, content, related_id)
       VALUES (?, ?, 'project_application', ?, ?, ?)`,
      [
        application.user_id,
        application.project_id,
        decision === "accepted" ? "项目申请已通过" : "项目申请暂未通过",
        decision === "accepted"
          ? `主理人已同意你的申请，请进入小秘书待处理里确认加入「${application.project_name}」。`
          : `「${application.project_name}」暂未通过你的申请，可以补充资料后再试。`,
        applicationId,
      ]
    );
  });
  return { status: decision };
}

async function inviteMember(event, user) {
  const projectId = id(event.projectId);
  const role = await projectRole(projectId, user.id);
  if (!role.isCreator && !user.is_admin) throw codedError("FORBIDDEN", "只有项目主理人可以邀请入局");
  const targetUserId = id(event.userId);
  const memberRole = ["member", "observer", "advisor", "executor", "resource_provider"].includes(event.role) ? event.role : "member";
  await query(
    `INSERT INTO project_members (project_id, user_id, role, status, invited_by)
     VALUES (?, ?, ?, 'invited', ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'invited', invited_by = VALUES(invited_by), updated_at = NOW()`,
    [projectId, targetUserId, memberRole, user.id]
  );
  await query(
    `INSERT INTO in_app_notifications (user_id, project_id, type, title, content)
     SELECT ?, id, 'project_invitation', CONCAT('项目邀请：', name), '主理人邀请你线下确认后加入项目协作空间。'
     FROM projects WHERE id = ?`,
    [targetUserId, projectId]
  );
  return { status: "invited" };
}

async function acceptProjectInvitation(event, user) {
  const projectId = id(event.projectId);
  const result = await query(
    `UPDATE project_members SET status = 'active', joined_at = NOW()
     WHERE project_id = ? AND user_id = ? AND status = 'invited'`,
    [projectId, user.id]
  );
  if (!result.affectedRows) throw codedError("INVITATION_NOT_FOUND", "没有待接受的项目邀请");
  await query(
    `INSERT INTO evidence_records
     (user_id, project_id, source_type, source_id, evidence_type, content, evidence_level, confidence, visibility, status, created_by)
     VALUES (?, ?, 'project_members', ?, 'project_member', '用户已接受项目邀请并入局', 'platform_observed', 1, 'match_only', 'confirmed', ?)`,
    [user.id, projectId, projectId, user.id]
  );
  return { status: "active" };
}

async function listEvents(event, user) {
  const memberships = await getCommunityMemberships(user.id);
  const allowedCommunityIds = new Set(memberships.map((item) => Number(item.community_id)).filter(Boolean));
  const canSeeEvent = (item) => {
    const communityId = Number(item.community_id || 0);
    return !communityId || user.is_admin || allowedCommunityIds.has(communityId);
  };
  if (useRdb()) {
    const events = await rdbSelect("official_events", "*", (request) =>
      request
        .eq("visibility", "public")
        .in("status", ["published", "closed"])
        .order("official_sort_weight", { ascending: false })
        .order("start_time", { ascending: true })
        .limit(200)
    ).then((rows) => rows.filter(canSeeEvent).slice(0, 50));
    const eventIds = events.map((item) => Number(item.id)).filter(Boolean);
    const hostIds = unique(events.map((item) => item.host_user_id)).map(Number).filter(Boolean);
    const [hosts, registrations] = await Promise.all([
      hostIds.length ? rdbSelect("users", "id,display_name", (request) => request.in("id", hostIds)) : Promise.resolve([]),
      eventIds.length ? rdbSelect("event_registrations", "*", (request) => request.in("event_id", eventIds)) : Promise.resolve([]),
    ]);
    const hostMap = new Map(hosts.map((item) => [Number(item.id), item.display_name]));
    const myRegistrationMap = new Map();
    const countMap = new Map();
    registrations.forEach((item) => {
      if (Number(item.user_id) === Number(user.id)) myRegistrationMap.set(Number(item.event_id), item.status);
      if (["registered", "approved"].includes(item.status)) {
        countMap.set(Number(item.event_id), (countMap.get(Number(item.event_id)) || 0) + 1);
      }
    });
    return {
      events: events.map((item) => ({
        ...item,
        host_name: hostMap.get(Number(item.host_user_id)) || "",
        registration_status: myRegistrationMap.get(Number(item.id)) || null,
        registration_count: countMap.get(Number(item.id)) || 0,
      }))
    };
  }
  const allowedIds = Array.from(allowedCommunityIds);
  const communityWhere = user.is_admin
    ? ""
    : allowedIds.length
      ? ` AND (e.community_id IS NULL OR e.community_id IN (${allowedIds.map(() => "?").join(",")}))`
      : " AND e.community_id IS NULL";
  const rows = await query(
    `SELECT e.*, u.display_name AS host_name, er.status AS registration_status,
      (SELECT COUNT(*) FROM event_registrations x WHERE x.event_id = e.id AND x.status IN ('registered','approved')) AS registration_count
     FROM official_events e JOIN users u ON u.id = e.host_user_id
     LEFT JOIN event_registrations er ON er.event_id = e.id AND er.user_id = ?
     WHERE e.visibility = 'public' AND e.status IN ('published','closed')${communityWhere}
     ORDER BY e.official_sort_weight DESC, e.start_time ASC LIMIT 50`,
    [user.id, ...(user.is_admin ? [] : allowedIds)]
  );
  return { events: rows };
}

async function registerEvent(event, user) {
  const eventId = id(event.eventId);
  if (useRdb()) {
    const rows = await rdbSelect("official_events", "*", (request) => request.eq("id", eventId).limit(1));
    const item = rows[0];
    if (!item || item.status !== "published") throw codedError("EVENT_CLOSED", "活动当前不可报名");
    const communityId = Number(item.community_id || 0);
    if (communityId && !user.is_admin) {
      const memberships = await getCommunityMemberships(user.id);
      const hasAccess = memberships.some((membership) => Number(membership.community_id) === communityId);
      if (!hasAccess) throw codedError("FORBIDDEN", "只有该社区成员可以报名这个活动");
    }
    const registrations = await rdbSelect("event_registrations", "*", (request) => request.eq("event_id", eventId).limit(1000));
    const registeredCount = registrations.filter((registration) => ["registered", "approved"].includes(registration.status)).length;
    if (item.capacity && registeredCount >= Number(item.capacity)) throw codedError("EVENT_FULL", "活动名额已满");
    const existing = registrations.find((registration) => Number(registration.user_id) === Number(user.id));
    if (existing) {
      await rdbUpdate("event_registrations", { status: "registered" }, (request) => request.eq("id", existing.id));
    } else {
      await rdbInsert("event_registrations", {
        event_id: eventId,
        user_id: user.id,
        status: "registered",
      });
    }
    return { status: "registered" };
  }
  const rows = await query(
    `SELECT e.*, (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id=e.id AND r.status IN ('registered','approved')) AS registered
     FROM official_events e WHERE e.id = ? LIMIT 1`,
    [eventId]
  );
  const item = rows[0];
  if (!item || item.status !== "published") throw codedError("EVENT_CLOSED", "活动当前不可报名");
  if (item.community_id && !user.is_admin) {
    const memberships = await getCommunityMemberships(user.id);
    const hasAccess = memberships.some((membership) => Number(membership.community_id) === Number(item.community_id));
    if (!hasAccess) throw codedError("FORBIDDEN", "只有该社区成员可以报名这个活动");
  }
  if (item.capacity && Number(item.registered) >= Number(item.capacity)) throw codedError("EVENT_FULL", "活动名额已满");
  await query(
    `INSERT INTO event_registrations (event_id, user_id, status) VALUES (?, ?, 'registered')
     ON DUPLICATE KEY UPDATE status = 'registered', updated_at = NOW()`,
    [eventId, user.id]
  );
  return { status: "registered" };
}

async function getAgentProfile(event, user) {
  const profiles = await query("SELECT * FROM user_agent_profiles WHERE user_id = ? LIMIT 1", [user.id]);
  const memories = await query(
    "SELECT * FROM user_agent_memories WHERE user_id = ? AND status = 'confirmed' ORDER BY updated_at DESC LIMIT 30",
    [user.id]
  );
  const profile = profiles[0] || {};
  ["current_goals_json", "can_offer_json", "looking_for_json", "not_interested_in_json", "preferred_project_types_json"].forEach((key) => {
    profile[key] = parseJson(profile[key], []);
  });
  return { profile, memories };
}

async function saveAgentProfile(event, user) {
  const profile = event.profile || {};
  await query(
    `INSERT INTO user_agent_profiles
     (user_id, public_intro, current_role, current_goals_json, can_offer_json, looking_for_json,
      not_interested_in_json, preferred_project_types_json, collaboration_style, allow_matchmaking, allow_ai_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE public_intro=VALUES(public_intro), current_role=VALUES(current_role),
      current_goals_json=VALUES(current_goals_json), can_offer_json=VALUES(can_offer_json),
      looking_for_json=VALUES(looking_for_json), not_interested_in_json=VALUES(not_interested_in_json),
      preferred_project_types_json=VALUES(preferred_project_types_json), collaboration_style=VALUES(collaboration_style),
      allow_matchmaking=VALUES(allow_matchmaking), allow_ai_profile=VALUES(allow_ai_profile), updated_at=NOW()`,
    [
      user.id,
      text(profile.publicIntro, 3000),
      text(profile.currentRole, 120),
      json(profile.currentGoals),
      json(profile.canOffer),
      json(profile.lookingFor),
      json(profile.notInterestedIn),
      json(profile.preferredProjectTypes),
      text(profile.collaborationStyle, 3000),
      profile.allowMatchmaking === false ? 0 : 1,
      profile.allowAiProfile === false ? 0 : 1
    ]
  );
  return { saved: true };
}

async function listNotifications(event, user) {
  if (useRdb()) {
    const notifications = await rdbSelect("in_app_notifications", "*", (request) =>
      request.eq("user_id", user.id).order("created_at", { ascending: false }).limit(100)
    );
    return { notifications, meetingRequests: [], invitations: [], projectApplications: [] };
  }
  const notifications = await query(
    "SELECT * FROM in_app_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [user.id]
  );
  const meetingRequests = await query(
    `SELECT mr.*, p.name AS project_name, u.display_name AS requester_name
     FROM meeting_requests mr
     LEFT JOIN projects p ON p.id = mr.project_id
     JOIN users u ON u.id = mr.requester_user_id
     WHERE mr.target_user_id = ? AND mr.status = 'pending_owner_review'
     ORDER BY mr.created_at DESC LIMIT 30`,
    [user.id]
  );
  const invitations = await query(
    `SELECT pm.project_id, pm.role, pm.status, p.name AS project_name
     FROM project_members pm JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = ? AND pm.status = 'invited' ORDER BY pm.created_at DESC`,
    [user.id]
  );
  const projectApplications = await query(
    `SELECT pa.*, p.name AS project_name, u.display_name AS requester_name
     FROM project_applications pa
     JOIN projects p ON p.id = pa.project_id
     JOIN users u ON u.id = pa.user_id
     WHERE p.creator_user_id = ? AND pa.status = 'pending_owner_review'
     ORDER BY pa.updated_at DESC LIMIT 30`,
    [user.id]
  );
  return { notifications, meetingRequests, invitations, projectApplications };
}

async function markNotificationRead(event, user) {
  await query(
    "UPDATE in_app_notifications SET read_status='read', read_at=NOW() WHERE id=? AND user_id=?",
    [id(event.notificationId), user.id]
  );
  return { read: true };
}

async function getProjectSpace(event, user) {
  const projectId = id(event.projectId);
  const role = await requireProjectMember(projectId, user.id);
  const [projects, members, updates, records, intents, events, inviteCandidates] = await Promise.all([
    query("SELECT * FROM projects WHERE id = ? LIMIT 1", [projectId]),
    query(
      `SELECT pm.*, u.display_name, u.avatar_url FROM project_members pm JOIN users u ON u.id=pm.user_id
       WHERE pm.project_id=? AND pm.status IN ('active','invited') ORDER BY pm.role='creator' DESC, pm.joined_at`,
      [projectId]
    ),
    query("SELECT * FROM project_updates WHERE project_id=? AND visibility IN ('project_members','public') ORDER BY created_at DESC LIMIT 50", [
      projectId,
    ]),
    query("SELECT id,title,record_type,ai_process_status,created_at FROM project_records WHERE project_id=? ORDER BY created_at DESC LIMIT 50", [projectId]),
    query("SELECT * FROM reminder_intents WHERE project_id=? AND status='pending' ORDER BY created_at DESC LIMIT 50", [projectId]),
    query("SELECT * FROM project_events WHERE project_id=? AND status='active' ORDER BY start_time ASC LIMIT 50", [projectId]),
    role.isCreator || user.is_admin
      ? query(
          `SELECT mr.requester_user_id AS user_id,u.display_name,mr.id AS meeting_request_id,mr.ai_summary
           FROM meeting_requests mr JOIN users u ON u.id=mr.requester_user_id
           LEFT JOIN project_members pm ON pm.project_id=mr.project_id AND pm.user_id=mr.requester_user_id AND pm.status='active'
           WHERE mr.project_id=? AND mr.target_user_id=? AND mr.status='accepted' AND pm.id IS NULL
           ORDER BY mr.updated_at DESC LIMIT 50`,
          [projectId, user.id]
        )
      : Promise.resolve([])
  ]);
  return { project: projects[0], members, updates, records, reminderIntents: intents, projectEvents: events, inviteCandidates };
}

async function extractFileText(file) {
  const extension = text(file.fileType, 10).toLowerCase();
  if (!ALLOWED_FILE_TYPES.has(extension)) throw codedError("FILE_TYPE_NOT_ALLOWED", "仅支持 txt、md、docx、pdf");
  if (Number(file.fileSize || 0) > MAX_FILE_SIZE) throw codedError("FILE_TOO_LARGE", "文件不能超过 10MB");
  const download = await cloud.downloadFile({ fileID: file.storageKey });
  if (extension === "txt" || extension === "md") return download.fileContent.toString("utf8");
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer: download.fileContent });
    return result.value;
  }
  const result = await pdfParse(download.fileContent);
  return result.text;
}

async function createProjectRecord(event, user) {
  const projectId = id(event.projectId);
  await requireProjectMember(projectId, user.id);
  const record = event.record || {};
  const title = text(record.title, 180);
  let rawText = text(record.rawText, 100000);
  if (!title) throw codedError("VALIDATION_ERROR", "记录标题不能为空");
  let fileId = null;
  if (record.file) {
    const file = record.file;
    const extension = text(file.fileType, 10).toLowerCase();
    if (!ALLOWED_FILE_TYPES.has(extension)) throw codedError("FILE_TYPE_NOT_ALLOWED", "仅支持 txt、md、docx、pdf");
    const result = await query(
      `INSERT INTO uploaded_files
       (project_id,uploader_user_id,file_name,file_type,file_size,storage_key,text_extract_status)
       VALUES (?,?,?,?,?,?,'processing')`,
      [projectId, user.id, text(file.fileName, 255), extension, Number(file.fileSize || 0), text(file.storageKey, 512)]
    );
    fileId = result.insertId;
    try {
      rawText = await extractFileText({ ...file, storageKey: text(file.storageKey, 512) });
      await query("UPDATE uploaded_files SET text_extract_status='completed' WHERE id=?", [fileId]);
    } catch (err) {
      await query("UPDATE uploaded_files SET text_extract_status='failed' WHERE id=?", [fileId]);
      throw err;
    }
  }
  if (!rawText) throw codedError("VALIDATION_ERROR", "请粘贴文字或上传文件");
  const result = await query(
    `INSERT INTO project_records
     (project_id,uploader_user_id,record_type,title,raw_text,file_id,visibility,ai_process_status)
     VALUES (?,?,?,?,?,?,?,'pending')`,
    [
      projectId,
      user.id,
      text(record.recordType, 40) || "manual_note",
      title,
      rawText,
      fileId,
      record.visibility === "admin_only" ? "admin_only" : "project_members"
    ]
  );
  try {
    await transaction(async (connection) => {
      await upsertRagSource(connection, {
        sourceType: "project_record",
        sourceId: result.insertId,
        ownerUserId: user.id,
        projectId,
        title,
        summary: truncate(rawText, 500),
        tags: parseTags(record.tagsText || record.tags || ""),
        visibility: record.visibility === "admin_only" ? "admin_only" : "project_visible",
        content: rawText,
        metadata: { recordType: text(record.recordType, 40) || "manual_note", fileId },
      });
    });
  } catch (err) {
    console.warn("rag index project record fallback", err.message);
  }
  return { recordId: result.insertId };
}

async function analyzeProjectRecord(event, user) {
  const recordId = id(event.recordId);
  const records = await query("SELECT * FROM project_records WHERE id=? LIMIT 1", [recordId]);
  const record = records[0];
  if (!record) throw codedError("RECORD_NOT_FOUND", "项目记录不存在");
  await requireProjectMember(record.project_id, user.id);
  const jobs = await query(
    `INSERT INTO ai_jobs (job_type,project_id,source_record_id,status,input_payload,started_at)
     VALUES ('extract_project_record',?,?, 'processing', ?, NOW())`,
    [record.project_id, recordId, json({ title: record.title, rawText: record.raw_text })]
  );
  const jobId = jobs.insertId;
  await query("UPDATE project_records SET ai_process_status='processing' WHERE id=?", [recordId]);
  try {
    const output = await callAi({
      task: "extract_project_record",
      instruction:
        "从项目记录抽取摘要、公开进度草稿、会议、任务、用户观察和记忆候选。严格按给定JSON结构输出。所有会议和任务needs_confirmation必须为true，保留source_quote，时区固定Asia/Shanghai，时间不明确时normalized字段返回null。",
      schema: aiOutputSchema,
      payload: { title: record.title, rawText: record.raw_text, timezone: TIMEZONE }
    });
    if (!validateAiOutput(output)) {
      throw codedError("AI_SCHEMA_INVALID", "AI 输出未通过 JSON schema 校验", validateAiOutput.errors);
    }
    await transaction(async (connection) => {
      await connection.execute(
        "UPDATE ai_jobs SET status='completed',output_payload=?,completed_at=NOW() WHERE id=?",
        [json(output), jobId]
      );
      await connection.execute("UPDATE project_records SET ai_process_status='completed' WHERE id=?", [recordId]);
      if (output.public_update_draft.title && output.public_update_draft.content) {
        await connection.execute(
          `INSERT INTO project_updates
           (project_id,creator_user_id,title,content,visibility,update_type,source_record_id,status)
           VALUES (?,?,?,?,?,'meeting_summary',?,'draft')`,
          [
            record.project_id,
            user.id,
            output.public_update_draft.title,
            output.public_update_draft.content,
            output.public_update_draft.suggested_visibility,
            recordId
          ]
        );
      }
      const intents = [
        ...output.detected_events.map((item) => ({
          type: item.type === "meeting" ? "meeting" : item.type,
          title: item.title,
          timeText: item.time_text,
          normalizedTime: item.normalized_time,
          participants: item.participants,
          quote: item.source_quote,
          confidence: item.confidence
        })),
        ...output.detected_tasks.map((item) => ({
          type: "task_deadline",
          title: item.title,
          timeText: item.deadline_text,
          normalizedTime: item.normalized_deadline,
          participants: item.assignee ? [item.assignee] : [],
          quote: item.source_quote,
          confidence: item.confidence
        }))
      ];
      for (const item of intents) {
        await connection.execute(
          `INSERT INTO reminder_intents
           (project_id,source_record_id,type,title,time_text,normalized_time,timezone,participants_json,source_quote,confidence,status,created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)`,
          [
            record.project_id,
            recordId,
            item.type,
            item.title,
            item.timeText,
            item.normalizedTime ? new Date(item.normalizedTime) : null,
            TIMEZONE,
            json(item.participants),
            item.quote,
            item.confidence,
            user.id
          ]
        );
      }
      for (const item of output.profile_memory_candidates) {
        const targetUserId = Number(item.user_id);
        if (!Number.isSafeInteger(targetUserId)) continue;
        await connection.execute(
          `INSERT INTO user_agent_memories
           (user_id,content,memory_type,source_type,source_id,evidence_level,confidence,visibility,status)
           VALUES (?,?,?,?,?,'conversation_observed',?,'private','candidate')`,
          [targetUserId, item.content, item.memory_type, "project_record", recordId, item.confidence]
        );
      }
    });
    return { jobId, output };
  } catch (err) {
    await query("UPDATE ai_jobs SET status='failed',error_message=?,completed_at=NOW() WHERE id=?", [text(err.message, 4000), jobId]);
    await query("UPDATE project_records SET ai_process_status='failed' WHERE id=?", [recordId]);
    throw err;
  }
}

async function confirmReminderIntent(event, user) {
  const intentId = id(event.intentId);
  const intents = await query("SELECT * FROM reminder_intents WHERE id=? LIMIT 1", [intentId]);
  const intent = intents[0];
  if (!intent) throw codedError("INTENT_NOT_FOUND", "提醒草稿不存在");
  await requireProjectMember(intent.project_id, user.id);
  const input = event.intent || {};
  const normalizedTime = input.normalizedTime || intent.normalized_time;
  if (!normalizedTime) throw codedError("TIME_CONFIRMATION_REQUIRED", "时间不明确，请先补充确认");
  return transaction(async (connection) => {
    await connection.execute(
      `UPDATE reminder_intents SET title=?,normalized_time=?,status=? WHERE id=?`,
      [text(input.title, 180) || intent.title, new Date(normalizedTime), input.edited ? "edited" : "confirmed", intentId]
    );
    const [result] = await connection.execute(
      `INSERT INTO project_events
       (project_id,title,description,start_time,timezone,created_by,source_intent_id)
       VALUES (?,?,?,?,?,?,?)`,
      [intent.project_id, text(input.title, 180) || intent.title, intent.source_quote, new Date(normalizedTime), TIMEZONE, user.id, intentId]
    );
    const [members] = await connection.execute(
      "SELECT user_id FROM project_members WHERE project_id=? AND status='active'",
      [intent.project_id]
    );
    for (const member of members) {
      await connection.execute(
        `INSERT INTO project_event_participants (event_id,user_id) VALUES (?,?)
         ON DUPLICATE KEY UPDATE updated_at=NOW()`,
        [result.insertId, member.user_id]
      );
      await connection.execute(
        `INSERT INTO in_app_notifications (user_id,project_id,type,title,content,related_id)
         VALUES (?,?,'schedule_reminder',?,?,?)`,
        [member.user_id, intent.project_id, `新日程：${text(input.title, 180) || intent.title}`, "请进入项目协作空间查看并自行授权微信提醒。", result.insertId]
      );
    }
    return { projectEventId: result.insertId };
  });
}

async function authorizeReminder(event, user) {
  if (!REMINDER_TEMPLATE_ID) throw codedError("TEMPLATE_NOT_CONFIGURED", "订阅消息模板尚未配置");
  const eventId = id(event.eventId);
  const participants = await query(
    "SELECT * FROM project_event_participants WHERE event_id=? AND user_id=? LIMIT 1",
    [eventId, user.id]
  );
  if (!participants[0]) throw codedError("FORBIDDEN", "你不是该日程参与人");
  await query(
    `INSERT INTO reminder_recipients
     (event_id,user_id,subscribe_template_id,subscribe_status,available_quota,last_authorized_at)
     VALUES (?,?,?,'accepted',1,NOW())
     ON DUPLICATE KEY UPDATE subscribe_status='accepted',available_quota=available_quota+1,last_authorized_at=NOW(),updated_at=NOW()`,
    [eventId, user.id, REMINDER_TEMPLATE_ID]
  );
  await query(
    "UPDATE project_event_participants SET reminder_status='authorized',subscribe_status='accepted' WHERE event_id=? AND user_id=?",
    [eventId, user.id]
  );
  return { authorized: true, templateId: REMINDER_TEMPLATE_ID };
}

async function getRecommendations(event, user) {
  if (useRdb()) {
    const explicit = await rdbSelect("recommendation_candidates", "*", (request) =>
      request.eq("user_id", user.id).in("status", ["pending", "shown"]).order("score", { ascending: false }).limit(20)
    );
    if (explicit.length) {
      const projectIds = explicit.filter((item) => item.target_type === "project").map((item) => Number(item.target_id)).filter(Boolean);
      const projects = projectIds.length ? await rdbSelect("projects", "id,name,description,star_count", (request) => request.in("id", projectIds)) : [];
      const projectMap = new Map(projects.map((item) => [Number(item.id), item]));
      return {
        recommendations: explicit.map((item) => ({
          ...item,
          ...(item.target_type === "project" && projectMap.get(Number(item.target_id)) ? projectMap.get(Number(item.target_id)) : {}),
        }))
      };
    }
    const fallback = await rdbSelect("projects", "id,name,description,star_count", (request) =>
      request
        .eq("visibility", "public")
        .eq("status", "active")
        .order("is_official_recommended", { ascending: false })
        .order("official_sort_weight", { ascending: false })
        .order("star_count", { ascending: false })
        .limit(10)
    );
    return {
      recommendations: fallback.map((project) => ({
        ...project,
        target_id: project.id,
        target_type: "project",
        reason_summary: `官方推荐 · ${project.star_count || 0} 人围观`,
      }))
    };
  }
  const explicit = await query(
    `SELECT rc.*, p.name, p.description, p.star_count
     FROM recommendation_candidates rc JOIN projects p ON rc.target_type='project' AND p.id=rc.target_id
     WHERE rc.user_id=? AND rc.status IN ('pending','shown')
     ORDER BY rc.score DESC LIMIT 20`,
    [user.id]
  );
  if (explicit.length) return { recommendations: explicit };
  const fallback = await query(
    `SELECT p.id AS target_id,'project' AS target_type,p.name,p.description,p.star_count,
      CONCAT('官方推荐 · ', p.star_count, ' 人围观') AS reason_summary
     FROM projects p WHERE p.visibility='public' AND p.status='active'
     ORDER BY p.is_official_recommended DESC,p.official_sort_weight DESC,p.star_count DESC LIMIT 10`
  );
  return { recommendations: fallback };
}

async function adminList(event, user) {
  await requireAdmin(user);
  if (useRdb()) {
    const [users, projects, applications, events, registrations, records, files, jobs, memories, evidence, requests, logs, adminLogs, ragSources, ragChunks, ragJobs] = await Promise.all([
      rdbSelect("users", "id,openid,public_user_code,display_name,avatar_url,status,is_admin,experience_points,created_at,updated_at", (request) => request.order("created_at", { ascending: false }).limit(100)),
      rdbSelect("projects", "*", (request) => request.order("updated_at", { ascending: false }).limit(100)),
      rdbSelect("project_applications", "*", (request) => request.order("created_at", { ascending: false }).limit(200)).catch(() => []),
      rdbSelect("official_events", "*", (request) => request.order("start_time", { ascending: false }).limit(100)),
      rdbSelect("event_registrations", "*", (request) => request.order("created_at", { ascending: false }).limit(100)),
      rdbSelect("project_records", "id,project_id,uploader_user_id,title,record_type,visibility,ai_process_status,created_at", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("uploaded_files", "*", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("ai_jobs", "id,job_type,status,error_message,created_at", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("user_agent_memories", "*", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("evidence_records", "*", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("meeting_requests", "*", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("notification_logs", "*", (request) => request.order("created_at", { ascending: false }).limit(100)).catch(() => []),
      rdbSelect("admin_logs", "*", (request) => request.order("created_at", { ascending: false }).limit(200)).catch(() => []),
      rdbSelect("rag_sources", "*", (request) => request.order("updated_at", { ascending: false }).limit(100)),
      rdbSelect("rag_chunks", "id,source_id,chunk_index,content_summary,vector_doc_id,evidence_polarity,confidence,status,updated_at", (request) => request.order("updated_at", { ascending: false }).limit(100)),
      rdbSelect("rag_index_jobs", "*", (request) => request.order("created_at", { ascending: false }).limit(100))
    ]);
    return {
      users,
      projects: projects.map((item) => ({ ...item, tags: parseJson(item.tags_json, []) })),
      projectApplications: applications,
      events,
      eventRegistrations: registrations,
      projectRecords: records,
      uploadedFiles: files,
      jobs,
      memories,
      evidence,
      meetingRequests: requests,
      notificationLogs: logs,
      adminLogs,
      ragSources,
      ragChunks,
      ragIndexJobs: ragJobs
    };
  }
  const [users, projects, applications, events, registrations, records, files, jobs, memories, evidence, requests, logs, adminLogs, ragSources, ragChunks, ragJobs] = await Promise.all([
    query("SELECT id,display_name,status,is_admin,created_at,updated_at FROM users ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 100"),
    query("SELECT * FROM project_applications ORDER BY created_at DESC LIMIT 200"),
    query("SELECT * FROM official_events ORDER BY start_time DESC LIMIT 100"),
    query("SELECT * FROM event_registrations ORDER BY created_at DESC LIMIT 100"),
    query("SELECT id,project_id,uploader_user_id,title,record_type,visibility,ai_process_status,created_at FROM project_records ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM uploaded_files ORDER BY created_at DESC LIMIT 100"),
    query("SELECT id,job_type,status,error_message,created_at FROM ai_jobs ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM user_agent_memories ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM evidence_records ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM meeting_requests ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT 100"),
    query("SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 200"),
    query("SELECT * FROM rag_sources ORDER BY updated_at DESC LIMIT 100"),
    query("SELECT id,source_id,chunk_index,content_summary,vector_doc_id,evidence_polarity,confidence,status,updated_at FROM rag_chunks ORDER BY updated_at DESC LIMIT 100"),
    query("SELECT * FROM rag_index_jobs ORDER BY created_at DESC LIMIT 100")
  ]);
  return {
    users,
    projects,
    projectApplications: applications,
    events,
    eventRegistrations: registrations,
    projectRecords: records,
    uploadedFiles: files,
    jobs,
    memories,
    evidence,
    meetingRequests: requests,
    notificationLogs: logs,
    adminLogs,
    ragSources,
    ragChunks,
    ragIndexJobs: ragJobs
  };
}

async function adminCreateProject(event, user) {
  await requireAdmin(user);
  const item = event.project || event.patch || {};
  const values = projectPayload(item, user.id);
  if (useRdb()) {
    await rdbInsert("projects", values);
    const rows = await rdbSelect("projects", "id", (request) =>
      request.eq("name", values.name).eq("creator_user_id", values.creator_user_id).order("created_at", { ascending: false }).limit(1)
    );
    const projectId = rows[0] ? Number(rows[0].id) : null;
    if (projectId) {
      await rdbUpsert("project_members", {
        project_id: projectId,
        user_id: values.creator_user_id,
        role: "creator",
        status: "active",
        invited_by: user.id,
        joined_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    }
    await adminLog(user, "create_project", "project", projectId, item);
    return { projectId };
  }
  const result = await query(
    `INSERT INTO projects
     (name,description,project_type,tags_json,ideal_participant,not_fit_participant,stage,goal,creator_user_id,community_id,visibility,status,official_sort_weight,is_official_recommended)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      values.name,
      values.description,
      values.project_type,
      values.tags_json,
      values.ideal_participant,
      values.not_fit_participant,
      values.stage,
      values.goal,
      values.creator_user_id,
      values.community_id,
      values.visibility,
      values.status,
      values.official_sort_weight,
      values.is_official_recommended,
    ]
  );
  await query(
    `INSERT INTO project_members (project_id,user_id,role,status,invited_by,joined_at)
     VALUES (?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE role=VALUES(role),status=VALUES(status),invited_by=VALUES(invited_by),joined_at=VALUES(joined_at)`,
    [result.insertId, values.creator_user_id, "creator", "active", user.id]
  );
  await adminLog(user, "create_project", "project", result.insertId, item);
  return { projectId: result.insertId };
}

async function adminReviewCandidate(event, user) {
  await requireAdmin(user);
  const targetType = event.targetType;
  const targetId = id(event.targetId);
  const status = ["candidate", "confirmed", "rejected"].includes(event.status) ? event.status : "candidate";
  const table = targetType === "memory" ? "user_agent_memories" : targetType === "evidence" ? "evidence_records" : "";
  if (!table) throw codedError("VALIDATION_ERROR", "仅支持审核 memory 或 evidence");
  if (useRdb()) {
    await rdbUpdate(table, { status }, (request) => request.eq("id", targetId));
    await adminLog(user, "review_candidate", targetType, targetId, { status });
    return { saved: true };
  }
  await query(`UPDATE ${table} SET status=? WHERE id=?`, [status, targetId]);
  await adminLog(user, "review_candidate", targetType, targetId, { status });
  return { saved: true };
}

function projectMemberReviewContent({ project, reviewer, reviewed, review }) {
  return [
    `项目：${project.name || project.id}`,
    `被评价成员：${reviewed.display_name || reviewed.id}`,
    `评价人：${reviewer.display_name || reviewer.id}`,
    review.role ? `项目角色：${review.role}` : "",
    review.contributionText ? `具体贡献：${review.contributionText}` : "",
    review.outcomeText ? `结果表现：${review.outcomeText}` : "",
    review.riskText ? `风险或不适合：${review.riskText}` : "",
    review.reliabilityScore ? `靠谱度评分：${review.reliabilityScore}/10` : "",
    review.collaborationScore ? `协作评分：${review.collaborationScore}/10` : "",
    review.deliveryScore ? `交付评分：${review.deliveryScore}/10` : "",
  ].filter(Boolean).join("\n");
}

async function findUserById(userId) {
  const rows = useRdb()
    ? await rdbSelect("users", "*", (request) => request.eq("id", userId).limit(1))
    : await query("SELECT * FROM users WHERE id=? LIMIT 1", [userId]);
  if (!rows[0]) throw codedError("USER_NOT_FOUND", "用户不存在");
  return rows[0];
}

async function findProjectById(projectId) {
  const rows = useRdb()
    ? await rdbSelect("projects", "*", (request) => request.eq("id", projectId).limit(1))
    : await query("SELECT * FROM projects WHERE id=? LIMIT 1", [projectId]);
  if (!rows[0]) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
  return rows[0];
}

async function adminCreateProjectMemberReview(event, user) {
  await requireAdmin(user);
  const projectId = id(event.projectId);
  const reviewedUserId = id(event.reviewedUserId || event.userId);
  const reviewerUserId = event.reviewerUserId ? id(event.reviewerUserId) : user.id;
  const reviewInput = event.review || {};
  const review = {
    role: text(reviewInput.role, 80),
    contributionText: text(reviewInput.contributionText || reviewInput.contribution, 30000),
    outcomeText: text(reviewInput.outcomeText || reviewInput.outcome, 10000),
    riskText: text(reviewInput.riskText || reviewInput.risk, 10000),
    reliabilityScore: reviewInput.reliabilityScore ? Math.min(Math.max(Number(reviewInput.reliabilityScore), 1), 10) : null,
    collaborationScore: reviewInput.collaborationScore ? Math.min(Math.max(Number(reviewInput.collaborationScore), 1), 10) : null,
    deliveryScore: reviewInput.deliveryScore ? Math.min(Math.max(Number(reviewInput.deliveryScore), 1), 10) : null,
  };
  if (!review.contributionText) throw codedError("VALIDATION_ERROR", "主理人评价必须填写具体贡献");
  const [project, reviewer, reviewed] = await Promise.all([
    findProjectById(projectId),
    findUserById(reviewerUserId),
    findUserById(reviewedUserId),
  ]);
  let reviewId = null;
  if (useRdb()) {
    const existing = await rdbSelect("project_member_reviews", "*", (request) =>
      request.eq("project_id", projectId).eq("reviewer_user_id", reviewerUserId).eq("reviewed_user_id", reviewedUserId).limit(1)
    );
    const payload = {
      project_id: projectId,
      reviewer_user_id: reviewerUserId,
      reviewed_user_id: reviewedUserId,
      role: review.role,
      contribution_text: review.contributionText,
      outcome_text: review.outcomeText,
      risk_text: review.riskText,
      reliability_score: review.reliabilityScore,
      collaboration_score: review.collaborationScore,
      delivery_score: review.deliveryScore,
      visibility: "sealed",
      status: "confirmed",
    };
    if (existing[0]) {
      reviewId = existing[0].id;
      await rdbUpdate("project_member_reviews", payload, (request) => request.eq("id", reviewId));
    } else {
      await rdbInsert("project_member_reviews", payload);
      const created = await rdbSelect("project_member_reviews", "id", (request) =>
        request.eq("project_id", projectId).eq("reviewer_user_id", reviewerUserId).eq("reviewed_user_id", reviewedUserId).limit(1)
      );
      reviewId = created[0] && created[0].id;
    }
  } else {
    const result = await query(
      `INSERT INTO project_member_reviews
       (project_id,reviewer_user_id,reviewed_user_id,role,contribution_text,outcome_text,risk_text,
        reliability_score,collaboration_score,delivery_score,visibility,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'sealed','confirmed')
       ON DUPLICATE KEY UPDATE role=VALUES(role),contribution_text=VALUES(contribution_text),
        outcome_text=VALUES(outcome_text),risk_text=VALUES(risk_text),reliability_score=VALUES(reliability_score),
        collaboration_score=VALUES(collaboration_score),delivery_score=VALUES(delivery_score),status='confirmed',updated_at=NOW()`,
      [
        projectId,
        reviewerUserId,
        reviewedUserId,
        review.role,
        review.contributionText,
        review.outcomeText,
        review.riskText,
        review.reliabilityScore,
        review.collaborationScore,
        review.deliveryScore,
      ]
    );
    const rows = await query(
      "SELECT id FROM project_member_reviews WHERE project_id=? AND reviewer_user_id=? AND reviewed_user_id=? LIMIT 1",
      [projectId, reviewerUserId, reviewedUserId]
    );
    reviewId = rows[0] ? rows[0].id : result.insertId;
  }
  if (!reviewId) throw codedError("REVIEW_CREATE_FAILED", "项目成员评价写入失败");
  const content = projectMemberReviewContent({ project, reviewer, reviewed, review });
  const ragResult = await upsertRagSourceForCurrentDriver({
    sourceType: "project_member_review",
    sourceId: reviewId,
    ownerUserId: reviewedUserId,
    projectId,
    title: `项目主理人评价：${project.name || projectId}`,
    summary: truncate(content, 500),
    tags: parseTags(event.tagsText || event.tags || ""),
    visibility: "sealed",
    sourceTrust: "owner_review",
    content,
    metadata: {
      source: "adminCreateProjectMemberReview",
      source_trust: "owner_review",
      reviewer_user_id: reviewerUserId,
      reviewed_user_id: reviewedUserId,
    },
  });
  await adminLog(user, "create_project_member_review", "project_member_review", reviewId, { projectId, reviewedUserId });
  return { reviewId, rag: ragResult };
}

function adminProjectUpdatePayload(input = {}) {
  const title = text(input.title, 180);
  const content = text(input.content, 20000);
  if (!title || !content) throw codedError("VALIDATION_ERROR", "项目动态标题和内容不能为空");
  return {
    title,
    content,
    visibility: input.visibility === "public" ? "public" : input.visibility === "admin_only" ? "admin_only" : "project_members",
    update_type: ["progress", "milestone", "meeting_summary", "resource_update", "announcement", "other"].includes(input.updateType || input.update_type)
      ? (input.updateType || input.update_type)
      : "progress",
    status: input.status === "draft" ? "draft" : "published",
  };
}

function adminProjectMemberPayload(input = {}, operatorUserId) {
  const status = ["invited", "active", "rejected", "removed", "left"].includes(input.status) ? input.status : "active";
  return {
    role: ["creator", "member", "observer", "advisor", "executor", "resource_provider"].includes(input.role) ? input.role : "member",
    status,
    invited_by: operatorUserId || null,
    joined_at: status === "active" ? (input.joinedAt ? sqlDateTime(input.joinedAt) : nowDateTime()) : null,
  };
}

async function adminGetProjectManagement(event, user) {
  await requireAdmin(user);
  if (!useRdb()) throw codedError("RDB_REQUIRED", "项目管理后台接口需要 CloudBase RDB");
  const projectId = id(event.projectId);
  const [projectRows, memberRows, updateRows, reviewRows] = await Promise.all([
    rdbSelect("projects", "*", (request) => request.eq("id", projectId).limit(1)),
    rdbSelect("project_members", "*", (request) => request.eq("project_id", projectId).order("created_at", { ascending: true }).limit(500)),
    rdbSelect("project_updates", "*", (request) => request.eq("project_id", projectId).order("created_at", { ascending: false }).limit(200)),
    rdbSelect("project_member_reviews", "*", (request) => request.eq("project_id", projectId).order("updated_at", { ascending: false }).limit(500)).catch(() => []),
  ]);
  const project = projectRows[0];
  if (!project) throw codedError("PROJECT_NOT_FOUND", "项目不存在");
  const userIds = unique([
    project.creator_user_id,
    ...memberRows.map((item) => item.user_id),
    ...updateRows.map((item) => item.creator_user_id),
    ...reviewRows.map((item) => item.reviewer_user_id),
    ...reviewRows.map((item) => item.reviewed_user_id),
  ]).map(Number).filter(Boolean);
  const users = userIds.length
    ? await rdbSelect("users", "id,public_user_code,display_name,avatar_url,status", (request) => request.in("id", userIds).limit(1000))
    : [];
  const profiles = userIds.length
    ? await rdbSelect("user_profiles", "user_id,name,job,avatar_url", (request) => request.in("user_id", userIds).limit(1000)).catch(() => [])
    : [];
  const profileMap = new Map(profiles.map((item) => [Number(item.user_id), item]));
  const userMap = new Map(users.map((item) => {
    const profile = profileMap.get(Number(item.id)) || {};
    return [Number(item.id), {
      ...item,
      name: profile.name || item.display_name || "",
      job: profile.job || "",
      avatar_url: profile.avatar_url || item.avatar_url || "",
    }];
  }));
  const withUser = (row, key = "user_id", field = "user") => ({ ...row, [field]: userMap.get(Number(row[key])) || null });
  return {
    project: { ...project, tags: parseJson(project.tags_json, []) },
    members: memberRows.map((item) => withUser(item)),
    updates: updateRows.map((item) => withUser(item, "creator_user_id", "creator")),
    reviews: reviewRows.map((item) => ({
      ...item,
      reviewer: userMap.get(Number(item.reviewer_user_id)) || null,
      reviewed: userMap.get(Number(item.reviewed_user_id)) || null,
    })),
  };
}

async function adminUpsertProjectMember(event, user) {
  await requireAdmin(user);
  if (!useRdb()) throw codedError("RDB_REQUIRED", "项目成员后台接口需要 CloudBase RDB");
  const projectId = id(event.projectId);
  const memberUserId = id(event.userId || event.memberUserId);
  await Promise.all([findProjectById(projectId), findUserById(memberUserId)]);
  const values = {
    project_id: projectId,
    user_id: memberUserId,
    ...adminProjectMemberPayload(event.member || event.patch || event, user.id),
  };
  await rdbUpsert("project_members", values);
  await adminLog(user, "upsert_project_member", "project", projectId, { memberUserId, role: values.role, status: values.status });
  return { saved: true, projectId, userId: memberUserId };
}

async function adminCreateProjectUpdate(event, user) {
  await requireAdmin(user);
  if (!useRdb()) throw codedError("RDB_REQUIRED", "项目动态后台接口需要 CloudBase RDB");
  const projectId = id(event.projectId);
  await findProjectById(projectId);
  const payload = adminProjectUpdatePayload(event.update || {});
  await rdbInsert("project_updates", {
    project_id: projectId,
    creator_user_id: user.id,
    ...payload,
  });
  const rows = await rdbSelect("project_updates", "id", (request) =>
    request.eq("project_id", projectId).eq("creator_user_id", user.id).order("created_at", { ascending: false }).limit(1)
  );
  const updateId = rows[0] && rows[0].id;
  await adminLog(user, "create_project_update", "project_update", updateId, { projectId, visibility: payload.visibility });
  return { updateId };
}

async function adminUpdateProjectUpdate(event, user) {
  await requireAdmin(user);
  if (!useRdb()) throw codedError("RDB_REQUIRED", "项目动态后台接口需要 CloudBase RDB");
  const projectId = id(event.projectId);
  const updateId = id(event.updateId);
  const rows = await rdbSelect("project_updates", "*", (request) => request.eq("id", updateId).eq("project_id", projectId).limit(1));
  if (!rows[0]) throw codedError("UPDATE_NOT_FOUND", "项目动态不存在");
  const payload = adminProjectUpdatePayload(event.update || {});
  await rdbUpdate("project_updates", payload, (request) => request.eq("id", updateId).eq("project_id", projectId));
  await adminLog(user, "update_project_update", "project_update", updateId, { projectId, visibility: payload.visibility });
  return { updateId };
}

async function adminCompleteProject(event, user) {
  await requireAdmin(user);
  if (!useRdb()) throw codedError("RDB_REQUIRED", "项目完结后台接口需要 CloudBase RDB");
  const projectId = id(event.projectId);
  const project = await findProjectById(projectId);
  const summary = text(event.summary || event.completionSummary || "", 30000);
  if (!summary) throw codedError("VALIDATION_ERROR", "项目完结总结不能为空");
  await rdbUpdate("projects", {
    status: "completed",
    completion_summary: summary,
    completed_at: nowDateTime(),
    completed_by_user_id: user.id,
  }, (request) => request.eq("id", projectId));
  await rdbInsert("project_updates", {
    project_id: projectId,
    creator_user_id: user.id,
    title: event.updateTitle ? text(event.updateTitle, 180) : `项目完结：${project.name}`,
    content: summary,
    visibility: event.visibility === "public" ? "public" : "project_members",
    update_type: "milestone",
    status: "published",
  }).catch(() => {});

  const reviews = Array.isArray(event.memberReviews) ? event.memberReviews : [];
  const reviewResults = [];
  for (const item of reviews) {
    const reviewedUserId = item.reviewedUserId || item.userId || item.memberUserId;
    const contribution = text(item.contributionText || item.contribution, 30000);
    if (!reviewedUserId || !contribution) continue;
    const result = await adminCreateProjectMemberReview({
      projectId,
      reviewedUserId,
      reviewerUserId: item.reviewerUserId || user.id,
      review: item,
      tags: item.tags || ["project_completed"],
    }, user);
    reviewResults.push(result);
  }
  await adminLog(user, "complete_project", "project", projectId, { reviewCount: reviewResults.length });
  return { saved: true, projectId, reviewCount: reviewResults.length, reviews: reviewResults };
}

function adminEvidenceSourceType(evidenceType) {
  if (evidenceType === "admin_interview") return "admin_interview";
  if (evidenceType === "admin_evidence" || evidenceType === "risk_note") return "admin_evidence";
  return "admin_note";
}

function adminEvidenceSourceTrust(evidenceType) {
  if (evidenceType === "admin_interview") return "admin_interview";
  if (evidenceType === "admin_evidence") return "verified_record";
  return "admin_note";
}

async function adminCreateUserEvidence(event, user) {
  await requireAdmin(user);
  const targetUserId = id(event.userId || event.targetUserId);
  const projectId = event.projectId ? id(event.projectId) : null;
  const eventId = event.eventId ? id(event.eventId) : null;
  const communityId = event.communityId ? id(event.communityId) : null;
  const evidenceType = ["admin_note", "admin_interview", "admin_evidence", "risk_note"].includes(event.evidenceType)
    ? event.evidenceType
    : "admin_note";
  const fileText = await extractEvidenceFileText(event.file);
  const content = [event.content || (event.evidence && event.evidence.content), fileText]
    .map((item) => text(item, 120000))
    .filter(Boolean)
    .join("\n\n");
  if (!content) throw codedError("VALIDATION_ERROR", "管理员证据内容不能为空");
  const targetUser = await findUserById(targetUserId);
  const confidence = Math.min(Math.max(Number(event.confidence || 0.9), 0), 1);
  let evidenceId = null;
  const payload = {
    user_id: targetUserId,
    project_id: projectId,
    event_id: eventId,
    community_id: communityId,
    source_type: "admin_console",
    source_id: null,
    evidence_type: evidenceType,
    content,
    evidence_level: "admin_verified",
    confidence,
    visibility: "sealed",
    status: "confirmed",
    created_by: user.id,
  };
  if (useRdb()) {
    await rdbInsert("evidence_records", payload);
    const rows = await rdbSelect("evidence_records", "id", (request) =>
      request.eq("user_id", targetUserId).eq("created_by", user.id).eq("evidence_type", evidenceType).order("created_at", { ascending: false }).limit(1)
    );
    evidenceId = rows[0] && rows[0].id;
  } else {
    const result = await query(
      `INSERT INTO evidence_records
       (user_id,project_id,event_id,community_id,source_type,source_id,evidence_type,content,evidence_level,confidence,visibility,status,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,'sealed','confirmed',?)`,
      [
        targetUserId,
        projectId,
        eventId,
        communityId,
        payload.source_type,
        payload.source_id,
        evidenceType,
        content,
        payload.evidence_level,
        confidence,
        user.id,
      ]
    );
    evidenceId = result.insertId;
  }
  if (!evidenceId) throw codedError("EVIDENCE_CREATE_FAILED", "管理员证据写入失败");
  const sourceType = adminEvidenceSourceType(evidenceType);
  const sourceTrust = adminEvidenceSourceTrust(evidenceType);
  const ragResult = await upsertRagSourceForCurrentDriver({
    sourceType,
    sourceId: evidenceId,
    ownerUserId: targetUserId,
    projectId,
    eventId,
    communityId,
    title: event.title || `管理员证据：${targetUser.display_name || targetUserId}`,
    summary: truncate(content, 500),
    tags: parseTags(event.tagsText || event.tags || ""),
    visibility: "sealed",
    sourceTrust,
    content,
    metadata: {
      source: "adminCreateUserEvidence",
      source_trust: sourceTrust,
      evidence_type: evidenceType,
      created_by: user.id,
      filename: event.file && event.file.filename ? text(event.file.filename, 180) : "",
    },
  });
  await adminLog(user, "create_user_evidence", "evidence", evidenceId, { targetUserId, communityId, evidenceType });
  return { evidenceId, rag: ragResult };
}

async function adminCreateCommunityMemberEvidence(event, user) {
  await requireAdmin(user);
  const communityId = id(event.communityId);
  const targetUserId = id(event.userId || event.targetUserId);
  const memberships = useRdb()
    ? await rdbSelect("community_memberships", "id,status", (request) =>
        request.eq("community_id", communityId).eq("user_id", targetUserId).limit(1)
      )
    : await query("SELECT id,status FROM community_memberships WHERE community_id=? AND user_id=? LIMIT 1", [communityId, targetUserId]);
  if (!memberships[0] || memberships[0].status !== "active") {
    throw codedError("VALIDATION_ERROR", "只能给该社区已认证成员上传证据");
  }
  return adminCreateUserEvidence({
    ...event,
    userId: targetUserId,
    communityId,
    evidenceType: event.evidenceType || "admin_evidence",
    tags: unique(["community", ...(Array.isArray(event.tags) ? event.tags : parseTags(event.tagsText || event.tags))]),
  }, user);
}

async function adminListUserEvidence(event, user) {
  await requireAdmin(user);
  const targetUserId = id(event.userId || event.targetUserId);
  const evidenceRows = useRdb()
    ? await rdbSelect("evidence_records", "*", (request) =>
        request.eq("user_id", targetUserId).order("created_at", { ascending: false }).limit(200)
      )
    : await query("SELECT * FROM evidence_records WHERE user_id=? ORDER BY created_at DESC LIMIT 200", [targetUserId]);
  if (!evidenceRows.length) return { evidence: [] };

  const activeEvidence = evidenceRows.filter((item) => item.status === "confirmed");
  const sourceKeys = activeEvidence.map((item) => ({
    evidenceId: Number(item.id),
    sourceType: adminEvidenceSourceType(item.evidence_type),
  }));
  const sourceRows = sourceKeys.length && useRdb()
    ? await rdbSelect("rag_sources", "id,source_type,source_id,status,last_indexed_at,error_message", (request) =>
        request.in("source_id", sourceKeys.map((item) => item.evidenceId)).limit(300)
      )
    : sourceKeys.length
      ? await query(
          `SELECT id,source_type,source_id,status,last_indexed_at,error_message
           FROM rag_sources WHERE source_id IN (${sourceKeys.map(() => "?").join(",")})`,
          sourceKeys.map((item) => item.evidenceId)
        )
      : [];
  const sourceByKey = new Map(sourceRows.map((item) => [`${item.source_type}:${Number(item.source_id)}`, item]));
  return {
    evidence: evidenceRows.map((item) => {
      const sourceType = adminEvidenceSourceType(item.evidence_type);
      const ragSource = sourceByKey.get(`${sourceType}:${Number(item.id)}`) || null;
      return {
        ...item,
        ragSource,
      };
    }),
  };
}

async function archiveEvidenceRagSource(evidence) {
  const sourceType = adminEvidenceSourceType(evidence.evidence_type);
  const sourceId = Number(evidence.id);
  if (useRdb()) {
    const sources = await rdbSelect("rag_sources", "id", (request) =>
      request.eq("source_type", sourceType).eq("source_id", sourceId).limit(20)
    );
    for (const source of sources) {
      await rdbUpdate("rag_chunks", { status: "archived" }, (request) => request.eq("source_id", source.id));
      await rdbUpdate("rag_sources", { status: "archived", error_message: null }, (request) => request.eq("id", source.id));
    }
    return sources.length;
  }
  const sources = await query("SELECT id FROM rag_sources WHERE source_type=? AND source_id=?", [sourceType, sourceId]);
  for (const source of sources) {
    await query("UPDATE rag_chunks SET status='archived' WHERE source_id=?", [source.id]);
    await query("UPDATE rag_sources SET status='archived',error_message=NULL WHERE id=?", [source.id]);
  }
  return sources.length;
}

async function adminUpdateUserEvidence(event, user) {
  await requireAdmin(user);
  const evidenceId = id(event.evidenceId || event.id);
  const rows = useRdb()
    ? await rdbSelect("evidence_records", "*", (request) => request.eq("id", evidenceId).limit(1))
    : await query("SELECT * FROM evidence_records WHERE id=? LIMIT 1", [evidenceId]);
  const existing = rows[0];
  if (!existing) throw codedError("NOT_FOUND", "证据不存在");
  const evidenceType = ["admin_note", "admin_interview", "admin_evidence", "risk_note"].includes(event.evidenceType)
    ? event.evidenceType
    : existing.evidence_type;
  const content = text(event.content, 120000);
  if (!content) throw codedError("VALIDATION_ERROR", "证据内容不能为空");
  const confidence = Math.min(Math.max(Number(event.confidence ?? existing.confidence ?? 0.9), 0), 1);
  const status = ["candidate", "confirmed", "rejected"].includes(event.status) ? event.status : existing.status;
  const patch = {
    evidence_type: evidenceType,
    content,
    confidence,
    status,
  };
  if (useRdb()) {
    await rdbUpdate("evidence_records", patch, (request) => request.eq("id", evidenceId));
  } else {
    await query("UPDATE evidence_records SET evidence_type=?,content=?,confidence=?,status=? WHERE id=?", [
      patch.evidence_type,
      patch.content,
      patch.confidence,
      patch.status,
      evidenceId,
    ]);
  }

  let rag = null;
  if (status === "confirmed") {
    const updated = { ...existing, ...patch, id: evidenceId };
    await archiveEvidenceRagSource(existing);
    rag = await upsertRagSourceForCurrentDriver({
      sourceType: adminEvidenceSourceType(evidenceType),
      sourceId: evidenceId,
      ownerUserId: Number(updated.user_id),
      projectId: updated.project_id || null,
      eventId: updated.event_id || null,
      communityId: updated.community_id || null,
      title: event.title || `管理员证据：${updated.user_id}`,
      summary: truncate(content, 500),
      tags: parseTags(event.tagsText || event.tags || ""),
      visibility: "sealed",
      sourceTrust: adminEvidenceSourceTrust(evidenceType),
      content,
      metadata: {
        source: "adminUpdateUserEvidence",
        source_trust: adminEvidenceSourceTrust(evidenceType),
        evidence_type: evidenceType,
        updated_by: user.id,
      },
    });
  } else {
    await archiveEvidenceRagSource({ ...existing, ...patch, id: evidenceId });
  }
  await adminLog(user, "update_user_evidence", "evidence", evidenceId, { status, evidenceType });
  return { evidenceId, rag };
}

async function adminArchiveUserEvidence(event, user) {
  await requireAdmin(user);
  const evidenceId = id(event.evidenceId || event.id);
  const rows = useRdb()
    ? await rdbSelect("evidence_records", "*", (request) => request.eq("id", evidenceId).limit(1))
    : await query("SELECT * FROM evidence_records WHERE id=? LIMIT 1", [evidenceId]);
  const existing = rows[0];
  if (!existing) throw codedError("NOT_FOUND", "证据不存在");
  if (useRdb()) {
    await rdbUpdate("evidence_records", { status: "rejected" }, (request) => request.eq("id", evidenceId));
  } else {
    await query("UPDATE evidence_records SET status='rejected' WHERE id=?", [evidenceId]);
  }
  const archivedSources = await archiveEvidenceRagSource(existing);
  await adminLog(user, "archive_user_evidence", "evidence", evidenceId, { archivedSources });
  return { evidenceId, archivedSources };
}

async function adminTestProjectApplicationReview(event, user) {
  await requireAdmin(user);
  const { project, applicant, application, identity } = await buildAdminApplicationTestInput(event);
  const retrievalOptions = {
    useAiPlan: event.useAiPlan !== false,
    maxQueries: event.maxQueries,
    topK: event.topK,
  };
  const reviewContext = await buildProjectApplicationReviewContext({
    user: applicant,
    project,
    application,
    identity,
    retrievalOptions,
  });
  const review = await runProjectApplicationAiReview({ user: applicant, project, application, identity, reviewContext });
  return {
    project: {
      id: project.id,
      name: project.name,
      tags: parseJson(project.tags_json, []),
    },
    applicant: {
      id: applicant.id,
      displayName: applicant.display_name,
    },
    retrievalPlan: reviewContext.retrievalPlan,
    evidence: reviewContext.evidence,
    hardFacts: reviewContext.hardFacts,
    review,
  };
}

async function adminDebugProjectApplicationInput(event, user) {
  await requireAdmin(user);
  const projectId = id(event.projectId);
  const applicantUserId = id(event.applicantUserId || event.userId);
  const [project, applicant] = await Promise.all([findProjectById(projectId), findUserById(applicantUserId)]);
  const application = {
    message: text(event.application && event.application.message, 3000) || "我想参与这个项目，希望进一步了解任务并承担适合我的部分。",
    canOffer: text(event.application && event.application.canOffer, 2000) || "我可以提供执行、沟通和项目推进支持。",
    relatedExperience: text(event.application && (event.application.relatedExperience || event.application.reason), 2000),
  };
  const identity = event.includeIdentity ? await getMyIdentity({}, applicant) : null;
  return {
    project: {
      id: project.id,
      name: project.name,
      tags: parseJson(project.tags_json, []),
      status: project.status,
      visibility: project.visibility,
    },
    applicant: {
      id: applicant.id,
      openid: applicant.openid,
      displayName: applicant.display_name,
      status: applicant.status,
      experiencePoints: applicant.experience_points,
    },
    application,
    identity: identity ? identity.identity : null,
  };
}

async function buildAdminApplicationTestInput(event) {
  const projectId = id(event.projectId);
  const applicantUserId = id(event.applicantUserId || event.userId);
  const [project, applicant] = await Promise.all([findProjectById(projectId), findUserById(applicantUserId)]);
  const application = {
    message: text(event.application && event.application.message, 3000) || "我想参与这个项目，希望进一步了解任务并承担适合我的部分。",
    canOffer: text(event.application && event.application.canOffer, 2000) || "我可以提供执行、沟通和项目推进支持。",
    relatedExperience: text(event.application && (event.application.relatedExperience || event.application.reason), 2000),
  };
  const identity = await getMyIdentity({}, applicant);
  return { project, applicant, application, identity };
}

async function adminTestProjectApplicationEvidence(event, user) {
  await requireAdmin(user);
  const { project, applicant, application, identity } = await buildAdminApplicationTestInput(event);
  const retrievalOptions = {
    useAiPlan: event.useAiPlan !== false,
    maxQueries: event.maxQueries,
    topK: event.topK,
  };
  const reviewContext = await buildProjectApplicationReviewContext({
    user: applicant,
    project,
    application,
    identity,
    retrievalOptions,
  });
  return {
    project: {
      id: project.id,
      name: project.name,
      tags: parseJson(project.tags_json, []),
    },
    applicant: {
      id: applicant.id,
      displayName: applicant.display_name,
    },
    retrievalPlan: reviewContext.retrievalPlan,
    evidence: reviewContext.evidence,
    hardFacts: reviewContext.hardFacts,
  };
}

async function adminTestSingleEvidenceSearch(event, user) {
  await requireAdmin(user);
  const { project, applicant, application, identity } = await buildAdminApplicationTestInput(event);
  const fallbackPlan = buildFallbackProjectApplicationRetrievalPlan({ applicant, project, application });
  const planIndex = Math.min(Math.max(Number(event.planIndex || 0), 0), fallbackPlan.length - 1);
  const basePlan = fallbackPlan[planIndex] || fallbackPlan[0];
  const plan = {
    ...basePlan,
    name: text(event.name, 60) || basePlan.name,
    query: text(event.query, 1000) || basePlan.query,
    topK: Math.min(Math.max(Number(event.topK || basePlan.topK || 2), 1), 3),
  };
  const startedAt = Date.now();
  const matches = await searchEvidence(plan, applicant.id);
  return {
    elapsedMs: Date.now() - startedAt,
    project: { id: project.id, name: project.name },
    applicant: { id: applicant.id, displayName: applicant.display_name },
    identity: identity.identity,
    plan: { name: plan.name, bucket: plan.bucket, query: plan.query, topK: plan.topK, filters: plan.filters },
    matches,
  };
}

async function adminUpdateProject(event, user) {
  await requireAdmin(user);
  const projectId = id(event.projectId);
  const patch = event.patch || {};
  const values = {
    visibility: patch.visibility === "private" ? "private" : "public",
    is_official_recommended: patch.isOfficialRecommended ? 1 : 0,
    official_sort_weight: Number(patch.officialSortWeight || 0),
    status: ["draft", "active", "paused", "completed", "archived"].includes(patch.status) ? patch.status : "active",
  };
  if (patch.name !== undefined) values.name = text(patch.name, 160);
  if (patch.description !== undefined) values.description = text(patch.description, 10000);
  if (patch.creatorUserId !== undefined || patch.creator_user_id !== undefined) values.creator_user_id = id(patch.creatorUserId || patch.creator_user_id);
  if (patch.stage !== undefined) values.stage = text(patch.stage, 80);
  if (patch.goal !== undefined) values.goal = text(patch.goal, 5000);
  if (patch.tags !== undefined || patch.tagsText !== undefined) values.tags_json = json(parseTags(patch.tagsText || patch.tags), []);
  if (patch.communityId !== undefined || patch.community_id !== undefined) {
    const communityId = patch.communityId !== undefined ? patch.communityId : patch.community_id;
    values.community_id = communityId ? id(communityId, "communityId") : null;
  }
  if (useRdb()) {
    await rdbUpdate("projects", values, (request) => request.eq("id", projectId));
    if (values.creator_user_id) {
      await rdbUpsert("project_members", {
        project_id: projectId,
        user_id: values.creator_user_id,
        role: "creator",
        status: "active",
        invited_by: user.id,
        joined_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      });
    }
    await adminLog(user, "update_project", "project", projectId, patch);
    return { saved: true };
  }
  await query(
    `UPDATE projects SET visibility=?,is_official_recommended=?,official_sort_weight=?,status=? WHERE id=?`,
    [
      values.visibility,
      values.is_official_recommended,
      values.official_sort_weight,
      values.status,
      projectId
    ]
  );
  await adminLog(user, "update_project", "project", projectId, patch);
  return { saved: true };
}

async function adminCreateEvent(event, user) {
  await requireAdmin(user);
  const item = event.event || {};
  const values = eventPayload(item, user.id);
  if (useRdb()) {
    await rdbInsert("official_events", values);
    const rows = await rdbSelect("official_events", "id", (request) =>
      request.eq("title", values.title).eq("host_user_id", user.id).order("created_at", { ascending: false }).limit(1)
    );
    const eventId = rows[0] ? rows[0].id : null;
    await adminLog(user, "create_event", "event", eventId, item);
    return { eventId };
  }
  const result = await query(
    `INSERT INTO official_events
     (title,description,event_type,location,start_time,end_time,host_user_id,status,visibility,official_sort_weight,capacity)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      values.title,
      values.description,
      values.event_type,
      values.location,
      values.start_time,
      values.end_time,
      values.host_user_id,
      values.status,
      values.visibility,
      values.official_sort_weight,
      values.capacity
    ]
  );
  await adminLog(user, "create_event", "event", result.insertId, item);
  return { eventId: result.insertId };
}

async function adminListUsers(event, user) {
  await requireAdmin(user);
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 300);
  const keyword = text(event.keyword, 80);
  if (useRdb()) {
    const rows = await rdbSelect("users", "id,openid,public_user_code,display_name,avatar_url,status,is_admin,experience_points,created_at,updated_at", (request) =>
      request.order("created_at", { ascending: false }).limit(limit)
    );
    const users = keyword
      ? rows.filter((item) => [item.display_name, item.openid, item.public_user_code].some((value) => String(value || "").includes(keyword)))
      : rows;
    return { users };
  }
  const users = await query(
    "SELECT id,openid,public_user_code,display_name,avatar_url,status,is_admin,experience_points,created_at,updated_at FROM users ORDER BY created_at DESC LIMIT ?",
    [limit]
  );
  return { users: keyword ? users.filter((item) => [item.display_name, item.openid, item.public_user_code].some((value) => String(value || "").includes(keyword))) : users };
}

async function adminSetUserStatus(event, user) {
  await requireAdmin(user);
  const userId = id(event.userId);
  const status = event.status === "disabled" ? "disabled" : "active";
  if (Number(userId) === Number(user.id) && status === "disabled") throw codedError("VALIDATION_ERROR", "不能禁用当前管理员");
  if (useRdb()) await rdbUpdate("users", { status }, (request) => request.eq("id", userId));
  else await query("UPDATE users SET status=? WHERE id=?", [status, userId]);
  await adminLog(user, "set_user_status", "user", userId, { status });
  return { saved: true };
}

async function adminSetUserAdmin(event, user) {
  await requireAdmin(user);
  const userId = id(event.userId);
  const isAdmin = event.isAdmin ? 1 : 0;
  if (Number(userId) === Number(user.id) && !isAdmin) throw codedError("VALIDATION_ERROR", "不能移除当前管理员权限");
  if (useRdb()) await rdbUpdate("users", { is_admin: isAdmin }, (request) => request.eq("id", userId));
  else await query("UPDATE users SET is_admin=? WHERE id=?", [isAdmin, userId]);
  await adminLog(user, "set_user_admin", "user", userId, { isAdmin: !!isAdmin });
  return { saved: true };
}

async function adminListProjects(event, user) {
  await requireAdmin(user);
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 300);
  if (useRdb()) {
    const projects = await rdbSelect("projects", "*", (request) => request.order("updated_at", { ascending: false }).limit(limit));
    return { projects: projects.map((item) => ({ ...item, tags: parseJson(item.tags_json, []) })) };
  }
  const projects = await query(`SELECT * FROM projects ORDER BY updated_at DESC LIMIT ${limit}`);
  return { projects: projects.map((item) => ({ ...item, tags: parseJson(item.tags_json, []) })) };
}

async function adminListEvents(event, user) {
  await requireAdmin(user);
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 300);
  if (useRdb()) {
    const events = await rdbSelect("official_events", "*", (request) => request.order("start_time", { ascending: false }).limit(limit));
    return { events };
  }
  return { events: await query(`SELECT * FROM official_events ORDER BY start_time DESC LIMIT ${limit}`) };
}

async function adminUpdateEvent(event, user) {
  await requireAdmin(user);
  const eventId = id(event.eventId);
  const item = event.event || {};
  const values = eventPayload(item, user.id);
  if (useRdb()) await rdbUpdate("official_events", values, (request) => request.eq("id", eventId));
  else {
    await query(
      `UPDATE official_events
       SET title=?,description=?,event_type=?,location=?,start_time=?,end_time=?,host_user_id=?,status=?,visibility=?,official_sort_weight=?,capacity=?
       WHERE id=?`,
      [
        values.title,
        values.description,
        values.event_type,
        values.location,
        values.start_time,
        values.end_time,
        values.host_user_id,
        values.status,
        values.visibility,
        values.official_sort_weight,
        values.capacity,
        eventId,
      ]
    );
  }
  await adminLog(user, "update_event", "event", eventId, item);
  return { saved: true };
}

async function sendDueReminders() {
  if (!REMINDER_TEMPLATE_ID) throw codedError("TEMPLATE_NOT_CONFIGURED", "订阅消息模板尚未配置");
  const leadMinutes = Math.max(Number(process.env.REMINDER_LEAD_MINUTES || 30), 0);
  const recipients = await query(
    `SELECT rr.id,rr.user_id,rr.event_id,rr.available_quota,u.openid,
      pe.project_id,pe.title,pe.start_time,pe.location
     FROM reminder_recipients rr
     JOIN users u ON u.id=rr.user_id
     JOIN project_events pe ON pe.id=rr.event_id
     WHERE rr.subscribe_status='accepted' AND rr.available_quota>0
       AND rr.send_status IN ('pending','failed')
       AND pe.status='active'
       AND TIMESTAMPDIFF(MINUTE,NOW(),pe.start_time) BETWEEN ? AND ?
     ORDER BY pe.start_time ASC LIMIT 100`,
    [Math.max(leadMinutes - 2, 0), leadMinutes + 2]
  );
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const claim = await query(
      `UPDATE reminder_recipients SET send_status='sending'
       WHERE id=? AND available_quota>0 AND send_status IN ('pending','failed')`,
      [recipient.id]
    );
    if (!claim.affectedRows) continue;
    const titleKey = process.env.WECHAT_REMINDER_TITLE_KEY || "thing1";
    const timeKey = process.env.WECHAT_REMINDER_TIME_KEY || "time2";
    const noteKey = process.env.WECHAT_REMINDER_NOTE_KEY || "thing3";
    const payload = {
      [titleKey]: { value: text(recipient.title, 20) },
      [timeKey]: { value: formatWechatTime(recipient.start_time) },
      [noteKey]: { value: text(recipient.location || "请进入项目协作空间查看", 20) }
    };
    try {
      const result = await cloud.openapi.subscribeMessage.send({
        touser: recipient.openid,
        page: `pages/project-space/index?id=${recipient.project_id}`,
        lang: "zh_CN",
        data: payload,
        templateId: REMINDER_TEMPLATE_ID,
        miniprogramState: process.env.WECHAT_MINIPROGRAM_STATE || "formal"
      });
      if (result.errCode && result.errCode !== 0) throw codedError("WECHAT_SEND_FAILED", result.errMsg || "订阅消息发送失败");
      await transaction(async (connection) => {
        await connection.execute(
          `UPDATE reminder_recipients
           SET send_status='sent',sent_at=NOW(),available_quota=available_quota-1
           WHERE id=?`,
          [recipient.id]
        );
        await connection.execute(
          `INSERT INTO notification_logs
           (user_id,project_id,event_id,channel,template_id,payload,status,sent_at)
           VALUES (?,?,?,'wechat_subscribe',?,?,'sent',NOW())`,
          [recipient.user_id, recipient.project_id, recipient.event_id, REMINDER_TEMPLATE_ID, json(payload, {})]
        );
      });
      sent += 1;
    } catch (err) {
      await query("UPDATE reminder_recipients SET send_status='failed' WHERE id=?", [recipient.id]);
      await query(
        `INSERT INTO notification_logs
         (user_id,project_id,event_id,channel,template_id,payload,status,error_message)
         VALUES (?,?,?,'wechat_subscribe',?,?,'failed',?)`,
        [
          recipient.user_id,
          recipient.project_id,
          recipient.event_id,
          REMINDER_TEMPLATE_ID,
          json(payload, {}),
          text(err.message, 2000)
        ]
      );
      failed += 1;
    }
  }
  return { checked: recipients.length, sent, failed };
}

function formatWechatTime(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function httpJson(url, options, body, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeoutCode = options && options.timeoutCode ? options.timeoutCode : "HTTP_TIMEOUT";
    const timeoutMessage = options && options.timeoutMessage ? options.timeoutMessage : "外部接口请求超时";
    const requestOptions = { ...options };
    delete requestOptions.timeoutCode;
    delete requestOptions.timeoutMessage;
    const rawBody = JSON.stringify(body);
    const request = https.request(url, requestOptions, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(codedError("HTTP_REQUEST_FAILED", `外部接口返回 ${response.statusCode}: ${raw.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(codedError("HTTP_RESPONSE_INVALID", "外部接口没有返回合法 JSON"));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(timeoutMs, () => request.destroy(codedError(timeoutCode, timeoutMessage)));
    request.write(rawBody);
    request.end();
  });
}

async function callAi({ task, instruction, schema, payload }) {
  const baseUrl = AI_BASE_URL;
  const apiKey = AI_API_KEY;
  const model = AI_MODEL;
  if (!baseUrl || !apiKey || !model) throw codedError("AI_NOT_CONFIGURED", "AI 模型尚未配置");
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    temperature: AI_TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${instruction}\n任务:${task}\n当前日期:${new Date().toISOString()}\n默认时区:${TIMEZONE}\nJSON Schema:${JSON.stringify(schema || {})}`
      },
      { role: "user", content: JSON.stringify(payload) }
    ]
  };
  const response = await httpJson(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(body))
      },
      timeoutCode: "AI_TIMEOUT",
      timeoutMessage: "模型接口超时",
    },
    body,
    AI_REQUEST_TIMEOUT_MS
  );
  const content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  if (!content) throw codedError("AI_RESPONSE_EMPTY", "模型没有返回内容");
  try {
    return JSON.parse(content);
  } catch (err) {
    throw codedError("AI_RESPONSE_INVALID", "模型输出不是合法 JSON");
  }
}

function aiConfigured() {
  return Boolean(AI_BASE_URL && AI_API_KEY && AI_MODEL);
}

function buildProjectApplicationBaseFilters(applicantId) {
  return {
    owner_user_id: applicantId,
    status: ["indexed", "pending"],
    source_type: [
      "profile",
      "card",
      "event_record",
      "project_record",
      "project_member_review",
      "feedback",
      "admin_note",
      "admin_evidence",
      "admin_interview",
      "offline_transcript",
    ],
    visibility: ["match_only", "project_visible", "admin_only", "sealed"],
    source_trust: ["self_reported", "system_observed", "owner_review", "admin_note", "admin_interview", "verified_record", "transcript_verified"],
  };
}

function buildFallbackProjectApplicationRetrievalPlan({ applicant, project, application }) {
  const projectTags = parseJson(project.tags_json, project.tags || []);
  const requiredCapabilities = parseJson(project.required_capabilities_json, []);
  const idealParticipant = text(project.ideal_participant, 1000);
  const notFitParticipant = text(project.not_fit_participant, 1000);
  const goal = text(project.goal || project.description, 1200);
  const name = applicant.display_name || `用户${applicant.id}`;
  const baseFilters = buildProjectApplicationBaseFilters(applicant.id);
  return [
    {
      name: "tag_match",
      bucket: "positive",
      topK: RAG_RETRIEVAL_TOP_K,
      query: `查找申请人 ${name} 与项目标签 ${projectTags.join("、")} 相关的过往经历、项目记录、活动记录和被确认的能力证据。项目目标：${goal}。希望参与者：${idealParticipant || "未填写"}。申请人自述：${application.message} ${application.canOffer} ${application.relatedExperience}。只返回能证明匹配关系的资料。`,
      filters: { ...baseFilters, evidence_polarity: ["positive", "neutral"] },
    },
    {
      name: "capability_match",
      bucket: "positive",
      topK: RAG_RETRIEVAL_TOP_K,
      query: `查找申请人 ${name} 是否具备这些能力：${requiredCapabilities.join("、") || projectTags.join("、")}。优先返回真实项目、活动、交付结果、他人评价中的证据。不要返回纯自我宣传，除非没有其他资料。`,
      filters: { ...baseFilters, evidence_polarity: ["positive", "neutral"] },
    },
    {
      name: "delivery_evidence",
      bucket: "delivery",
      topK: RAG_RETRIEVAL_TOP_K,
      query: `查找申请人 ${name} 的真实交付记录：主理过什么、完成过什么、推进过什么、解决过什么具体问题。优先返回有时间、项目、结果、他人确认的资料。`,
      filters: { ...baseFilters, evidence_polarity: ["positive", "neutral"] },
    },
    {
      name: "collaboration_evidence",
      bucket: "collaboration",
      topK: RAG_RETRIEVAL_TOP_K,
      query: `查找申请人 ${name} 在线下活动、社区评审、项目协作、共同交付中的合作记录。重点关注靠谱、响应、沟通、复盘、持续投入、被邀请继续合作等证据。`,
      filters: { ...baseFilters, evidence_polarity: ["positive", "neutral"] },
    },
    {
      name: "risk_mismatch",
      bucket: "risk",
      topK: RAG_RETRIEVAL_TOP_K,
      query: `查找申请人 ${name} 与项目 ${project.name} 不匹配的证据。项目标签：${projectTags.join("、")}。不适合的人：${notFitParticipant || "未填写"}。包括明确不想做、不擅长相关能力、时间不匹配、退出记录、未完成记录、负面反馈。如果资料中出现“不擅长”“不想做”“不接”“避免”“讨厌”“没经验”，必须作为负向或偏好证据返回。`,
      filters: { ...baseFilters, evidence_polarity: ["negative", "preference"] },
    },
  ];
}

function applyRetrievalPlanOptions(plan, options = {}) {
  const defaultCount = plan.length;
  const maxQueries = Math.min(Math.max(Number(options.maxQueries || defaultCount), 1), defaultCount);
  const topK = Math.min(Math.max(Number(options.topK || RAG_RETRIEVAL_TOP_K), 1), 3);
  return plan.slice(0, maxQueries).map((item) => ({ ...item, topK }));
}

async function buildProjectApplicationRetrievalPlan({ applicant, project, application, identity, options = {} }) {
  const fallbackPlan = buildFallbackProjectApplicationRetrievalPlan({ applicant, project, application });
  if (options.useAiPlan === false || !aiConfigured()) return applyRetrievalPlanOptions(fallbackPlan, options);

  const projectTags = parseJson(project.tags_json, project.tags || []);
  const requiredCapabilities = parseJson(project.required_capabilities_json, []);
  const baseFilters = buildProjectApplicationBaseFilters(applicant.id);
  try {
    const generated = await callAi({
      task: "project_application_retrieval_queries",
      instruction:
        SECRETARY_RETRIEVAL_PROMPT ||
        "你是项目申请审核的检索策略助手。你只负责生成用于 RAG 检索的中文问题，不做最终判断。根据项目资料、申请人自述和平台证据规则，生成5到6个检索问题。问题必须覆盖：项目能力匹配、真实交付、协作稳定性、密封证据链、风险/不匹配。不要生成宽泛问题。不要要求检索用户无权访问的数据。只返回JSON: {\"queries\":[{\"name\":\"英文短标识\",\"bucket\":\"positive|delivery|collaboration|risk\",\"query\":\"具体检索问题\",\"evidence_polarity\":[\"positive|neutral|negative|preference\"]}]}。",
      schema: {
        type: "object",
        required: ["queries"],
        properties: {
          queries: {
            type: "array",
            minItems: 5,
            maxItems: 6,
            items: {
              type: "object",
              required: ["name", "bucket", "query", "evidence_polarity"],
              properties: {
                name: { type: "string" },
                bucket: { enum: ["positive", "delivery", "collaboration", "risk"] },
                query: { type: "string" },
                evidence_polarity: {
                  type: "array",
                  items: { enum: ["positive", "neutral", "negative", "preference"] },
                },
              },
            },
          },
        },
      },
      payload: {
        applicant: {
          id: applicant.id,
          displayName: applicant.display_name,
          experiencePoints: applicant.experience_points,
          communities: identity && identity.identity && identity.identity.communities,
        },
        project: {
          id: project.id,
          name: project.name,
          description: truncate(project.description, 1000),
          tags: projectTags,
          goal: project.goal,
          idealParticipant: project.ideal_participant,
          notFitParticipant: project.not_fit_participant,
          requiredCapabilities,
        },
        application,
        rules: {
          queryCount: RAG_RETRIEVAL_QUERY_COUNT,
          evidenceSourceBoundary: "本人自述只能作为弱证据；项目主理人评价和管理员密封证据是强证据；负向证据不能被解释成正向能力。",
          allowedSourceTypes: baseFilters.source_type,
          allowedVisibility: baseFilters.visibility,
          allowedSourceTrust: baseFilters.source_trust,
        },
      },
    });
    const queries = Array.isArray(generated && generated.queries) ? generated.queries : [];
    const normalized = queries
      .map((item, index) => {
        const bucket = ["positive", "delivery", "collaboration", "risk"].includes(item.bucket) ? item.bucket : "positive";
        const query = text(item.query, 800);
        if (!query) return null;
        const polarity = Array.isArray(item.evidence_polarity) ? item.evidence_polarity.filter((value) =>
          ["positive", "neutral", "negative", "preference"].includes(value)
        ) : [];
        const evidencePolarity = bucket === "risk"
          ? (polarity.filter((value) => value === "negative" || value === "preference").length
            ? polarity.filter((value) => value === "negative" || value === "preference")
            : ["negative", "preference"])
          : (polarity.length ? polarity.filter((value) => value === "positive" || value === "neutral") : ["positive", "neutral"]);
        return {
          name: text(item.name, 60) || `ai_query_${index + 1}`,
          bucket,
          topK: RAG_RETRIEVAL_TOP_K,
          query,
          filters: { ...baseFilters, evidence_polarity: evidencePolarity.length ? evidencePolarity : ["positive", "neutral"] },
          generatedBy: "ai",
        };
      })
      .filter(Boolean)
      .slice(0, RAG_RETRIEVAL_QUERY_COUNT);
    if (normalized.length >= 5) return applyRetrievalPlanOptions(normalized, options);
  } catch (err) {
    console.warn("AI retrieval plan fallback", err.message);
  }
  return applyRetrievalPlanOptions(fallbackPlan, options);
}

function normalizeVectorMatch(match, plan) {
  const metadata = match.metadata || match.payload || {};
  const content = match.content || match.text || match.document || metadata.content || metadata.text || "";
  if (!content) return null;
  const sourceType = metadata.source_type || metadata.sourceType || "";
  const polarity = metadata.evidence_polarity || metadata.polarity || detectPolarity(content);
  return {
    id: metadata.chunk_id || metadata.chunkId || metadata.vector_doc_id || match.id || `${plan.name}_${sha256(content).slice(0, 12)}`,
    bucket: plan.bucket,
    plan: plan.name,
    content: truncate(content, 500),
    sourceType,
    sourceId: metadata.source_id || metadata.sourceId || null,
    sourceTitle: metadata.title || "",
    vectorDocId: metadata.vector_doc_id || match.id || "",
    ownerUserId: metadata.owner_user_id || metadata.ownerUserId || null,
    visibility: metadata.visibility || "",
    sourceTrust: metadata.source_trust || metadata.sourceTrust || "",
    confidence: Number(match.score || match.similarity || metadata.confidence || confidenceForSource(sourceType, polarity)),
    polarity,
  };
}

function vectorMatchAllowed(item, plan, applicantUserId) {
  if (!item) return false;
  const filters = (plan && plan.filters) || {};
  if (filters.owner_user_id && Number(item.ownerUserId || 0) !== Number(filters.owner_user_id)) return false;
  if (Array.isArray(filters.source_type) && item.sourceType && !filters.source_type.includes(item.sourceType)) return false;
  if (Array.isArray(filters.visibility) && item.visibility && !filters.visibility.includes(item.visibility)) return false;
  if (Array.isArray(filters.source_trust) && item.sourceTrust && !filters.source_trust.includes(item.sourceTrust)) return false;
  if (Array.isArray(filters.evidence_polarity) && item.polarity && !filters.evidence_polarity.includes(item.polarity)) return false;
  if (applicantUserId && item.ownerUserId && Number(item.ownerUserId) !== Number(applicantUserId)) return false;
  return true;
}

function bucketEvidence(items) {
  const buckets = { positive: [], delivery: [], collaboration: [], risk: [] };
  const seen = new Set();
  for (const item of items) {
    if (!item || !item.content) continue;
    const key = `${item.sourceType || ""}:${item.sourceId || ""}:${item.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = item.polarity === "negative" || item.polarity === "preference" ? "risk" : item.bucket;
    if (!buckets[bucket]) buckets.positive.push(item);
    else buckets[bucket].push(item);
  }
  Object.keys(buckets).forEach((bucket) => {
    buckets[bucket] = buckets[bucket]
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
      .slice(0, bucket === "risk" ? 4 : 5);
  });
  return buckets;
}

async function filterVectorEvidenceBySqlStatus(items, applicantUserId) {
  const vectorItems = (items || []).filter(Boolean);
  const chunkIds = unique(vectorItems.map((item) => Number(item.id || item.chunkId || 0)).filter((value) => Number.isSafeInteger(value) && value > 0));
  const sourceRefs = vectorItems
    .map((item) => ({
      sourceType: text(item.sourceType, 60),
      sourceId: Number(item.sourceId || 0),
    }))
    .filter((item) => item.sourceType && Number.isSafeInteger(item.sourceId) && item.sourceId > 0);
  if (!chunkIds.length && !sourceRefs.length) return [];
  try {
    const chunkRows = useRdb()
      ? await rdbSelect("rag_chunks", "id,source_id,status", (request) =>
          chunkIds.length
            ? request.in("id", chunkIds).in("status", ["pending", "indexed"]).limit(chunkIds.length)
            : request.in("id", [-1]).limit(1)
        )
      : chunkIds.length
        ? await query(
            `SELECT id,source_id,status FROM rag_chunks
             WHERE id IN (${chunkIds.map(() => "?").join(",")}) AND status IN ('pending','indexed')`,
            chunkIds
          )
        : [];
    const sourceIds = unique(chunkRows.map((row) => Number(row.source_id)).filter(Boolean));
    const sourceRowsByChunk = sourceIds.length
      ? useRdb()
        ? await rdbSelect("rag_sources", "id,owner_user_id,status,visibility", (request) =>
            request.in("id", sourceIds).eq("owner_user_id", applicantUserId).in("status", ["pending", "indexed"]).limit(sourceIds.length)
          )
        : await query(
            `SELECT id,owner_user_id,status,visibility FROM rag_sources
             WHERE id IN (${sourceIds.map(() => "?").join(",")}) AND owner_user_id=? AND status IN ('pending','indexed')`,
            [...sourceIds, applicantUserId]
          )
      : [];
    const sourceRefIds = unique(sourceRefs.map((item) => item.sourceId));
    const sourceRowsByRef = sourceRefIds.length
      ? useRdb()
        ? await rdbSelect("rag_sources", "id,owner_user_id,source_type,source_id,status,visibility", (request) =>
            request
              .eq("owner_user_id", applicantUserId)
              .in("source_id", sourceRefIds)
              .in("status", ["pending", "indexed"])
              .limit(Math.min(sourceRefIds.length * 3, 200))
          )
        : await query(
            `SELECT id,owner_user_id,source_type,source_id,status,visibility
             FROM rag_sources
             WHERE owner_user_id=? AND source_id IN (${sourceRefIds.map(() => "?").join(",")}) AND status IN ('pending','indexed')
             LIMIT ?`,
            [applicantUserId, ...sourceRefIds, Math.min(sourceRefIds.length * 3, 200)]
          )
      : [];
    const activeSourceIds = new Set(sourceRowsByChunk.map((row) => Number(row.id)));
    const activeChunkIds = new Set(chunkRows.filter((row) => activeSourceIds.has(Number(row.source_id))).map((row) => Number(row.id)));
    const activeSourceRefs = new Set(sourceRowsByRef.map((row) => `${row.source_type}:${Number(row.source_id)}`));
    return vectorItems.filter((item) => {
      const chunkId = Number(item.id || item.chunkId || 0);
      if (chunkId) return activeChunkIds.has(chunkId);
      const sourceType = text(item.sourceType, 60);
      const sourceId = Number(item.sourceId || 0);
      return Boolean(sourceType && sourceId && activeSourceRefs.has(`${sourceType}:${sourceId}`));
    });
  } catch (err) {
    console.warn("filter vector evidence by sql status failed", err.message);
    return [];
  }
}

async function fallbackEvidenceSearch(plan, applicantUserId) {
  if (useRdb()) return fallbackEvidenceSearchRdb(plan, applicantUserId);
  const polarityFilter = plan.filters && plan.filters.evidence_polarity;
  const polaritySql = Array.isArray(polarityFilter) ? `AND rc.evidence_polarity IN (${polarityFilter.map(() => "?").join(",")})` : "";
  const rows = await query(
    `SELECT rc.id AS chunk_id, rc.content, rc.content_summary, rc.vector_doc_id, rc.evidence_polarity, rc.confidence,
      rs.source_type, rs.source_id, rs.title, rs.visibility, rs.source_trust
     FROM rag_chunks rc
     JOIN rag_sources rs ON rs.id = rc.source_id
     WHERE rs.owner_user_id = ? AND rs.status IN ('pending','indexed') AND rc.status IN ('pending','indexed')
       AND rs.visibility IN ('match_only','project_visible','admin_only','sealed')
       ${polaritySql}
     ORDER BY rc.confidence DESC, rc.updated_at DESC
     LIMIT ?`,
    [applicantUserId, ...(Array.isArray(polarityFilter) ? polarityFilter : []), Math.max(plan.topK || VECTOR_TOP_K, 3)]
  );
  return rows.map((row) => ({
    id: row.chunk_id,
    bucket: plan.bucket,
    plan: plan.name,
    content: truncate(row.content_summary || row.content, 500),
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceTitle: row.title,
    vectorDocId: row.vector_doc_id,
    ownerUserId: applicantUserId,
    visibility: row.visibility,
    sourceTrust: row.source_trust,
    confidence: Number(row.confidence || 0.7),
    polarity: row.evidence_polarity,
  }));
}

async function fallbackEvidenceSearchRdb(plan, applicantUserId) {
  const polarityFilter = plan.filters && plan.filters.evidence_polarity;
  let chunkRequest = getRdb()
    .from("rag_chunks")
    .select("id,source_id,content,content_summary,vector_doc_id,evidence_polarity,confidence,status,updated_at")
    .in("status", ["pending", "indexed"])
    .order("confidence", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(Math.max(plan.topK || RAG_RETRIEVAL_TOP_K, 3) * 8);
  if (Array.isArray(polarityFilter) && polarityFilter.length) {
    chunkRequest = chunkRequest.in("evidence_polarity", polarityFilter);
  }
  const chunkRows = (assertRdb(await chunkRequest, "RDB 兜底查询 RAG 切片").data || []);
  if (!chunkRows.length) return [];
  const sourceIds = unique(chunkRows.map((row) => row.source_id).filter(Boolean)).slice(0, 50);
  if (!sourceIds.length) return [];
  const sourceRows = await rdbSelect("rag_sources", "id,owner_user_id,source_type,source_id,title,visibility,source_trust,status", (request) =>
    request
      .in("id", sourceIds)
      .eq("owner_user_id", applicantUserId)
      .in("status", ["pending", "indexed"])
      .in("visibility", ["match_only", "project_visible", "admin_only", "sealed"])
      .limit(50)
  );
  const sourceById = new Map(sourceRows.map((row) => [Number(row.id), row]));
  return chunkRows
    .map((row) => {
      const source = sourceById.get(Number(row.source_id));
      if (!source) return null;
      return {
        id: row.id,
        bucket: plan.bucket,
        plan: plan.name,
        content: truncate(row.content_summary || row.content, 500),
        sourceType: source.source_type,
        sourceId: source.source_id,
        sourceTitle: source.title,
        vectorDocId: row.vector_doc_id,
        ownerUserId: source.owner_user_id,
        visibility: source.visibility,
        sourceTrust: source.source_trust,
        confidence: Number(row.confidence || 0.7),
        polarity: row.evidence_polarity,
      };
    })
    .filter((item) => vectorMatchAllowed(item, plan, applicantUserId))
    .slice(0, Math.max(plan.topK || RAG_RETRIEVAL_TOP_K, 3));
}

async function searchEvidence(plan, applicantUserId) {
  try {
    const userRagTag = await getActiveUserRagTag(applicantUserId);
    const userTags = userRagTag && userRagTag.user_tag_id ? [userRagTag.user_tag_id] : [];
    const desiredTopK = Math.max(Number(plan.topK || RAG_RETRIEVAL_TOP_K), 1);
    const candidateTopK = Math.max(desiredTopK, RAG_RETRIEVAL_CANDIDATE_TOP_K);
    const firstPayload = {
      query: plan.query,
      topK: candidateTopK,
      filters: plan.filters,
      plan: plan.name,
      reaiTags: userTags.length ? userTags : undefined,
    };
    const matches = await vectorSearch(firstPayload);
    const normalized = (matches || [])
      .map((match) => normalizeVectorMatch(match, plan))
      .filter((item) => vectorMatchAllowed(item, plan, applicantUserId));
    const activeNormalized = await filterVectorEvidenceBySqlStatus(normalized, applicantUserId);
    if (activeNormalized.length >= desiredTopK) return activeNormalized.slice(0, desiredTopK);
    if (userTags.length) {
      const defaultMatches = await vectorSearch({ query: plan.query, topK: candidateTopK, filters: plan.filters, plan: plan.name });
      const defaultNormalized = (defaultMatches || [])
        .map((match) => normalizeVectorMatch(match, plan))
        .filter((item) => vectorMatchAllowed(item, plan, applicantUserId));
      const activeDefaultNormalized = await filterVectorEvidenceBySqlStatus(defaultNormalized, applicantUserId);
      const merged = bucketEvidence([...activeNormalized, ...activeDefaultNormalized])[plan.bucket] || [];
      if (merged.length) return merged.slice(0, desiredTopK);
    }
    if (activeNormalized.length) return activeNormalized.slice(0, desiredTopK);
  } catch (err) {
    console.warn("vector evidence search fallback", plan.name, err.message);
  }
  return fallbackEvidenceSearch(plan, applicantUserId);
}

async function getApplicationHardFacts(user, project, application, identity) {
  if (useRdb()) return getApplicationHardFactsRdb(user, project, application, identity);
  const [myProjects, eventRows, memoryRows, evidenceRows] = await Promise.all([
    query(
      `SELECT p.id,p.name,p.stage,p.status,pm.role,pm.status AS member_status
       FROM project_members pm JOIN projects p ON p.id=pm.project_id
       WHERE pm.user_id=? ORDER BY pm.joined_at DESC, pm.created_at DESC LIMIT 12`,
      [user.id]
    ),
    query(
      `SELECT e.id,e.title,e.event_type,e.start_time,er.status
       FROM event_registrations er JOIN official_events e ON e.id=er.event_id
       WHERE er.user_id=? ORDER BY e.start_time DESC LIMIT 12`,
      [user.id]
    ),
    query(
      `SELECT content,memory_type,evidence_level,confidence,visibility,status
       FROM user_agent_memories
       WHERE user_id=? AND status='confirmed' ORDER BY confidence DESC, updated_at DESC LIMIT 8`,
      [user.id]
    ),
    query(
      `SELECT content,evidence_type,evidence_level,confidence,visibility,status
       FROM evidence_records
       WHERE user_id=? AND status='confirmed' ORDER BY confidence DESC, created_at DESC LIMIT 8`,
      [user.id]
    ),
  ]);
  return {
    applicant: {
      id: user.id,
      displayName: user.display_name,
      experiencePoints: Number(user.experience_points || 0),
      role: identity.identity.role,
      communities: identity.identity.communities,
    },
    targetProject: {
      id: project.id,
      name: project.name,
      tags: parseJson(project.tags_json, []),
      goal: project.goal,
      description: truncate(project.description, 500),
      idealParticipant: project.ideal_participant || "",
      notFitParticipant: project.not_fit_participant || "",
      requiredCapabilities: parseJson(project.required_capabilities_json, []),
    },
    application,
    projects: myProjects,
    events: eventRows,
    confirmedMemories: memoryRows.map((item) => ({ ...item, content: truncate(item.content, 160) })),
    confirmedEvidence: evidenceRows.map((item) => ({ ...item, content: truncate(item.content, 160) })),
  };
}

async function safeRdbRead(table, columns, build) {
  try {
    return await rdbSelect(table, columns, build);
  } catch (err) {
    console.warn("safeRdbRead fallback", table, err.message);
    return [];
  }
}

async function getApplicationHardFactsRdb(user, project, application, identity) {
  const [memberRows, registrationRows, memoryRows, evidenceRows] = await Promise.all([
    safeRdbRead("project_members", "project_id,role,status,joined_at,created_at", (request) =>
      request.eq("user_id", user.id).order("joined_at", { ascending: false }).limit(12)
    ),
    safeRdbRead("event_registrations", "event_id,status,created_at", (request) =>
      request.eq("user_id", user.id).order("created_at", { ascending: false }).limit(12)
    ),
    safeRdbRead("user_agent_memories", "content,memory_type,evidence_level,confidence,visibility,status,updated_at", (request) =>
      request.eq("user_id", user.id).eq("status", "confirmed").order("confidence", { ascending: false }).limit(8)
    ),
    safeRdbRead("evidence_records", "content,evidence_type,evidence_level,confidence,visibility,status,created_at", (request) =>
      request.eq("user_id", user.id).eq("status", "confirmed").order("confidence", { ascending: false }).limit(8)
    ),
  ]);
  const projectIds = unique(memberRows.map((item) => item.project_id).filter(Boolean)).slice(0, 12);
  const eventIds = unique(registrationRows.map((item) => item.event_id).filter(Boolean)).slice(0, 12);
  const [projectRows, eventRows] = await Promise.all([
    projectIds.length
      ? safeRdbRead("projects", "id,name,stage,status", (request) => request.in("id", projectIds).limit(12))
      : [],
    eventIds.length
      ? safeRdbRead("official_events", "id,title,event_type,start_time", (request) => request.in("id", eventIds).limit(12))
      : [],
  ]);
  const projectById = new Map(projectRows.map((item) => [Number(item.id), item]));
  const eventById = new Map(eventRows.map((item) => [Number(item.id), item]));
  const myProjects = memberRows.map((member) => {
    const projectRow = projectById.get(Number(member.project_id)) || {};
    return {
      id: member.project_id,
      name: projectRow.name || "",
      stage: projectRow.stage || "",
      status: projectRow.status || "",
      role: member.role,
      member_status: member.status,
    };
  });
  const myEvents = registrationRows.map((registration) => {
    const eventRow = eventById.get(Number(registration.event_id)) || {};
    return {
      id: registration.event_id,
      title: eventRow.title || "",
      event_type: eventRow.event_type || "",
      start_time: eventRow.start_time || null,
      status: registration.status,
    };
  });
  return {
    applicant: {
      id: user.id,
      displayName: user.display_name,
      experiencePoints: Number(user.experience_points || 0),
      role: identity.identity.role,
      communities: identity.identity.communities,
    },
    targetProject: {
      id: project.id,
      name: project.name,
      tags: parseJson(project.tags_json, []),
      goal: project.goal,
      description: truncate(project.description, 500),
      idealParticipant: project.ideal_participant || "",
      notFitParticipant: project.not_fit_participant || "",
      requiredCapabilities: parseJson(project.required_capabilities_json, []),
    },
    application,
    projects: myProjects,
    events: myEvents,
    confirmedMemories: memoryRows.map((item) => ({ ...item, content: truncate(item.content, 160) })),
    confirmedEvidence: evidenceRows.map((item) => ({ ...item, content: truncate(item.content, 160) })),
  };
}

async function buildProjectApplicationReviewContext({ user, project, application, identity, retrievalOptions = {} }) {
  const retrievalPlan = await buildProjectApplicationRetrievalPlan({
    applicant: user,
    project,
    application,
    identity,
    options: retrievalOptions,
  });
  const planResults = await Promise.all(retrievalPlan.map(async (plan) => {
    try {
      return await searchEvidence(plan, user.id);
    } catch (err) {
      console.warn("parallel evidence search failed", plan.name, err.message);
      return [];
    }
  }));
  const results = planResults.flat();
  const evidence = bucketEvidence(results);
  const hardFacts = await getApplicationHardFacts(user, project, application, identity);
  return {
    hardFacts,
    retrievalPlan: retrievalPlan.map((plan) => ({ name: plan.name, bucket: plan.bucket, query: plan.query, topK: plan.topK })),
    evidence,
    outputRequirements: {
      mustCiteEvidenceIds: true,
      allowedStatus: ["pass", "revise", "reject"],
      maxSummaryChars: 180,
    },
  };
}

async function runProjectApplicationAiReview({ user, project, application, identity, reviewContext }) {
  const fallback = {
    status: "pass",
    summary: "秘书已收下申请。AI 初审暂未完成，先递交主理人查看。",
  };
  if (!aiConfigured()) return fallback;
  try {
    const context = reviewContext || await buildProjectApplicationReviewContext({ user, project, application, identity });
    const generated = await callAi({
      task: "project_application_secretary_review",
      instruction:
        SECRETARY_PROJECT_REVIEW_PROMPT ||
        "你是项目主理人的功能型秘书。你只能基于 hardFacts 和 evidence 判断项目申请是否值得递交主理人。本人自述是弱证据，项目主理人评价和管理员密封证据是强证据。风险/不匹配证据不得当作正向能力。证据不足时不要编造。只返回JSON: {\"status\":\"pass|revise|reject\",\"summary\":\"不超过180字，必须说明主要依据、风险或证据不足\"}。",
      schema: {
        type: "object",
        required: ["status", "summary"],
        properties: {
          status: { enum: ["pass", "revise", "reject"] },
          summary: { type: "string" },
        },
      },
      payload: context,
    });
    if (generated && ["pass", "revise", "reject"].includes(generated.status)) {
      return { status: generated.status, summary: text(generated.summary, 1000) || fallback.summary };
    }
  } catch (err) {
    console.warn("secretary review fallback", err.message);
  }
  return fallback;
}

async function vectorSearch(payload) {
  if (VECTOR_PROVIDER === "reai_vdb") return reaiVectorSearch(payload);
  if (!VECTOR_SEARCH_URL || !VECTOR_SEARCH_API_KEY) return [];
  const requestPayload = {
    provider: VECTOR_PROVIDER,
    collection: VECTOR_COLLECTION,
    namespace: VECTOR_NAMESPACE,
    ...payload,
  };
  const response = await httpJson(
    VECTOR_SEARCH_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VECTOR_SEARCH_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(requestPayload)),
      },
      timeoutCode: "VECTOR_TIMEOUT",
      timeoutMessage: "向量检索接口超时",
    },
    requestPayload,
    VECTOR_REQUEST_TIMEOUT_MS
  );
  return response.matches || response.data || [];
}

async function vectorUpsert(payload) {
  if (VECTOR_PROVIDER === "reai_vdb") return reaiVectorUpsert(payload);
  if (!VECTOR_UPSERT_URL || !VECTOR_UPSERT_API_KEY) {
    throw codedError("VECTOR_UPSERT_NOT_CONFIGURED", "VectorDB 写入接口尚未配置");
  }
  const requestPayload = {
    provider: VECTOR_PROVIDER,
    collection: VECTOR_COLLECTION,
    namespace: VECTOR_NAMESPACE,
    ...payload,
  };
  return httpJson(
    VECTOR_UPSERT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VECTOR_UPSERT_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(JSON.stringify(requestPayload)),
      },
      timeoutCode: "VECTOR_TIMEOUT",
      timeoutMessage: "向量写入接口超时",
    },
    requestPayload,
    VECTOR_REQUEST_TIMEOUT_MS
  );
}

function vectorUpsertConfigured() {
  if (VECTOR_PROVIDER === "reai_vdb") return Boolean(REAI_VDB_PID && getReaiDefaultTags().length && REAI_API_KEY);
  return Boolean(VECTOR_UPSERT_URL && VECTOR_UPSERT_API_KEY);
}

function vectorSearchConfigured() {
  if (VECTOR_PROVIDER === "reai_vdb") return Boolean(REAI_VDB_PID && getReaiDefaultTags().length && REAI_API_KEY);
  return Boolean(VECTOR_SEARCH_URL && VECTOR_SEARCH_API_KEY);
}

function getReaiDefaultTags() {
  return parseList(process.env.REAI_DEFAULT_TAG_IDS || REAI_VDB_ID);
}

function getReaiSearchTags(payload = {}) {
  const explicitTags = payload.reaiTags || (payload.filters && payload.filters.reai_tags);
  const tags = parseList(explicitTags);
  return tags.length ? tags : getReaiDefaultTags();
}

function getReaiDocumentTags(document = {}) {
  const metadata = document.metadata || {};
  return unique([
    ...getReaiDefaultTags(),
    ...parseList(document.reaiTags),
    ...parseList(metadata.reai_tags),
  ]);
}

function parseReaiKnowledgeContent(raw) {
  const content = String(raw || "").trim();
  const match = content.match(/^DAIMAO_META\s+({.*?})\s*\n([\s\S]*)$/);
  if (!match) return { content, metadata: {} };
  try {
    return { content: match[2].trim(), metadata: JSON.parse(match[1]) };
  } catch (err) {
    return { content, metadata: {} };
  }
}

async function reaiVectorSearch(payload) {
  if (!vectorSearchConfigured()) return [];
  const url = `${trimTrailingSlash(REAI_VDB_BASE_URL)}/vdb/${encodeURIComponent(REAI_VDB_PID)}/vector`;
  const tags = getReaiSearchTags(payload);
  if (!tags.length) return [];
  const response = await httpJson(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeoutCode: "REAI_SEARCH_TIMEOUT",
      timeoutMessage: "ReAI 知识库检索超时",
    },
    {
      content: payload.query || payload.content || "",
      query: {
        tags,
        _limit: Math.min(Math.max(Number(payload.topK || VECTOR_TOP_K), 1), 20),
      },
    },
    VECTOR_REQUEST_TIMEOUT_MS
  );
  const list = response.data && Array.isArray(response.data.list) ? response.data.list : [];
  return list.map((item, index) => {
    const parsed = parseReaiKnowledgeContent(item.content || item.text || item);
    return {
      id: parsed.metadata.chunk_id || parsed.metadata.vector_doc_id || `reai_${index}_${sha256(parsed.content).slice(0, 12)}`,
      score: item.score || item.similarity || item.distance || 0,
      content: parsed.content,
      metadata: {
        ...parsed.metadata,
        source_type: parsed.metadata.source_type || "external_knowledge",
      },
    };
  });
}

async function reaiVectorUpsert(payload) {
  if (!vectorUpsertConfigured()) {
    throw codedError("REAI_UPSERT_NOT_CONFIGURED", "ReAI 知识库写入接口尚未配置，RAG 索引队列保持 pending");
  }
  const baseUrl = trimTrailingSlash(REAI_VDB_UPSERT_URL || `${trimTrailingSlash(REAI_VDB_BASE_URL)}/vdb/${encodeURIComponent(REAI_VDB_PID)}`);
  const results = [];
  for (const document of payload.documents || []) {
    const existingObjectId = isReaiObjectId(document.id) ? document.id : "";
    const url = existingObjectId ? `${baseUrl}/db/${encodeURIComponent(existingObjectId)}` : baseUrl;
    const tags = getReaiDocumentTags(document);
    if (!tags.length) throw codedError("REAI_TAG_NOT_CONFIGURED", "ReAI 知识库 tag 尚未配置");
    const response = await httpJson(
      url,
      {
        method: existingObjectId ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${REAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeoutCode: "REAI_UPSERT_TIMEOUT",
        timeoutMessage: "ReAI 知识库写入超时",
      },
      {
        content: formatReaiKnowledgeContent(document),
        tags,
      },
      VECTOR_REQUEST_TIMEOUT_MS
    );
    const vectorDocId =
      (response.data && response.data.vdb && response.data.vdb.objectId) ||
      (response.data && response.data.objectId) ||
      response.objectId ||
      existingObjectId ||
      document.id;
    results.push({
      chunkId: document.metadata && document.metadata.chunk_id,
      vectorDocId,
      tags,
      status: response.status || response.message || "ok",
    });
  }
  return { provider: "reai_vdb", upserted: results.length, documents: results };
}

function reaiConfiguredForAdminPatch() {
  return Boolean(REAI_VDB_PID && REAI_API_KEY);
}

function validateReaiTagId(tagId) {
  const value = text(tagId, 80);
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(value)) throw codedError("VALIDATION_ERROR", "ReAI tagId 格式不合法");
  return value;
}

function getReaiProjectPayload(event) {
  const input = event.projectPayload || event.reaiProjectPayload || event.payload;
  const payload =
    (input && input.options && input) ||
    (input && input.project && input.project) ||
    (input && input.data && input.data.project && input.data.project) ||
    (input && input.data && input.data);
  if (!payload || typeof payload !== "object") {
    throw codedError("VALIDATION_ERROR", "请传入完整 projectPayload，必须包含 options.vdbFolderArr");
  }
  const folders = payload.options && payload.options.vdbFolderArr;
  if (!Array.isArray(folders)) {
    throw codedError("VALIDATION_ERROR", "projectPayload.options.vdbFolderArr 不存在，不能安全 PATCH ReAI 项目");
  }
  return JSON.parse(JSON.stringify(payload));
}

function patchReaiProjectTagPayload(projectPayload, operation, tagId, tagName) {
  const payload = JSON.parse(JSON.stringify(projectPayload));
  payload.options = payload.options || {};
  const before = Array.isArray(payload.options.vdbFolderArr) ? payload.options.vdbFolderArr : [];
  const folders = before.map((item) => ({ ...item }));
  const index = folders.findIndex((item) => item && item.objectId === tagId);
  if (operation === "create") {
    if (index < 0) folders.push({ objectId: tagId, name: tagName || tagId, type: "file" });
    else folders[index] = { ...folders[index], name: tagName || folders[index].name || tagId, type: folders[index].type || "file" };
  } else if (operation === "rename") {
    if (index < 0) throw codedError("REAI_TAG_NOT_FOUND", "要重命名的 ReAI tag 不在 projectPayload.options.vdbFolderArr 中");
    folders[index] = { ...folders[index], name: tagName || folders[index].name || tagId, type: folders[index].type || "file" };
  } else {
    throw codedError("VALIDATION_ERROR", "operation 只支持 create 或 rename");
  }
  payload.options.vdbFolderArr = folders;
  return {
    payload,
    before: before.map((item) => ({ objectId: item.objectId, name: item.name, type: item.type })),
    after: folders.map((item) => ({ objectId: item.objectId, name: item.name, type: item.type })),
  };
}

async function reaiPatchProjectPayload(projectPayload) {
  if (!reaiConfiguredForAdminPatch()) throw codedError("REAI_NOT_CONFIGURED", "ReAI PID/API_KEY 未配置");
  const url = `${trimTrailingSlash(REAI_VDB_BASE_URL)}/app/projects/${encodeURIComponent(REAI_VDB_PID)}`;
  return httpJson(
    url,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${REAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeoutCode: "REAI_PROJECT_PATCH_TIMEOUT",
      timeoutMessage: "ReAI 项目 tag 配置更新超时",
    },
    projectPayload,
    VECTOR_REQUEST_TIMEOUT_MS
  );
}

async function reaiGetProjectPayload() {
  if (!reaiConfiguredForAdminPatch()) throw codedError("REAI_NOT_CONFIGURED", "ReAI PID/API_KEY 未配置");
  const url = `${trimTrailingSlash(REAI_VDB_BASE_URL)}/app/projects/${encodeURIComponent(REAI_VDB_PID)}`;
  return httpJson(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${REAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeoutCode: "REAI_PROJECT_GET_TIMEOUT",
      timeoutMessage: "ReAI 项目配置读取超时",
    },
    null,
    VECTOR_REQUEST_TIMEOUT_MS
  );
}

async function adminReaiGetProject(event, user) {
  await requireAdmin(user);
  const response = await reaiGetProjectPayload();
  const project = response && response.data && response.data.project ? response.data.project : response.project || response.data || response;
  const folders = project && project.options && Array.isArray(project.options.vdbFolderArr) ? project.options.vdbFolderArr : [];
  return {
    pid: REAI_VDB_PID,
    folderCount: folders.length,
    folders: folders.map((item) => ({ objectId: item.objectId, name: item.name, type: item.type })),
    project,
  };
}

async function adminReaiProjectTagPatch(event, user) {
  await requireAdmin(user);
  const operation = event.operation === "rename" ? "rename" : "create";
  const tagId = validateReaiTagId(event.tagId || event.userTagId || generateReaiTagId());
  const tagName = text(event.tagName || event.name || tagId, 120);
  const projectPayload = event.projectPayload || event.reaiProjectPayload || event.payload
    ? getReaiProjectPayload(event)
    : getReaiProjectPayload({ projectPayload: await reaiGetProjectPayload() });
  const patched = patchReaiProjectTagPayload(projectPayload, operation, tagId, tagName);
  const dryRun = event.dryRun !== false;
  if (dryRun) {
    return {
      dryRun: true,
      operation,
      tagId,
      tagName,
      before: patched.before,
      after: patched.after,
      warning: "dryRun=true，不会调用 ReAI。正式 PATCH 需 dryRun=false 且 confirm=patch-reai-project-tags。",
    };
  }
  if (event.confirm !== "patch-reai-project-tags") {
    throw codedError("CONFIRM_REQUIRED", "正式 PATCH ReAI 项目 tag 需传入 confirm=patch-reai-project-tags");
  }
  const response = await reaiPatchProjectPayload(patched.payload);
  await adminLog(user, `reai_project_tag_${operation}`, "reai_tag", null, { tagId, tagName });
  return { dryRun: false, operation, tagId, tagName, response };
}

async function adminReaiPatchVdbTags(event, user) {
  await requireAdmin(user);
  if (!reaiConfiguredForAdminPatch()) throw codedError("REAI_NOT_CONFIGURED", "ReAI PID/API_KEY 未配置");
  const objectId = text(event.objectId || event.vectorDocId, 120);
  if (!objectId) throw codedError("VALIDATION_ERROR", "objectId 不能为空");
  const tags = unique(parseList(event.tags || event.reaiTags));
  if (!tags.length) throw codedError("VALIDATION_ERROR", "tags 不能为空");
  const body = { tags };
  if (event.content !== undefined) body.content = String(event.content || "");
  const dryRun = event.dryRun !== false;
  const url = `${trimTrailingSlash(REAI_VDB_BASE_URL)}/vdb/${encodeURIComponent(REAI_VDB_PID)}/db/${encodeURIComponent(objectId)}`;
  if (dryRun) {
    return {
      dryRun: true,
      url,
      body,
      warning: "dryRun=true，不会调用 ReAI。正式 PATCH 需 dryRun=false 且 confirm=patch-reai-vdb-tags。",
    };
  }
  if (event.confirm !== "patch-reai-vdb-tags") {
    throw codedError("CONFIRM_REQUIRED", "正式 PATCH ReAI 单条知识 tags 需传入 confirm=patch-reai-vdb-tags");
  }
  const response = await httpJson(
    url,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${REAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeoutCode: "REAI_VDB_PATCH_TIMEOUT",
      timeoutMessage: "ReAI 单条知识 tags 更新超时",
    },
    body,
    VECTOR_REQUEST_TIMEOUT_MS
  );
  await adminLog(user, "reai_patch_vdb_tags", "reai_vdb", null, { objectId, tags });
  return { dryRun: false, objectId, tags, response };
}

async function adminEnsureUserRagTag(event, user) {
  await requireAdmin(user);
  const targetUserId = id(event.userId || event.targetUserId);
  const targetUser = await findUserById(targetUserId);
  const memberships = await getCommunityMemberships(targetUserId);
  if (!memberships.length && !event.force) {
    return {
      eligible: false,
      reason: "用户没有有效社区认证。若要强制创建，请传 force=true。",
      user: { id: targetUser.id, displayName: targetUser.display_name },
    };
  }
  const existing = await getActiveUserRagTag(targetUserId);
  if (existing && !event.recreate) {
    return { eligible: true, existed: true, tag: existing };
  }
  const tagId = validateReaiTagId(event.tagId || event.userTagId || generateReaiTagId());
  const tagName = text(event.tagName || `${REAI_USER_TAG_PREFIX}${targetUserId}_${targetUser.display_name || targetUserId}`, 120);
  const dryRun = event.dryRun !== false;
  let patchResult = null;
  if (event.projectPayload) {
    const projectPayload = getReaiProjectPayload(event);
    const patched = patchReaiProjectTagPayload(projectPayload, "create", tagId, tagName);
    if (dryRun) {
      return {
        eligible: true,
        dryRun: true,
        user: { id: targetUser.id, displayName: targetUser.display_name },
        tag: { userTagId: tagId, tagName },
        before: patched.before,
        after: patched.after,
        warning: "dryRun=true，不会创建 SQL 绑定，也不会 PATCH ReAI。正式创建需 dryRun=false 且 confirm=ensure-user-rag-tag。",
      };
    }
    if (event.confirm !== "ensure-user-rag-tag") {
      throw codedError("CONFIRM_REQUIRED", "正式创建用户 ReAI tag 需传入 confirm=ensure-user-rag-tag");
    }
    patchResult = await reaiPatchProjectPayload(patched.payload);
  } else if (!dryRun && event.confirm !== "ensure-user-rag-tag") {
    throw codedError("CONFIRM_REQUIRED", "正式写入用户 tag 绑定需传入 confirm=ensure-user-rag-tag");
  } else if (dryRun) {
    return {
      eligible: true,
      dryRun: true,
      user: { id: targetUser.id, displayName: targetUser.display_name },
      tag: { userTagId: tagId, tagName },
      warning: "未传 projectPayload，只能预览或仅写 SQL 绑定；自动创建 ReAI tag 需要完整 projectPayload。",
    };
  }
  const saved = await saveUserRagTagRecord({
    userId: targetUserId,
    userTagId: tagId,
    tagName,
    status: "active",
    createdReason: event.reason || "admin_ensure",
  });
  await adminLog(user, "ensure_user_rag_tag", "user", targetUserId, { tagId, tagName });
  return { eligible: true, existed: false, tag: saved, patchResult };
}

async function adminRequeueUserRagIndex(event, user) {
  await requireAdmin(user);
  const targetUserId = id(event.userId || event.targetUserId);
  const targetUser = await findUserById(targetUserId);
  const userRagTag = await getActiveUserRagTag(targetUserId);
  if (!userRagTag || !userRagTag.user_tag_id) {
    throw codedError("USER_RAG_TAG_MISSING", "该用户还没有 active 的 ReAI 个人 tag，请先执行 adminEnsureUserRagTag");
  }
  const limit = Math.min(Math.max(Number(event.limit || 200), 1), 1000);
  let sources = [];
  if (useRdb()) {
    sources = await rdbSelect("rag_sources", "id,source_type,title,status", (request) =>
      request.eq("owner_user_id", targetUserId).in("status", ["pending", "indexed", "failed", "stale"]).limit(limit)
    );
    for (const source of sources) {
      await rdbUpdate("rag_sources", { status: "stale", error_message: null }, (request) => request.eq("id", source.id));
      await rdbUpdate("rag_chunks", { status: "pending", indexed_at: null }, (request) =>
        request.eq("source_id", source.id).in("status", ["indexed", "failed", "pending"])
      );
      await rdbInsert("rag_index_jobs", { source_id: source.id, job_type: "reindex", status: "pending" });
    }
  } else {
    sources = await query(
      "SELECT id,source_type,title,status FROM rag_sources WHERE owner_user_id=? AND status IN ('pending','indexed','failed','stale') LIMIT ?",
      [targetUserId, limit]
    );
    for (const source of sources) {
      await query("UPDATE rag_sources SET status='stale',error_message=NULL WHERE id=?", [source.id]);
      await query("UPDATE rag_chunks SET status='pending',indexed_at=NULL WHERE source_id=? AND status IN ('indexed','failed','pending')", [source.id]);
      await query("INSERT INTO rag_index_jobs (source_id,job_type,status) VALUES (?,'reindex','pending')", [source.id]);
    }
  }
  await adminLog(user, "requeue_user_rag_index", "user", targetUserId, {
    sourceCount: sources.length,
    userTagId: userRagTag.user_tag_id,
  });
  return {
    user: { id: targetUser.id, displayName: targetUser.display_name },
    userTag: { userTagId: userRagTag.user_tag_id, tagName: userRagTag.tag_name },
    queuedSources: sources.length,
    sources: sources.slice(0, 50),
  };
}

function buildVectorDocuments(job, chunks) {
  const sourceMetadata = parseJson(job.metadata_json, {});
  return chunks.map((chunk) => {
    const content = String(chunk.content || "");
    const vectorDocId = chunk.vector_doc_id || `rag_${job.source_id}_${chunk.chunk_index}`;
    return {
      id: vectorDocId,
      content,
      short_text: truncate(chunk.content_summary || content, 220),
      text_hash: sha256(content),
      metadata: {
        rag_source_id: job.source_id,
        chunk_id: chunk.id,
        source_type: job.source_type,
        source_id: job.business_source_id || job.source_id,
        owner_user_id: job.owner_user_id || null,
        project_id: job.project_id || null,
        event_id: job.event_id || null,
        community_id: job.community_id || null,
        title: job.title || "",
        tags: parseJson(job.tags_json, []),
        visibility: job.visibility || "match_only",
        source_trust: job.source_trust || "self_reported",
        version: Number(job.version || 1),
        evidence_polarity: chunk.evidence_polarity || detectPolarity(content),
        confidence: Number(chunk.confidence || confidenceForSource(job.source_type, chunk.evidence_polarity)),
        short_text: truncate(chunk.content_summary || content, 220),
        text_hash: sha256(content),
        reai_tags: unique([
          ...parseList(sourceMetadata.reai_tags),
          ...parseList(job.user_reai_tag_id),
        ]),
        metadata: sourceMetadata,
      },
    };
  });
}

function isReaiObjectId(value) {
  const idValue = String(value || "");
  return Boolean(idValue) && !/^rag_\d+_\d+$/.test(idValue);
}

function formatReaiKnowledgeContent(document) {
  const metadata = document.metadata || {};
  const payload = {
    chunk_id: metadata.chunk_id || null,
    rag_source_id: metadata.rag_source_id || null,
    source_type: metadata.source_type || "",
    source_id: metadata.source_id || null,
    owner_user_id: metadata.owner_user_id || null,
    project_id: metadata.project_id || null,
    event_id: metadata.event_id || null,
    community_id: metadata.community_id || null,
    reai_tags: parseList(metadata.reai_tags),
    visibility: metadata.visibility || "match_only",
    source_trust: metadata.source_trust || "self_reported",
    evidence_polarity: metadata.evidence_polarity || "neutral",
    confidence: Number(metadata.confidence || 0),
    text_hash: metadata.text_hash || document.text_hash || sha256(document.content),
  };
  return `DAIMAO_META ${JSON.stringify(payload)}\n${String(document.content || "").trim()}`;
}

async function applyVectorUpsertResultsMysql(connection, sourceId, response) {
  const documents = response && Array.isArray(response.documents) ? response.documents : [];
  for (const document of documents) {
    if (!document.chunkId || !document.vectorDocId) continue;
    await connection.execute(
      "UPDATE rag_chunks SET vector_doc_id=? WHERE id=? AND source_id=?",
      [String(document.vectorDocId), Number(document.chunkId), Number(sourceId)]
    );
  }
}

async function applyVectorUpsertResultsRdb(sourceId, response) {
  const documents = response && Array.isArray(response.documents) ? response.documents : [];
  for (const document of documents) {
    if (!document.chunkId || !document.vectorDocId) continue;
    await rdbUpdate(
      "rag_chunks",
      { vector_doc_id: String(document.vectorDocId) },
      (request) => request.eq("id", document.chunkId).eq("source_id", sourceId)
    );
  }
}

async function processRagIndexJobs(event, user) {
  if (event.schedulerSecret) {
    if (!process.env.SCHEDULER_SECRET || event.schedulerSecret !== process.env.SCHEDULER_SECRET) {
      throw codedError("FORBIDDEN", "定时任务密钥不正确");
    }
  } else {
    await requireAdmin(user);
  }
  const limit = Math.min(Math.max(Number(event.limit || 10), 1), 50);
  if (!vectorUpsertConfigured()) {
    return {
      checked: 0,
      completed: 0,
      failed: 0,
      skipped: true,
      code: "VECTOR_UPSERT_NOT_CONFIGURED",
      message: "VectorDB 写入接口尚未配置，RAG 索引队列保持 pending",
      provider: VECTOR_PROVIDER,
      collection: VECTOR_COLLECTION,
      namespace: VECTOR_NAMESPACE,
    };
  }
  if (useRdb()) return processRagIndexJobsRdb(limit);
  const jobs = await query(
    `SELECT rij.*, rs.source_type, rs.source_id AS business_source_id, rs.owner_user_id, rs.project_id, rs.event_id,
      rs.community_id, rs.title, rs.tags_json, rs.visibility, rs.source_trust, rs.version, rs.metadata_json
     FROM rag_index_jobs rij
     JOIN rag_sources rs ON rs.id = rij.source_id
     WHERE rij.status='pending' AND rs.status IN ('pending','failed','stale','indexing')
     ORDER BY rij.created_at ASC LIMIT ${limit}`
  );
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    await query("UPDATE rag_index_jobs SET status='processing',attempts=attempts+1,started_at=NOW() WHERE id=?", [job.id]);
    await query("UPDATE rag_sources SET status='indexing' WHERE id=?", [job.source_id]);
    try {
      const chunks = await query(
        `SELECT * FROM rag_chunks WHERE source_id=? AND status IN ('pending','failed') ORDER BY chunk_index ASC`,
        [job.source_id]
      );
      const userRagTag = job.owner_user_id ? await getActiveUserRagTag(job.owner_user_id) : null;
      if (userRagTag && userRagTag.user_tag_id) job.user_reai_tag_id = userRagTag.user_tag_id;
      const documents = buildVectorDocuments(job, chunks);
      const upsertResponse = documents.length
        ? await vectorUpsert({ documents, sourceId: job.source_id, jobType: job.job_type })
        : null;
      await transaction(async (connection) => {
        if (upsertResponse) await applyVectorUpsertResultsMysql(connection, job.source_id, upsertResponse);
        await connection.execute(
          "UPDATE rag_chunks SET status='indexed',indexed_at=NOW() WHERE source_id=? AND status IN ('pending','failed')",
          [job.source_id]
        );
        await connection.execute("UPDATE rag_sources SET status='indexed',last_indexed_at=NOW(),error_message=NULL WHERE id=?", [job.source_id]);
        await connection.execute("UPDATE rag_index_jobs SET status='completed',completed_at=NOW(),error_message=NULL WHERE id=?", [job.id]);
      });
      completed += 1;
    } catch (err) {
      await query("UPDATE rag_sources SET status='failed',error_message=? WHERE id=?", [text(err.message, 4000), job.source_id]);
      await query("UPDATE rag_index_jobs SET status='failed',completed_at=NOW(),error_message=? WHERE id=?", [text(err.message, 4000), job.id]);
      failed += 1;
    }
  }
  return { checked: jobs.length, completed, failed };
}

async function processRagIndexJobsRdb(limit) {
  const pendingJobs = await rdbSelect("rag_index_jobs", "*", (request) =>
    request.eq("status", "pending").order("created_at", { ascending: true }).limit(limit)
  );
  const sourceIds = unique(pendingJobs.map((job) => String(job.source_id))).map(Number).filter(Boolean);
  const sources = sourceIds.length
    ? await rdbSelect("rag_sources", "*", (request) =>
        request.in("id", sourceIds).in("status", ["pending", "failed", "stale", "indexing"]).limit(sourceIds.length)
      )
    : [];
  const sourceMap = new Map(sources.map((source) => [Number(source.id), source]));
  let completed = 0;
  let failed = 0;
  const now = nowDateTime();

  for (const pendingJob of pendingJobs) {
    const jobSource = sourceMap.get(Number(pendingJob.source_id));
    if (!jobSource) {
      await rdbUpdate(
        "rag_index_jobs",
        {
          status: "failed",
          attempts: Number(pendingJob.attempts || 0) + 1,
          completed_at: now,
          error_message: "RAG source 不存在或状态不可索引",
        },
        (request) => request.eq("id", pendingJob.id)
      );
      failed += 1;
      continue;
    }

    const job = {
      ...pendingJob,
      source_type: jobSource.source_type,
      business_source_id: jobSource.source_id,
      owner_user_id: jobSource.owner_user_id,
      project_id: jobSource.project_id,
      event_id: jobSource.event_id,
      community_id: jobSource.community_id,
      title: jobSource.title,
      tags_json: jobSource.tags_json,
      visibility: jobSource.visibility,
      source_trust: jobSource.source_trust,
      version: jobSource.version,
      metadata_json: jobSource.metadata_json,
    };

    await rdbUpdate(
      "rag_index_jobs",
      { status: "processing", attempts: Number(pendingJob.attempts || 0) + 1, started_at: nowDateTime() },
      (request) => request.eq("id", pendingJob.id)
    );
    await rdbUpdate("rag_sources", { status: "indexing" }, (request) => request.eq("id", job.source_id));

    try {
      const chunks = await rdbSelect("rag_chunks", "*", (request) =>
        request.eq("source_id", job.source_id).in("status", ["pending", "failed"]).order("chunk_index", { ascending: true }).limit(200)
      );
      const userRagTag = job.owner_user_id ? await getActiveUserRagTag(job.owner_user_id) : null;
      if (userRagTag && userRagTag.user_tag_id) job.user_reai_tag_id = userRagTag.user_tag_id;
      const documents = buildVectorDocuments(job, chunks);
      const upsertResponse = documents.length
        ? await vectorUpsert({ documents, sourceId: job.source_id, jobType: job.job_type })
        : null;

      const indexedAt = nowDateTime();
      if (upsertResponse) await applyVectorUpsertResultsRdb(job.source_id, upsertResponse);
      for (const chunk of chunks) {
        await rdbUpdate("rag_chunks", { status: "indexed", indexed_at: indexedAt }, (request) => request.eq("id", chunk.id));
      }
      await rdbUpdate(
        "rag_sources",
        { status: "indexed", last_indexed_at: indexedAt, error_message: null },
        (request) => request.eq("id", job.source_id)
      );
      await rdbUpdate(
        "rag_index_jobs",
        { status: "completed", completed_at: indexedAt, error_message: null },
        (request) => request.eq("id", pendingJob.id)
      );
      completed += 1;
    } catch (err) {
      const message = text(err.message, 4000);
      await rdbUpdate("rag_sources", { status: "failed", error_message: message }, (request) => request.eq("id", job.source_id));
      await rdbUpdate(
        "rag_index_jobs",
        { status: "failed", completed_at: nowDateTime(), error_message: message },
        (request) => request.eq("id", pendingJob.id)
      );
      failed += 1;
    }
  }
  return {
    checked: pendingJobs.length,
    completed,
    failed,
    provider: VECTOR_PROVIDER,
    collection: VECTOR_COLLECTION,
    namespace: VECTOR_NAMESPACE,
  };
}

const actions = {
  healthCheck,
  listProjects,
  listMyProjects,
  getMyIdentity,
  getProject,
  createProject,
  applyProject,
  processProjectApplicationReviews,
  processRagIndexJobs,
  toggleWatch,
  publishUpdate,
  updateProjectUpdate,
  createMeetingRequest,
  respondMeetingRequest,
  respondProjectApplication,
  inviteMember,
  acceptProjectInvitation,
  listEvents,
  registerEvent,
  getAgentProfile,
  saveAgentProfile,
  listNotifications,
  markNotificationRead,
  getProjectSpace,
  createProjectRecord,
  analyzeProjectRecord,
  confirmReminderIntent,
  authorizeReminder,
  getRecommendations,
  adminList,
  adminListUsers,
  adminSetUserStatus,
  adminSetUserAdmin,
  adminListProjects,
  adminCreateProject,
  adminUpdateProject,
  adminGetProjectManagement,
  adminUpsertProjectMember,
  adminCreateProjectUpdate,
  adminUpdateProjectUpdate,
  adminCompleteProject,
  adminListEvents,
  adminCreateEvent,
  adminUpdateEvent,
  adminReviewCandidate,
  adminCreateProjectMemberReview,
  adminCreateUserEvidence,
  adminCreateCommunityMemberEvidence,
  adminListUserEvidence,
  adminUpdateUserEvidence,
  adminArchiveUserEvidence,
  adminReaiGetProject,
  adminReaiProjectTagPatch,
  adminReaiPatchVdbTags,
  adminEnsureUserRagTag,
  adminRequeueUserRagIndex,
  adminDebugProjectApplicationInput,
  adminTestSingleEvidenceSearch,
  adminTestProjectApplicationEvidence,
  adminTestProjectApplicationReview
};

exports.main = async (event) => {
  try {
    console.log("daimaoBusiness action start", {
      action: event && event.action,
      hasAdminWebToken: Boolean(event && event.adminWebToken),
      driver: process.env.BUSINESS_DB_DRIVER || "mysql",
    });
    if (event.action === "debugEcho") {
      return {
        success: true,
        action: event.action,
        time: new Date().toISOString(),
        driver: process.env.BUSINESS_DB_DRIVER || "mysql",
        cloudbaseEnv: process.env.CLOUDBASE_ENV || "",
        aiConfigured: aiConfigured(),
        vectorProvider: VECTOR_PROVIDER,
      };
    }
    if (event.action === "adminDebugDirectSqlSmoke") {
      const data = await adminDebugDirectSqlSmoke(event);
      return { success: true, ...data };
    }
    if (event.action === "healthCheck") {
      const data = await healthCheck();
      return { success: true, ...data };
    }
    if (event.action === "testAiConnection") {
      const data = await testAiConnection(event);
      return { success: true, ...data };
    }
    if (event.action === "seedDemoData") {
      const data = await seedDemoData(event);
      return { success: true, ...data };
    }
    if (event.action === "publicDashboardStats") {
      requireDashboardAccess(event);
      const data = await publicDashboardStats(event);
      return { success: true, ...data };
    }
    if (event.action === "publicProjectTown") {
      requireDashboardAccess(event);
      const data = await publicProjectTown(event);
      return { success: true, ...data };
    }
    if (event.action === "sendDueReminders") {
      if (!process.env.SCHEDULER_SECRET || event.schedulerSecret !== process.env.SCHEDULER_SECRET) {
        throw codedError("FORBIDDEN", "定时任务密钥不正确");
      }
      const data = await sendDueReminders();
      return { success: true, ...data };
    }
    if (event.action === "processRagIndexJobs" && event.schedulerSecret) {
      const data = await processRagIndexJobs(event, null);
      return { success: true, ...data };
    }
    if (event.action === "processProjectApplicationReviews" && event.schedulerSecret) {
      const data = await processProjectApplicationReviews(event, null);
      return { success: true, ...data };
    }
    const handler = actions[event.action];
    if (!handler) throw codedError("UNKNOWN_ACTION", "未知业务操作");
    const user = await currentUser(event);
    const data = await handler(event, user);
    return { success: true, ...data };
  } catch (err) {
    console.error("daimaoBusiness error", {
      action: event && event.action,
      code: err.code,
      message: err.message,
      details: err.details
    });
    return {
      success: false,
      code: err.code || "INTERNAL_ERROR",
      message: err.code ? err.message : "服务暂时不可用，请稍后再试",
      details: process.env.NODE_ENV === "development" ? err.details : undefined
    };
  }
};
