const http = require("http");
const cloudbase = require("@cloudbase/node-sdk");

const env = process.env.CLOUDBASE_ENV || process.env.ADMIN_API_CLOUDBASE_ENV || "cloud1-8gocbg40af3862ce";
const functionName = process.env.CLOUDBASE_FUNCTION || process.env.ADMIN_API_CLOUDBASE_FUNCTION || "daimaoBusiness";
const port = Number(process.env.ADMIN_API_PORT || 8090);
const host = process.env.ADMIN_API_HOST || "127.0.0.1";
const secretId = process.env.TENCENTCLOUD_SECRETID || process.env.CLOUDBASE_SECRET_ID || process.env.CLOUDBASE_SECRETID;
const secretKey = process.env.TENCENTCLOUD_SECRETKEY || process.env.CLOUDBASE_SECRET_KEY || process.env.CLOUDBASE_SECRETKEY;

let app;

function getApp() {
  if (!app) {
    if (!secretId || !secretKey) {
      throw new Error("缺少 TENCENTCLOUD_SECRETID/TENCENTCLOUD_SECRETKEY，无法从服务器调用 CloudBase");
    }
    app = cloudbase.init({ env, secretId, secretKey });
  }
  return app;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function publicError(err) {
  return {
    success: false,
    code: err.code || "ADMIN_API_ERROR",
    message: err.message || "后台代理服务暂时不可用",
    details: process.env.NODE_ENV === "development" ? err.details : undefined,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      return sendJson(response, 200, { success: true, env, functionName });
    }
    if (request.method !== "POST" || request.url !== "/api/admin") {
      return sendJson(response, 404, { success: false, message: "Not found" });
    }

    const data = await readJson(request);
    if (!data || typeof data.action !== "string") {
      return sendJson(response, 400, { success: false, message: "缺少 action" });
    }

    const result = await getApp().callFunction({
      name: functionName,
      data,
    });
    return sendJson(response, 200, result.result || result);
  } catch (err) {
    console.error("admin proxy error", {
      code: err.code,
      message: err.message,
      stack: err.stack,
    });
    return sendJson(response, 500, publicError(err));
  }
});

server.listen(port, host, () => {
  console.log(`daimao admin api listening on http://${host}:${port}/api/admin`);
});
