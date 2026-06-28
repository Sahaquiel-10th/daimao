const http = require("http");
const { upsertDocuments, searchDocuments, ensureCollection } = require("./vector");

const PORT = Number(process.env.PORT || 9000);
const ADAPTER_API_KEY = process.env.ADAPTER_API_KEY || "";

function send(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        const error = new Error("请求体不是合法 JSON");
        error.code = "BAD_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function assertAuthorized(request) {
  if (!ADAPTER_API_KEY) return;
  const authorization = request.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (token !== ADAPTER_API_KEY) {
    const error = new Error("未授权的向量适配器请求");
    error.code = "UNAUTHORIZED";
    throw error;
  }
}

async function route(request, response) {
  try {
    if (request.method === "GET" && request.url === "/health") {
      await ensureCollection();
      send(response, 200, { success: true, ok: true });
      return;
    }
    if (request.method !== "POST") {
      send(response, 405, { success: false, code: "METHOD_NOT_ALLOWED", message: "仅支持 POST" });
      return;
    }
    assertAuthorized(request);
    const payload = await readBody(request);
    if (request.url === "/upsert") {
      const data = await upsertDocuments(payload);
      send(response, 200, { success: true, ...data });
      return;
    }
    if (request.url === "/search") {
      const data = await searchDocuments(payload);
      send(response, 200, { success: true, ...data });
      return;
    }
    send(response, 404, { success: false, code: "NOT_FOUND", message: "未知接口" });
  } catch (err) {
    console.error("daimaoVectorAdapter error", {
      url: request.url,
      code: err.code,
      message: err.message,
    });
    send(response, err.code === "UNAUTHORIZED" ? 401 : 500, {
      success: false,
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "向量服务暂时不可用",
    });
  }
}

if (require.main === module) {
  http.createServer(route).listen(PORT, () => {
    console.log(`daimaoVectorAdapter listening on ${PORT}`);
  });
}

module.exports = { route };
