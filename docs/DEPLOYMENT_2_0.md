# 呆猫 2.0 部署清单

## 1. CloudBase SQL

1. 使用 CloudBase 标准版内置 SQL 型数据库作为业务主库。
2. 新库执行 `database/schema.sql` 和必要 migrations。
3. 将首个运营账号的 `users.is_admin` 更新为 `1`。
4. 小程序端不直连数据库，统一通过云函数读写。

`daimaoBusiness` 环境变量：

```text
BUSINESS_DB_DRIVER=cloudbase_rdb
CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
MYSQL_DATABASE=cloud1-8gocbg40af3862ce
```

## 2. AI

后端使用 OpenAI-compatible Chat Completions 接口。鱼鱼连线 YYLX 的 OpenAI 兼容地址是：

```text
AI_BASE_URL=https://app.yylx.io/v1
```

不要写成 `https://app.yylx.io/v1/chat/completions`，代码会自动拼接 `/chat/completions`。

`daimaoBusiness` 支持两组环境变量命名，二选一即可：

```text
AI_BASE_URL=https://app.yylx.io/v1
AI_API_KEY=sk-...
AI_MODEL=控制台模型列表里的模型名
```

或：

```text
YYLX_BASE_URL=https://app.yylx.io/v1
YYLX_API_KEY=sk-...
YYLX_MODEL=控制台模型列表里的模型名
```

可选配置：

```text
AI_TEMPERATURE=0.1
SECRETARY_RETRIEVAL_PROMPT=
SECRETARY_PROJECT_REVIEW_PROMPT=
RAG_RETRIEVAL_QUERY_COUNT=6
RAG_RETRIEVAL_TOP_K=3
VECTOR_SEARCH_URL
VECTOR_SEARCH_API_KEY
VECTOR_UPSERT_URL
VECTOR_UPSERT_API_KEY
VECTOR_PROVIDER=http_adapter
VECTOR_COLLECTION=daimao_rag_chunks
VECTOR_NAMESPACE=prod
VECTOR_TOP_K=4
RAG_MAX_CHUNK_CHARS=700
RAG_CHUNK_OVERLAP_CHARS=80
```

配置完成后，先用云端测试检查 AI 连通：

```json
{
  "action": "healthCheck"
}
```

确认：

```json
"ai": {
  "configured": true,
  "modelConfigured": true,
  "apiKeyConfigured": true
}
```

再执行一次真实 AI 请求测试：

```json
{
  "action": "testAiConnection",
  "confirm": "test-ai-connection"
}
```

API Key 只配置在 `daimaoBusiness` 云函数环境变量。项目记录输出会经过
`cloudfunctions/daimaoBusiness/ai-schema.js` 校验，校验失败只记录失败任务，不创建正式内容。
`SECRETARY_RETRIEVAL_PROMPT` 用于生成项目申请的 RAG 检索问题；`SECRETARY_PROJECT_REVIEW_PROMPT` 用于项目申请初审。
这两个提示词默认在代码中有保守模板，环境变量只用于覆盖，不是必须配置。

`VECTOR_SEARCH_URL`/`VECTOR_SEARCH_API_KEY`
用于把申请内容发给外部向量库检索用户资料和项目资料；`VECTOR_UPSERT_URL`/`VECTOR_UPSERT_API_KEY`
用于把 `rag_chunks` 写入向量库。未配置时，小秘书会降级为人工模式，RAG 任务会留在 CloudBase SQL 中等待处理。
检索 query 的拼接、证据分桶和上下文预算见 `docs/EVIDENCE_RETRIEVAL_LAYER.md`。

腾讯云向量数据库新购已停售。当前优先接 ReAI 智能体平台知识库；阿里云 Milvus 只作为备用路线。`daimaoBusiness`
现在支持：

```text
VECTOR_PROVIDER=reai_vdb      # 优先：接 ReAI 知识库
VECTOR_PROVIDER=http_adapter  # 备用：接自建 HTTP 向量适配器
```

ReAI 知识库接入见 `docs/REAI_KNOWLEDGE_BASE_INTEGRATION.md`。
RAG 匹配、个人深查和 Agent 上下文边界见 `docs/RAG_MATCHING_AND_AGENT_CONTEXT.md`。
阿里 Milvus 适配器部署步骤见 `docs/VECTOR_ADAPTER_DEPLOYMENT.md`。

通用 HTTP adapter 协议如下：

搜索请求：

```json
{
  "provider": "http_adapter",
  "collection": "daimao_rag_chunks",
  "namespace": "prod",
  "query": "查找申请人与项目标签相关的过往经历...",
  "topK": 4,
  "filters": {
    "owner_user_id": 101,
    "source_type": ["profile", "project_record"],
    "evidence_polarity": ["positive", "neutral"]
  },
  "plan": "tag_match"
}
```

搜索返回：

```json
{
  "matches": [
    {
      "id": "rag_12_0",
      "score": 0.91,
      "content": "2026-05 项目记录：完成小程序支付流程联调。",
      "metadata": {
        "source_type": "project_record",
        "source_id": 88,
        "owner_user_id": 101,
        "evidence_polarity": "positive",
        "confidence": 0.86
      }
    }
  ]
}
```

写入请求：

```json
{
  "provider": "http_adapter",
  "collection": "daimao_rag_chunks",
  "namespace": "prod",
  "sourceId": 12,
  "jobType": "upsert",
  "documents": [
    {
      "id": "rag_12_0",
      "content": "切片正文",
      "short_text": "切片摘要",
      "text_hash": "sha256...",
      "metadata": {
        "rag_source_id": 12,
        "chunk_id": 34,
        "source_type": "project_record",
        "source_id": 88,
        "owner_user_id": 101,
        "visibility": "project_visible",
        "evidence_polarity": "positive"
      }
    }
  ]
}
```

资料写入流程：

1. 项目发布、项目申请、项目记录创建时，云函数写入 `rag_sources`、`rag_chunks`、`rag_index_jobs`。
2. 管理员手动调用或云定时触发 `processRagIndexJobs`。
3. `processRagIndexJobs` 将 pending chunk 发送到 `VECTOR_UPSERT_URL`。
4. 写入成功后，CloudBase SQL 中的 source/chunk/job 状态更新为 `indexed`。
5. 项目申请审核时，云函数先调用 AI 生成 5-6 个检索问题。
6. 每个检索问题最多召回 1-3 个 RAG 证据块。
7. 召回结果会按 `owner_user_id/source_type/visibility/source_trust/polarity` 做本地过滤。
8. 过滤后的证据和 SQL 硬事实一起交给 AI 初审。

开通时需要你提供给代码侧的值：

```text
VECTOR_SEARCH_URL
VECTOR_SEARCH_API_KEY
VECTOR_UPSERT_URL
VECTOR_UPSERT_API_KEY
VECTOR_PROVIDER
VECTOR_COLLECTION
VECTOR_NAMESPACE

AI_BASE_URL
AI_API_KEY
AI_MODEL
SCHEDULER_SECRET
```

资源建议：

```text
业务主库：CloudBase SQL。
向量库：阿里云 Milvus，先选最小按量/试用规格验证。
网络：小程序只访问云函数；数据库和向量库密钥只放云函数环境变量。
云定时：每 5-10 分钟调用 daimaoBusiness.processRagIndexJobs。向量库未配置时该任务会跳过，不会消耗 pending 队列。
```

## 3. 文件

小程序通过共享云环境上传文件，后端只保存 `storage_key`/云文件 ID。

- 支持：`txt`、`md`、`docx`、`pdf`
- 单文件上限：10MB
- 上线前为 `projects/*` 配置私有读权限
- 文件下载和临时访问需要继续由后端做成员权限校验

## 4. 微信订阅消息

配置项目日程提醒模板和字段：

```text
WECHAT_PROJECT_REMINDER_TEMPLATE_ID
WECHAT_REMINDER_TITLE_KEY=thing1
WECHAT_REMINDER_TIME_KEY=time2
WECHAT_REMINDER_NOTE_KEY=thing3
WECHAT_MINIPROGRAM_STATE=formal
REMINDER_LEAD_MINUTES=30
SCHEDULER_SECRET
```

同时将模板 ID 填到 `miniprogram/config/business.js` 的
`projectReminderTemplateId`。模板字段名必须与微信公众平台模板一致。

用云定时触发器每 5 分钟调用：

```json
{
  "action": "sendDueReminders",
  "schedulerSecret": "与 SCHEDULER_SECRET 相同"
}
```

发送逻辑会先抢占任务、扣减一次授权额度，并写入 `notification_logs`。

## 5. 云函数和前端开关

1. 在微信开发者工具中安装并上传 `cloudfunctions/daimaoBusiness` 依赖。
2. 部署 `daimaoBusiness`。
3. 确认现有 `daimaoTagFunctions` 仍可用，NFC 名片流程无需迁移。
4. 将 `miniprogram/config/business.js` 的 `apiMode` 从 `mock` 改为 `cloud`。

## 6. 视觉素材

将“呆猫视觉”中的新增 PNG 上传到共享云存储的 `daimao/` 目录，并核对
`miniprogram/config/assets.js` 中新增的 fileID。未上传时页面保留布局和文字，但对应插图不显示。

## 7. 管理接口

当前基础管理能力通过 `daimaoBusiness` action 提供：

- `adminList`
- `adminUpdateProject`
- `adminCreateEvent`
- `adminReviewCandidate`

所有管理操作校验 `users.is_admin`，项目调整和活动发布会写入 `admin_logs`。
