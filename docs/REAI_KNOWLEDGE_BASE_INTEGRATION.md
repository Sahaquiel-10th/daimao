# ReAI 知识库接入方案

## 结论

如果 ReAI 智能体平台已经提供知识库写入和查询 API，呆猫优先接 ReAI 知识库，不再直接维护 Milvus。

呆猫仍然保留自己的可信资料层：

```text
CloudBase SQL：业务事实、用户、项目、活动、权限、原文。
rag_sources / rag_chunks / rag_index_jobs：要进入知识库的文本切片和索引队列。
ReAI 知识库：向量索引和召回服务。
```

这样既不重复造轮子，也不把业务主数据交给知识库。

## 是否还能做到“索引和内容分开”

取决于 ReAI 知识库写入接口是否支持保存 metadata。

### 理想情况：支持 metadata

写入知识库时，每条 chunk 带：

```json
{
  "content": "切片正文",
  "metadata": {
    "chunk_id": 123,
    "rag_source_id": 45,
    "source_type": "profile",
    "source_id": 8,
    "owner_user_id": 4,
    "project_id": null,
    "event_id": null,
    "community_id": null,
    "visibility": "match_only",
    "evidence_polarity": "positive",
    "confidence": 0.72,
    "text_hash": "sha256..."
  }
}
```

查询返回时也带 metadata。呆猫拿 `chunk_id` 回查 CloudBase SQL，确认权限和原文。

这是最干净的方案。

### 可接受情况：不支持 metadata，但原文可控

如果 ReAI 知识库只存文本，呆猫写入时把 metadata 放进文本头：

```text
DAIMAO_META {"chunk_id":123,"rag_source_id":45,"source_type":"profile","owner_user_id":4,"visibility":"match_only","evidence_polarity":"positive","confidence":0.72}
用户名片：马超
简介：……
问答：……
```

`daimaoBusiness` 已经支持解析这种 `DAIMAO_META` 头。  
缺点是 metadata 会进入向量化文本，可能轻微影响召回。可以通过把头压得很短来降低影响。

### 风险情况：不支持 metadata，也不能保留文本头

那就无法严格做到“索引和内容分开”。只能把 ReAI 知识库当粗召回层：

1. ReAI 返回片段文本。
2. 呆猫用文本 hash / 摘要相似度回查 `rag_chunks`。
3. 找到 SQL 原文后再做权限校验。

这个方案能用，但稳定性低，尤其是片段被平台改写、清洗、摘要化后，回查可能失败。

## 已验证 API

当前已按你提供的 ReAI 查询接口接入：

```js
POST https://api.cn.reai.com/vdb/{REAI_VDB_PID}/vector
Authorization: Bearer {REAI_API_KEY}
```

请求体：

```json
{
  "content": "要查询的内容",
  "query": {
    "tags": ["知识库 ID"],
    "_limit": 4
  }
}
```

`daimaoBusiness` 环境变量：

```text
VECTOR_PROVIDER=reai_vdb
REAI_VDB_BASE_URL=https://api.cn.reai.com
REAI_VDB_PID=路径里的 vdb/{pid}
REAI_VDB_ID=默认知识库 tag ID
# 可选：多个默认 tag，用英文逗号或空格分隔；不填时使用 REAI_VDB_ID
REAI_DEFAULT_TAG_IDS=global_tag_id user_tag_id
REAI_API_KEY=ReAI API Key
```

新增知识内容：

```js
POST https://api.cn.reai.com/vdb/{REAI_VDB_PID}
Authorization: Bearer {REAI_API_KEY}
```

请求体：

```json
{
  "content": "DAIMAO_META {...}\n切片正文",
  "tags": ["知识库 ID"]
}
```

返回的 `data.vdb.objectId` 会写回 `rag_chunks.vector_doc_id`。

更新知识内容：

```js
PATCH https://api.cn.reai.com/vdb/{REAI_VDB_PID}/db/{vector_doc_id}
Authorization: Bearer {REAI_API_KEY}
```

删除知识内容：

```js
DELETE https://api.cn.reai.com/vdb/{REAI_VDB_PID}/db/{vector_doc_id}
Authorization: Bearer {REAI_API_KEY}
```

正式测试配置：

```text
REAI_VDB_PID=c5088171f0154b8ea9c82
REAI_VDB_ID=UOPFXoO3
```

`UOPFXoO3` 来自页面参数 `vdb?bid=UOPFXoO3`，环境变量只填 `UOPFXoO3`。

当前代码支持多 tag：

```text
写入：默认写入 REAI_DEFAULT_TAG_IDS 或 REAI_VDB_ID；如果资料 metadata.reai_tags 里还有 tag，会一起写入。
查询：默认查 REAI_DEFAULT_TAG_IDS 或 REAI_VDB_ID；如果调用 vectorSearch 时传 reaiTags，则查指定 tag。
```

推荐阶段：

```text
第一阶段：项目级总 tag + 用户级 tag 双轨。
第二阶段：同一条 chunk 同时写 global tag + user tag，用 user tag 做个人深查。
第三阶段：平台级推荐、跨用户检索、迁移重建仍使用 global tag。
第四阶段：再扩展 project / event / community / source_type tag。
```

已从 ReAI 后台页面操作验证：一条 VDB 内容可以同时挂多个 tag。页面 PATCH 后返回：

```json
"tags": ["UOPFXoO3", "p9gt9DOk"]
```

代码写入时应传完整 tag 列表，避免覆盖：

```json
{
  "content": "DAIMAO_META {...}\n正文",
  "tags": ["项目级总 tag", "用户级 tag"]
}
```

用户级 tag 的创建/重命名目前页面抓包显示走：

```text
PATCH https://api.cn.reai.com/app/projects/{pid}
```

本质是整包更新项目对象的 `options.vdbFolderArr`。正式自动化前必须确认 API key 是否有权限调用该项目配置接口。

如果需要覆盖写入地址，可以额外配置：

```text
REAI_VDB_UPSERT_URL=https://api.cn.reai.com/vdb/c5088171f0154b8ea9c82
```

通常不需要配置，代码会自动拼接。

## 验证

先只测查询：

```json
{
  "action": "healthCheck"
}
```

应看到：

```json
"vector": {
  "provider": "reai_vdb",
  "searchConfigured": true,
  "upsertConfigured": true
}
```

然后执行索引任务：

```json
{
  "action": "processRagIndexJobs",
  "limit": 5
}
```

成功后：

1. `rag_index_jobs.status` 变为 `completed`。
2. `rag_sources.status` 变为 `indexed`。
3. `rag_chunks.status` 变为 `indexed`。
4. `rag_chunks.vector_doc_id` 从 `rag_x_y` 占位值变成 ReAI 返回的 `objectId`。
