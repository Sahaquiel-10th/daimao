# ReAI 接入备忘录

## 当前结论

呆猫优先接 ReAI 智能体平台知识库，不再优先自建 Milvus。

ReAI 的知识库可以原样保存和召回 `DAIMAO_META` 文本头，因此可以实现呆猫需要的“业务主库和向量召回分离”：

```text
CloudBase SQL：保存用户、项目、活动、权限、rag_sources、rag_chunks 原文。
ReAI 知识库：保存带 DAIMAO_META 的文本块，负责向量召回。
daimaoBusiness：查询 ReAI，解析 DAIMAO_META，再回查 SQL 做权限和状态校验。
```

## 概念对齐

ReAI 里目前看到的结构：

```text
项目 project：例如 制胜项目，projectId = 4312d7ff22d54f65ab54a
知识库：项目里的知识库区域
文件/分类 tag：例如 呆猫测试，objectId = IM451W4s
知识内容 VDB：一条实际入库文本，objectId = 4870614d65314017ae43f
```

呆猫建议：

```text
一个呆猫业务环境使用一个 ReAI 项目。
测试、生产分不同 ReAI 项目或不同 tag。
使用“项目级总 tag + 用户级 tag”双轨。
项目级总 tag 用于平台池、未来跨用户检索和迁移重建。
用户级 tag 用于某个用户申请项目后的个人证据链深查。
权限边界仍以 DAIMAO_META + CloudBase SQL 为准，tag 只作为检索入口。
```

原因：

1. 用户申请项目时，优先查用户级 tag，噪声更少，也更符合“读这个人的档案”的产品逻辑。
2. 平台后续仍需要跨用户检索，项目级总 tag 不能丢。
3. ReAI 的文件/tag 可以做检索入口，但真正的权限和归属要由 `owner_user_id`、`visibility`、`source_type` 控制。
4. RAG 分数是语义相关性，不是靠谱程度。靠谱判断必须由 SQL 硬事实、证据可信度、AI 和人工确认共同完成。

当前已从页面操作验证：一条 VDB 内容可以同时挂多个 tag，例如：

```json
"tags": ["UOPFXoO3", "p9gt9DOk"]
```

该内容在两个知识库入口里都能看到。代码写入时应始终传完整 tag 列表，例如：

```json
["项目级总 tag", "用户级 tag"]
```

不要只传新增 tag，避免平台后续如果采用覆盖式 PATCH 时误删原 tag。

## 已验证接口

下面的 `{pid}` 是 ReAI 项目 ID，例如：

```text
4312d7ff22d54f65ab54a
```

`{vdb_id}` 是知识库里的文件/tag ID，例如：

```text
IM451W4s
```

### 1. 新增知识内容

```js
const res = await axios.post("https://api.cn.reai.com/vdb/" + PID, {
  content: content,
  tags: [VDB_ID],
}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

测试返回：

```json
{
  "code": 200,
  "message": "创建成功",
  "data": {
    "vdb": {
      "_type": "VDB",
      "objectId": "4870614d65314017ae43f",
      "content": "DAIMAO_META {...}\n正文",
      "tags": ["IM451W4s"],
      "status": "success",
      "projectObj": {
        "objectId": "4312d7ff22d54f65ab54a",
        "name": "制胜项目"
      }
    }
  }
}
```

`data.vdb.objectId` 是后续更新/删除使用的知识内容 ID。

### 2. 查询知识内容

```js
const res = await axios.post("https://api.cn.reai.com/vdb/" + PID + "/vector", {
  content: query,
  query: {
    tags: [VDB_ID],
    _limit: limit
  }
}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data.data?.list;
```

测试返回字段：

```json
{
  "id": "4870614d65314017ae43f",
  "objectId": "4870614d65314017ae43f",
  "score": 0.83916,
  "content": "DAIMAO_META {...}\n正文",
  "tags": ["IM451W4s"],
  "projectId": "4312d7ff22d54f65ab54a",
  "userId": "KCrnenX7Bq3V7QZfxByHA8IV",
  "createdAt": 1782199469946,
  "updatedAt": 1782199469946
}
```

### 3. 更新知识内容

```js
const res = await axios.patch("https://api.cn.reai.com/vdb/" + PID + "/db/" + VID, {
  content: content,
}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

`VID` 使用新增返回的 `data.vdb.objectId`，也等于查询返回的 `id/objectId`。

更新所属 tag：

```js
const res = await axios.patch("https://api.cn.reai.com/vdb/" + PID + "/db/" + VID, {
  tags: ["UOPFXoO3", "p9gt9DOk"],
}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

如果平台要求 `content` 必传，则带上原完整 content：

```js
const res = await axios.patch("https://api.cn.reai.com/vdb/" + PID + "/db/" + VID, {
  content: content,
  tags: ["UOPFXoO3", "p9gt9DOk"],
}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

### 4. 删除知识内容

```js
const res = await axios.delete("https://api.cn.reai.com/vdb/" + PID + "/db/" + OBJECT_ID, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

如果在 ReAI 平台代码块里 `axios.delete` 使用三参数形式，也可写：

```js
const res = await axios.delete("https://api.cn.reai.com/vdb/" + PID + "/db/" + OBJECT_ID, {}, {
  headers: {
    Authorization: "Bearer " + API_KEY
  }
});
return res.data;
```

### 5. 新建/重命名知识库文件/tag

页面操作“新建知识库文件/tag”抓到的请求是：

```text
PATCH https://api.cn.reai.com/app/projects/{pid}
```

本质是更新项目对象里的：

```text
project.options.vdbFolderArr
```

示例新增文件/tag：

```json
{
  "objectId": "w9Z4XD2e",
  "name": "New File",
  "type": "file"
}
```

当前页面抓包确认：

```text
项目 ID：c5088171f0154b8ea9c82
接口：PATCH https://api.cn.reai.com/app/projects/c5088171f0154b8ea9c82
字段：options.vdbFolderArr
```

创建 tag 时，`vdbFolderArr` 会新增一项：

```json
{
  "objectId": "zzWA9xZU",
  "name": "New File",
  "type": "file"
}
```

重命名 tag 时，仍是 PATCH 同一个项目对象，把对应项的 `name` 改掉：

```json
{
  "objectId": "vkQaCRyD",
  "name": "测试-4",
  "type": "file"
}
```

重要风险：

1. 该接口看起来是“整包更新项目对象”，不是单独创建 tag 的轻量 API。
2. 更新时必须保留原有 `options.vdbFolderArr` 的所有项，只改需要新增/重命名的项。
3. 如果只传局部 `vdbFolderArr`，可能覆盖掉其他知识库入口。
4. 需要确认 API key 是否有权限调用 `/app/projects/{pid}`。VDB 内容 API 可用不等于项目配置 API 一定可用。

因此正式代码里，创建用户 tag 要做成谨慎流程：

```text
1. 读取或持有当前完整 vdbFolderArr。
2. 如果用户 tag 已存在，直接复用。
3. 如果不存在，追加 { objectId, name, type: "file" }。
4. PATCH 完整项目对象。
5. 把新 tag 写入 user_rag_tags。
6. 如果创建失败，user_rag_tags.status=failed/pending，业务降级使用项目级总 tag + owner_user_id。
```

目前还没有验证“API key 调 PATCH /app/projects/{pid}”是否可行。页面登录态可以操作，不代表外部 API key 一定可操作。

`daimaoBusiness` 已补了一个谨慎测试入口：`adminReaiProjectTagPatch`。

创建 tag 的 dry-run：

```json
{
  "action": "adminReaiProjectTagPatch",
  "adminWebToken": "后台 token",
  "operation": "create",
  "tagId": "测试 tag id",
  "tagName": "测试 tag 名称",
  "projectPayload": { "这里粘贴 Network 里完整项目 payload": true }
}
```

正式 PATCH：

```json
{
  "action": "adminReaiProjectTagPatch",
  "adminWebToken": "后台 token",
  "operation": "create",
  "tagId": "测试 tag id",
  "tagName": "测试 tag 名称",
  "projectPayload": { "这里粘贴 Network 里完整项目 payload": true },
  "dryRun": false,
  "confirm": "patch-reai-project-tags"
}
```

重命名只需要把 `operation` 改为 `rename`，`tagId` 填已有 tag，`tagName` 填新名字。这个入口不会自己猜项目结构，必须传完整 `projectPayload`，这是为了避免误覆盖其他知识库入口。

`daimaoBusiness` 也补了单条 VDB 内容挂多 tag 的入口：`adminReaiPatchVdbTags`。

dry-run：

```json
{
  "action": "adminReaiPatchVdbTags",
  "adminWebToken": "后台 token",
  "objectId": "0017023f3d664c5e8fd86",
  "tags": ["UOPFXoO3", "p9gt9DOk"]
}
```

正式 PATCH：

```json
{
  "action": "adminReaiPatchVdbTags",
  "adminWebToken": "后台 token",
  "objectId": "0017023f3d664c5e8fd86",
  "tags": ["UOPFXoO3", "p9gt9DOk"],
  "dryRun": false,
  "confirm": "patch-reai-vdb-tags"
}
```

如果 ReAI 返回 `content` 必填，再把原完整 `content` 一起传入。

### 6. ReAI 平台代码块里没有 fetch / axios 的处理

已遇到：

```text
Cannot find module 'axios'
fetch is not defined
```

可用 Node 内置 `https` 写一个小 helper：

```js
const https = require("https");

function requestJson(method, url, body, apiKey) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const req = https.request(url, {
      method,
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          resolve({ statusCode: res.statusCode, raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const pid = "c5088171f0154b8ea9c82";
const objectId = "0017023f3d664c5e8fd86";
const apiKey = API_KEY;

return await requestJson(
  "PATCH",
  "https://api.cn.reai.com/vdb/" + pid + "/db/" + objectId,
  {
    tags: ["UOPFXoO3", "p9gt9DOk"]
  },
  apiKey
);
```

如果返回提示 `content` 必填，则把原完整 `content` 一起传入。

## DAIMAO_META 文本头

ReAI 查询会原样返回 `content`，已验证这种文本头可以被解析：

```text
DAIMAO_META {"chunk_id":50001,"rag_source_id":9501,"source_type":"profile","source_id":4,"owner_user_id":4,"visibility":"match_only","evidence_polarity":"positive","confidence":0.77,"text_hash":"insert_api_1782199469864"}
新增内容 API 测试：马超擅长 AI 小程序、RAG 检索和 CloudBase。
```

呆猫需要写入的 metadata：

```json
{
  "chunk_id": 50001,
  "rag_source_id": 9501,
  "source_type": "profile",
  "source_id": 4,
  "owner_user_id": 4,
  "project_id": null,
  "event_id": null,
  "community_id": null,
  "visibility": "match_only",
  "evidence_polarity": "positive",
  "confidence": 0.77,
  "text_hash": "sha256..."
}
```

召回后，`daimaoBusiness` 必须：

1. 解析 `DAIMAO_META`。
2. 用 `chunk_id` 回查 `rag_chunks`。
3. 用 `rag_source_id` 回查 `rag_sources`。
4. 校验 `owner_user_id`、`visibility`、`status`、`source_type`。
5. 再把证据交给 AI。

## 呆猫环境变量

正式接入 `daimaoBusiness` 时：

```text
VECTOR_PROVIDER=reai_vdb
REAI_VDB_BASE_URL=https://api.cn.reai.com
REAI_VDB_PID=c5088171f0154b8ea9c82
REAI_VDB_ID=UOPFXoO3
REAI_API_KEY=正式 API Key
```

写入 URL 可以由代码拼：

```text
POST {REAI_VDB_BASE_URL}/vdb/{REAI_VDB_PID}
```

如果要显式配置：

```text
REAI_VDB_UPSERT_URL=https://api.cn.reai.com/vdb/c5088171f0154b8ea9c82
```

`REAI_VDB_UPSERT_URL` 是可选项。正常情况下不填，代码会自动使用：

```text
{REAI_VDB_BASE_URL}/vdb/{REAI_VDB_PID}
```

当前正式测试配置：

```text
ReAI 项目链接：https://weix.com/p/c5088171f0154b8ea9c82/files
ReAI 项目 ID：c5088171f0154b8ea9c82
个人资料 tag：vdb?bid=UOPFXoO3
实际 tag ID：UOPFXoO3
```

注意：`vdb?bid=UOPFXoO3` 不是完整 tag ID，环境变量只填 `UOPFXoO3`。

## daimaoBusiness 写入策略

`processRagIndexJobs` 会读取 `rag_index_jobs` 中的 pending 任务，把对应 `rag_chunks` 写入 ReAI。

首次写入：

```text
POST https://api.cn.reai.com/vdb/{REAI_VDB_PID}
body: { content: "DAIMAO_META {...}\n正文", tags: [REAI_VDB_ID] }
```

ReAI 返回：

```text
data.vdb.objectId
```

代码会把这个 `objectId` 回写到：

```text
rag_chunks.vector_doc_id
```

后续同一个 chunk 再索引时：

```text
PATCH https://api.cn.reai.com/vdb/{REAI_VDB_PID}/db/{rag_chunks.vector_doc_id}
body: { content: "DAIMAO_META {...}\n新正文", tags: [REAI_VDB_ID, user_reai_tag_id] }
```

也就是说，SQL 仍然是原文和状态主库，ReAI 只负责召回。

当 `user_rag_tags` 里已有 `user_id -> user_tag_id` 绑定时，索引任务会自动把用户 tag 加到同一条 VDB 记录的 `tags` 数组里：

```text
项目级总 tag：REAI_VDB_ID / REAI_DEFAULT_TAG_IDS
用户级 tag：user_rag_tags.user_tag_id
```

项目申请审核检索时，优先搜申请人的用户级 tag；用户级 tag 没结果时，降级搜项目级总 tag；最后再降级查 SQL 的 `rag_chunks`。

注意：给老用户新增 `user_rag_tags` 绑定后，ReAI 里已经存在的历史内容不会自动多出个人 tag。需要执行：

```json
{
  "action": "adminRequeueUserRagIndex",
  "adminWebToken": "后台 token",
  "userId": 4
}
```

这会把该用户名下的 `rag_sources/rag_chunks` 重新置为待索引，并追加 `reindex` job。随后执行：

```json
{
  "action": "processRagIndexJobs",
  "adminWebToken": "后台 token",
  "limit": 20
}
```

索引完成后，这些历史内容会在 ReAI 中同时挂项目级总 tag 和用户级 tag。

## 测试记录

### 查询测试

查询：

```text
测试内容
查找这个人擅长什么
查找这个人不擅长什么
查找和项目匹配的经历
```

返回结构包含：

```text
id / objectId / score / content / tags / projectId / userId / createdAt / updatedAt
```

### DAIMAO_META 保留测试

写入后查询返回：

```json
{
  "hasMeta": true,
  "metadata": {
    "chunk_id": 10001,
    "rag_source_id": 9001,
    "source_type": "profile",
    "owner_user_id": 4,
    "visibility": "match_only",
    "evidence_polarity": "positive",
    "confidence": 0.72
  }
}
```

结论：ReAI 不会清洗 `DAIMAO_META`，可作为 metadata fallback 使用。

运行时补充：

- ReAI 后台保存的内容仍然带 `DAIMAO_META`，用于在召回结果中恢复 `chunk_id/source_id/owner_user_id/visibility/source_trust` 等索引信息。
- `daimaoBusiness.reaiVectorSearch()` 会调用 `parseReaiKnowledgeContent()`，返回给项目审核 AI 的 `content` 只保留正文，不包含 `DAIMAO_META`。
- 因此现阶段 `DAIMAO_META` 会参与 ReAI 向量化，但不会直接消耗项目审核 AI 的上下文 token。
- 如果未来 ReAI 支持独立 metadata 字段，或我们改成按 `rag_chunks.vector_doc_id` 回查 SQL hydrate metadata，就可以把 ReAI 存储内容改成纯正文。

## 后台社区证据入口

管理后台已接入社区成员密封证据上传：

```text
adminCreateCommunityMemberEvidence
```

输入：

```json
{
  "userId": 4,
  "communityId": 1,
  "evidenceType": "admin_evidence",
  "title": "社区证据：马超",
  "content": "管理员备注或访谈正文",
  "confidence": 0.9,
  "file": {
    "filename": "review.docx",
    "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "dataUrl": "data:...;base64,..."
  }
}
```

处理链路：

1. 校验 `userId` 是 `communityId` 的 active 认证成员。
2. 支持直接文本，也支持 `txt/md/docx/pdf` 文件解析。
3. 写入 `evidence_records`，并带上 `community_id`。
4. 写入 `rag_sources/rag_chunks/rag_index_jobs`。
5. 后续执行 `processRagIndexJobs` 后，同一条 ReAI 内容会挂项目级总 tag 和用户级 tag。

### 新增内容测试

新增接口：

```text
POST /vdb/{pid}
```

返回：

```text
data.vdb.objectId = 4870614d65314017ae43f
```

随后搜索 `insert_api_1782199469864` 能召回新增内容。

## 后续接入步骤

1. 用户新建正式 ReAI 项目和正式 tag。
2. 用户创建正式 API Key。
3. 配置 `daimaoBusiness` 环境变量。
4. 代码将 `processRagIndexJobs` 的 ReAI 写入逻辑改为 `POST /vdb/{pid}`。
5. 写入成功后，把 ReAI 返回的 `objectId` 保存到 `rag_chunks.vector_doc_id`。
6. 后续资料更新时，优先用 `PATCH /vdb/{pid}/db/{objectId}` 更新；没有 `objectId` 时重新 `POST`。
7. 资料删除/归档时，调用 `DELETE /vdb/{pid}/db/{objectId}`。
