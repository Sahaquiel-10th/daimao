const https = require("https");
const {
  MilvusClient,
  DataType,
  MetricType,
  IndexType,
} = require("@zilliz/milvus2-sdk-node");

const COLLECTION = process.env.VECTOR_COLLECTION || "daimao_rag_chunks";
const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS || "";
const MILVUS_USERNAME = process.env.MILVUS_USERNAME || "root";
const MILVUS_PASSWORD = process.env.MILVUS_PASSWORD || "";
const MILVUS_SSL = process.env.MILVUS_SSL === "true";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-v4";
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.DASHSCOPE_API_KEY || "";
const DEFAULT_TOP_K = Math.min(Math.max(Number(process.env.VECTOR_TOP_K || 4), 1), 20);

let client;
let collectionReady = false;
let embeddingDim = Number(process.env.EMBEDDING_DIM || 0);

function requireEnv() {
  const missing = [];
  if (!MILVUS_ADDRESS) missing.push("MILVUS_ADDRESS");
  if (!MILVUS_PASSWORD) missing.push("MILVUS_PASSWORD");
  if (!EMBEDDING_API_KEY) missing.push("EMBEDDING_API_KEY 或 DASHSCOPE_API_KEY");
  if (missing.length) {
    const error = new Error(`缺少环境变量: ${missing.join(", ")}`);
    error.code = "CONFIG_MISSING";
    throw error;
  }
}

function getClient() {
  requireEnv();
  if (!client) {
    client = new MilvusClient({
      address: MILVUS_ADDRESS,
      username: MILVUS_USERNAME,
      password: MILVUS_PASSWORD,
      ssl: MILVUS_SSL,
    });
  }
  return client;
}

function httpJson(url, options, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method || "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(options.headers || {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`Embedding 接口返回 ${response.statusCode}: ${raw.slice(0, 500)}`);
            error.code = "EMBEDDING_FAILED";
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            const error = new Error("Embedding 接口没有返回合法 JSON");
            error.code = "EMBEDDING_RESPONSE_INVALID";
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.setTimeout(Number(process.env.EMBEDDING_TIMEOUT_MS || 30000), () => {
      const error = new Error("Embedding 接口超时");
      error.code = "EMBEDDING_TIMEOUT";
      request.destroy(error);
    });
    request.write(payload);
    request.end();
  });
}

async function embedTexts(texts) {
  const input = texts.map((item) => String(item || "").trim()).filter(Boolean);
  if (!input.length) return [];
  const response = await httpJson(
    EMBEDDING_BASE_URL,
    {
      headers: {
        Authorization: `Bearer ${EMBEDDING_API_KEY}`,
      },
    },
    {
      model: EMBEDDING_MODEL,
      input,
      encoding_format: "float",
    }
  );
  const vectors = (response.data || [])
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    .map((item) => item.embedding);
  if (!vectors[0] || !Array.isArray(vectors[0])) {
    const error = new Error("Embedding 接口没有返回向量");
    error.code = "EMBEDDING_EMPTY";
    throw error;
  }
  embeddingDim = embeddingDim || vectors[0].length;
  return vectors;
}

async function ensureCollection() {
  if (collectionReady) return;
  const milvus = getClient();
  if (!embeddingDim) {
    const vectors = await embedTexts(["呆猫向量维度探测"]);
    embeddingDim = vectors[0].length;
  }
  const exists = await milvus.hasCollection({ collection_name: COLLECTION });
  if (!exists.value) {
    await milvus.createCollection({
      collection_name: COLLECTION,
      fields: [
        { name: "id", data_type: DataType.VarChar, is_primary_key: true, max_length: 160 },
        { name: "embedding", data_type: DataType.FloatVector, dim: embeddingDim },
        { name: "content", data_type: DataType.VarChar, max_length: 12000 },
        { name: "short_text", data_type: DataType.VarChar, max_length: 500 },
        { name: "text_hash", data_type: DataType.VarChar, max_length: 80 },
        { name: "source_type", data_type: DataType.VarChar, max_length: 60 },
        { name: "evidence_polarity", data_type: DataType.VarChar, max_length: 30 },
        { name: "visibility", data_type: DataType.VarChar, max_length: 40 },
        { name: "title", data_type: DataType.VarChar, max_length: 220 },
        { name: "metadata_json", data_type: DataType.VarChar, max_length: 4000 },
        { name: "chunk_id", data_type: DataType.Int64 },
        { name: "rag_source_id", data_type: DataType.Int64 },
        { name: "source_id", data_type: DataType.Int64 },
        { name: "owner_user_id", data_type: DataType.Int64 },
        { name: "project_id", data_type: DataType.Int64 },
        { name: "event_id", data_type: DataType.Int64 },
        { name: "community_id", data_type: DataType.Int64 },
        { name: "confidence", data_type: DataType.Double },
        { name: "version", data_type: DataType.Int64 },
      ],
    });
    await milvus.createIndex({
      collection_name: COLLECTION,
      field_name: "embedding",
      index_name: "idx_embedding",
      index_type: IndexType.HNSW,
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 128 },
    });
  }
  await milvus.loadCollectionSync({ collection_name: COLLECTION });
  collectionReady = true;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncate(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function escapeString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function listExpr(field, values) {
  if (!Array.isArray(values) || !values.length) return "";
  const normalized = values.map((item) => `"${escapeString(item)}"`).join(",");
  return `${field} in [${normalized}]`;
}

function buildFilter(filters = {}) {
  const parts = [];
  if (filters.owner_user_id) parts.push(`owner_user_id == ${numberOrZero(filters.owner_user_id)}`);
  if (filters.project_id) parts.push(`project_id == ${numberOrZero(filters.project_id)}`);
  if (filters.event_id) parts.push(`event_id == ${numberOrZero(filters.event_id)}`);
  if (filters.community_id) parts.push(`community_id == ${numberOrZero(filters.community_id)}`);
  const sourceTypes = Array.isArray(filters.source_type)
    ? filters.source_type
    : filters.source_type
      ? [filters.source_type]
      : [];
  const polarities = Array.isArray(filters.evidence_polarity)
    ? filters.evidence_polarity
    : filters.evidence_polarity
      ? [filters.evidence_polarity]
      : [];
  const visibility = Array.isArray(filters.visibility)
    ? filters.visibility
    : filters.visibility
      ? [filters.visibility]
      : ["match_only", "project_visible", "public"];
  const sourceExpr = listExpr("source_type", sourceTypes);
  const polarityExpr = listExpr("evidence_polarity", polarities);
  const visibilityExpr = listExpr("visibility", visibility);
  if (sourceExpr) parts.push(sourceExpr);
  if (polarityExpr) parts.push(polarityExpr);
  if (visibilityExpr) parts.push(visibilityExpr);
  return parts.join(" and ");
}

function normalizeDocument(document, vector) {
  const metadata = document.metadata || {};
  return {
    id: String(document.id || metadata.vector_doc_id || `chunk_${metadata.chunk_id}`),
    embedding: vector,
    content: truncate(document.content, 12000),
    short_text: truncate(document.short_text || metadata.short_text || document.content, 500),
    text_hash: String(document.text_hash || metadata.text_hash || ""),
    source_type: String(metadata.source_type || ""),
    evidence_polarity: String(metadata.evidence_polarity || "neutral"),
    visibility: String(metadata.visibility || "match_only"),
    title: truncate(metadata.title || "", 220),
    metadata_json: truncate(JSON.stringify(metadata.metadata || {}), 4000),
    chunk_id: numberOrZero(metadata.chunk_id),
    rag_source_id: numberOrZero(metadata.rag_source_id),
    source_id: numberOrZero(metadata.source_id),
    owner_user_id: numberOrZero(metadata.owner_user_id),
    project_id: numberOrZero(metadata.project_id),
    event_id: numberOrZero(metadata.event_id),
    community_id: numberOrZero(metadata.community_id),
    confidence: Number(metadata.confidence || 0.7),
    version: numberOrZero(metadata.version || 1),
  };
}

async function upsertDocuments(payload) {
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  if (!documents.length) return { upserted: 0 };
  await ensureCollection();
  const vectors = await embedTexts(documents.map((document) => document.content));
  const rows = documents.map((document, index) => normalizeDocument(document, vectors[index]));
  await getClient().upsert({
    collection_name: COLLECTION,
    data: rows,
  });
  return { upserted: rows.length, collection: COLLECTION, embeddingModel: EMBEDDING_MODEL, embeddingDim };
}

async function searchDocuments(payload) {
  const query = String(payload.query || "").trim();
  if (!query) return { matches: [] };
  await ensureCollection();
  const [vector] = await embedTexts([query]);
  const result = await getClient().search({
    collection_name: COLLECTION,
    vector,
    anns_field: "embedding",
    limit: Math.min(Math.max(Number(payload.topK || DEFAULT_TOP_K), 1), 20),
    metric_type: MetricType.COSINE,
    filter: buildFilter(payload.filters || {}),
    output_fields: [
      "id",
      "content",
      "short_text",
      "text_hash",
      "source_type",
      "evidence_polarity",
      "visibility",
      "title",
      "metadata_json",
      "chunk_id",
      "rag_source_id",
      "source_id",
      "owner_user_id",
      "project_id",
      "event_id",
      "community_id",
      "confidence",
      "version",
    ],
  });
  const rows = result.results || result.data || [];
  return {
    matches: rows.map((row) => {
      const metadata = {
        rag_source_id: row.rag_source_id,
        chunk_id: row.chunk_id,
        source_type: row.source_type,
        source_id: row.source_id,
        owner_user_id: row.owner_user_id,
        project_id: row.project_id || null,
        event_id: row.event_id || null,
        community_id: row.community_id || null,
        title: row.title,
        visibility: row.visibility,
        evidence_polarity: row.evidence_polarity,
        confidence: row.confidence,
        version: row.version,
        text_hash: row.text_hash,
      };
      return {
        id: row.id,
        score: row.score || row.distance,
        content: row.short_text || row.content,
        metadata,
      };
    }),
  };
}

module.exports = {
  upsertDocuments,
  searchDocuments,
  ensureCollection,
};
