# 呆猫 2.0 部署清单

## 1. MySQL

1. 在腾讯云 MySQL 创建独立数据库和最小权限账号。
2. 新库执行 `database/schema.sql`；如果之前已经执行过旧版 schema，再执行 `database/migrations/2026-06-20-rag.sql`。
3. 将首个运营账号的 `users.is_admin` 更新为 `1`。
4. 云函数只允许通过内网或白名单访问 MySQL，不向小程序端开放数据库端口。

`daimaoBusiness` 环境变量：

```text
MYSQL_HOST
MYSQL_PORT=3306
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
MYSQL_SSL=false
MYSQL_CONNECTION_LIMIT=5
```

## 2. AI

后端使用 OpenAI-compatible Chat Completions 接口：

```text
AI_BASE_URL
AI_API_KEY
AI_MODEL
SECRETARY_PROJECT_REVIEW_PROMPT
VECTOR_SEARCH_URL
VECTOR_SEARCH_API_KEY
VECTOR_UPSERT_URL
VECTOR_UPSERT_API_KEY
VECTOR_TOP_K=4
RAG_MAX_CHUNK_CHARS=700
RAG_CHUNK_OVERLAP_CHARS=80
```

API Key 只配置在 `daimaoBusiness` 云函数环境变量。项目记录输出会经过
`cloudfunctions/daimaoBusiness/ai-schema.js` 校验，校验失败只记录失败任务，不创建正式内容。
`SECRETARY_PROJECT_REVIEW_PROMPT` 用于项目申请初审；`VECTOR_SEARCH_URL`/`VECTOR_SEARCH_API_KEY`
用于把申请内容发给外部向量库检索用户资料和项目资料；`VECTOR_UPSERT_URL`/`VECTOR_UPSERT_API_KEY`
用于把 `rag_chunks` 写入向量库。未配置时，小秘书会降级为人工模式，RAG 任务会留在 MySQL 中等待处理。
检索 query 的拼接、证据分桶和上下文预算见 `docs/EVIDENCE_RETRIEVAL_LAYER.md`。

VectorDB 接入建议在云函数和腾讯云 VectorDB 之间加一层轻量 HTTP 适配器，保持 `daimaoBusiness`
不绑定具体 SDK。当前云函数约定：

搜索请求：

```json
{
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
  "sourceId": 12,
  "jobType": "upsert",
  "documents": [
    {
      "id": "rag_12_0",
      "content": "切片正文",
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
4. 写入成功后，MySQL 中的 source/chunk/job 状态更新为 `indexed`。
5. 项目申请审核时，云函数按 5 路检索计划调用 `VECTOR_SEARCH_URL`，拿回证据后再交给 AI。

开通时需要你提供给代码侧的值：

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE

VECTOR_SEARCH_URL
VECTOR_SEARCH_API_KEY
VECTOR_UPSERT_URL
VECTOR_UPSERT_API_KEY

AI_BASE_URL
AI_API_KEY
AI_MODEL
SECRETARY_PROJECT_REVIEW_PROMPT
SCHEDULER_SECRET
```

腾讯云资源建议：

```text
MySQL：TDSQL-C MySQL 或 云数据库 MySQL，先选最小可用规格即可。
VectorDB：先选 1核2G / 20GB / 2节点的入门规格，后续按向量量级升配。
网络：优先让云函数、MySQL、VectorDB 在同一区域；MySQL 不暴露公网。
云定时：每 5-10 分钟调用 daimaoBusiness.processRagIndexJobs。
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
