# 呆猫向量适配器部署说明

## 目标

`daimaoBusiness` 不直接连接 Milvus。它只调用两个 HTTPS 接口：

```text
POST /upsert
POST /search
```

`services/daimaoVectorAdapter` 负责：

1. 调 Embedding 服务，把文本转成向量。
2. 在 Milvus 中创建/维护 `daimao_rag_chunks` collection。
3. 写入 chunk 向量和 metadata。
4. 按 query + filters 检索证据。

## 部署位置

推荐部署在阿里云函数计算或同 VPC 的轻量服务里。

原因：当前 Milvus 实例只有内网地址：

```text
c-250248713de8f06d-internal.milvus.aliyuncs.com:19530
```

CloudBase 云函数在腾讯云，不能直接访问这个阿里云内网地址。

## 阿里云侧环境变量

部署 `services/daimaoVectorAdapter` 时配置：

```text
PORT=9000
ADAPTER_API_KEY=自己生成一个长随机密钥

MILVUS_ADDRESS=c-250248713de8f06d-internal.milvus.aliyuncs.com:19530
MILVUS_USERNAME=root
MILVUS_PASSWORD=创建 Milvus 时设置的登录密码
MILVUS_SSL=false

VECTOR_COLLECTION=daimao_rag_chunks
VECTOR_TOP_K=4

EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings
EMBEDDING_API_KEY=阿里百炼/DashScope API Key
```

如果 Milvus 内置 Embedding 后续提供无需 DashScope Key 的直连方式，再替换 `vector.js` 中的 `embedTexts`。

## CloudBase daimaoBusiness 环境变量

适配器部署并拿到公网 HTTPS 地址后，在 `daimaoBusiness` 配置：

```text
VECTOR_PROVIDER=http_adapter
VECTOR_COLLECTION=daimao_rag_chunks
VECTOR_NAMESPACE=prod

VECTOR_UPSERT_URL=https://你的适配器域名/upsert
VECTOR_SEARCH_URL=https://你的适配器域名/search
VECTOR_UPSERT_API_KEY=与 ADAPTER_API_KEY 相同
VECTOR_SEARCH_API_KEY=与 ADAPTER_API_KEY 相同
VECTOR_TOP_K=4
```

## 验证顺序

1. 访问适配器健康检查：

```text
GET https://你的适配器域名/health
```

返回：

```json
{"success":true,"ok":true}
```

2. 在 CloudBase 测 `daimaoBusiness`：

```json
{"action":"healthCheck"}
```

确认：

```json
"vector": {
  "provider": "http_adapter",
  "searchConfigured": true,
  "upsertConfigured": true
}
```

3. 手动触发索引：

```json
{
  "action": "processRagIndexJobs",
  "limit": 3
}
```

确认 `rag_index_jobs.status` 变成 `completed`，`rag_chunks.status` 变成 `indexed`。

4. 后续由云定时每 5-10 分钟调用：

```json
{
  "action": "processRagIndexJobs",
  "schedulerSecret": "与 SCHEDULER_SECRET 相同",
  "limit": 10
}
```

## 成本提醒

Milvus 按量付费是实例运行期间按小时扣费，不是只在搜索时扣费。

当前 4 CU 如果按华东2上海 `0.33 元/CU/小时` 估算，约：

```text
4 * 0.33 = 1.32 元/小时
约 31.68 元/天
约 950 元/月
```

不用时需要释放或确认停机后计算资源不再计费。
