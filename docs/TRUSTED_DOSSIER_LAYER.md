# 呆猫可信档案分层设计

## 目标

呆猫的核心不是让所有人自由发布项目，而是沉淀一个“靠谱 OPC 人才池”。

项目和活动由官方或官方主理人发布；成员能否参与项目，不能主要依赖个人自证，而要依赖平台沉淀的可信档案。

## 三层数据

### 1. 公开自述层

来源：

```text
用户自己填写的名片
用户自己填写的简介
用户自己回答的问题
用户公开展示的标签
公开活动/项目摘要
```

用途：

```text
名片展示
猫友了解
Agent 闲聊
初步兴趣匹配
```

特点：

```text
用户可见
用户可修改
可信度低
不能单独作为项目准入强证据
```

RAG 标记：

```text
source_trust = self_reported
visibility = profile_visible / agent_chat / public / match_only
```

### 2. 结构化事实层

来源：

```text
系统记录
官方项目流程
官方活动流程
社区认证流程
```

内容：

```text
参加过哪些项目
在项目中是什么角色
担任过几次主理人
项目是否完成
参加过哪些活动
是否通过社区认证
当前经验值和等级
是否有项目退出/拒绝/归档记录
```

用途：

```text
后台管理
项目申请硬性判断
统计和大屏
AI 判断中的硬事实
```

特点：

```text
主要存在 SQL
不依赖 RAG 召回
可以结构化查询和排序
```

### 3. 密封证据链层

来源只有两类：

```text
项目主理人在项目完结时为成员填写或上传的评价文本
平台管理员在后台填写或上传的证据文本
```

上传格式第一阶段只支持文本型资源：

```text
txt
md
docx
doc
其他格式后续再扩展
```

内容要求：

```text
是什么项目/场景
这个人承担了什么角色
做了什么具体贡献
结果如何
是否按时交付
协作是否稳定
有什么风险、偏好或不适合的地方
```

特点：

```text
用户不可见
用户不可修改
仅管理员/官方主理人可写
用于项目申请审核、后台评估和可信度判断
```

RAG 标记：

```text
source_trust = owner_review / admin_note / admin_interview / verified_record
visibility = sealed / admin_only / match_only
```

## SQL 和 ReAI 的边界

密封证据链不是“只放知识库”。

正确边界：

```text
原文和权限：CloudBase SQL
可检索副本：ReAI
判断和展示：先 ReAI 召回，再回 SQL 校验
```

也就是说：

```text
SQL 是主库。
ReAI 是可重建索引。
```

## 新增结构

### rag_sources.source_trust

用于标记这段 RAG 原文的可信来源：

```text
self_reported        用户自述
system_observed      系统事实/行为留痕
owner_review         项目主理人评价
admin_note           管理员备注
admin_interview      管理员访谈
verified_record      已确认记录
transcript_raw       原始转录
transcript_verified  已确认转录
```

### rag_sources.visibility

扩展为：

```text
private
profile_visible
agent_chat
match_only
project_visible
public
admin_only
sealed
```

### project_member_reviews

项目完结时，主理人对成员的密封评价。

核心字段：

```text
project_id
reviewer_user_id
reviewed_user_id
role
contribution_text
outcome_text
risk_text
reliability_score
collaboration_score
delivery_score
visibility = sealed
status = confirmed
```

后续这张表会生成：

```text
rag_sources.source_type = project_member_review
rag_sources.source_trust = owner_review
rag_sources.owner_user_id = reviewed_user_id
rag_sources.visibility = sealed
```

### evidence_records

管理员证据先复用并扩展 `evidence_records`。

新增证据类型：

```text
admin_interview
admin_evidence
risk_note
owner_review
```

后续后台上传管理员证据时，会生成：

```text
rag_sources.source_type = admin_evidence / admin_interview / admin_note
rag_sources.source_trust = admin_note / admin_interview / verified_record
rag_sources.visibility = sealed / admin_only
```

## 检索场景

### Agent 闲聊

只允许用：

```text
source_trust = self_reported
visibility = profile_visible / agent_chat / public
```

不能用：

```text
owner_review
admin_note
admin_interview
sealed
admin_only
```

闲聊内容默认不进入可信档案。

### 项目申请审核

允许用：

```text
self_reported
system_observed
owner_review
admin_note
admin_interview
verified_record
transcript_verified
```

允许可见性：

```text
match_only
project_visible
admin_only
sealed
```

但 AI 必须区分来源：

```text
本人自述不能当强证据。
主理人评价和管理员证据是核心证据链。
负向证据不能被当作正向能力。
```

## 当前已改

```text
1. 新增数据库迁移：database/migrations/2026-06-27-sealed-evidence-layer.sql
2. schema.sql 已同步。
3. daimaoBusiness 的 RAG metadata 已加入 source_trust。
4. 项目申请的 RAG 检索范围已包含 project_member_review / admin_evidence / admin_interview。
5. 项目申请的 RAG 检索允许读取 sealed / admin_only。
6. ReAI 召回结果会按 owner_user_id / source_type / visibility / source_trust / polarity 做本地过滤。
```

## 需要你配合

在 CloudBase SQL 编辑器执行：

```text
database/migrations/2026-06-27-sealed-evidence-layer.sql
```

执行完之后，再部署新版 `daimaoBusiness`。

顺序不要反：

```text
先迁移数据库。
再部署云函数。
```

否则旧表没有 `source_trust` 字段，云函数写 RAG 时会报错。

## 后续待做

```text
1. 给后台增加“项目成员完结评价”录入/上传入口。
2. 给后台增加“管理员密封证据”录入/上传入口。已完成社区成员入口：管理后台社区页可给 active 社区成员上传 `txt/md/docx/pdf` 或直接填写文本，写入 `evidence_records + rag_sources/rag_chunks/rag_index_jobs`。
3. 录入后自动写 project_member_reviews / evidence_records。
4. 自动生成 rag_sources / rag_chunks / rag_index_jobs。
5. 把 CloudBase RDB 分支的项目申请从人工模式升级为真正的 RAG + AI 初审。
```

## 当前可测试接口

下面三个接口已经先作为后台/测试口子接入 `daimaoBusiness`。它们要求当前调用者是管理员；云端测试时可以传 `adminWebToken`，让 `currentUser` 走后台管理员身份。

### 1. 写入项目主理人评价

```json
{
  "action": "adminCreateProjectMemberReview",
  "adminWebToken": "你的 ADMIN_WEB_TOKEN",
  "projectId": 1,
  "reviewedUserId": 4,
  "review": {
    "role": "AI 工程师 / 小程序接入",
    "contributionText": "在项目中负责 CloudBase SQL、RAG 切片和 ReAI 知识库接入，能把复杂链路拆成可测试步骤。",
    "outcomeText": "完成数据库、RAG、AI 连通，能稳定推动项目从概念进入可验证阶段。",
    "riskText": "如果需求边界不清，会倾向先做技术验证，需要主理人明确优先级。",
    "reliabilityScore": 8,
    "collaborationScore": 8,
    "deliveryScore": 8
  }
}
```

写入结果：

```text
project_member_reviews
rag_sources.source_type = project_member_review
rag_sources.source_trust = owner_review
rag_sources.visibility = sealed
rag_chunks
rag_index_jobs.status = pending
```

### 2. 写入管理员密封证据

```json
{
  "action": "adminCreateUserEvidence",
  "adminWebToken": "你的 ADMIN_WEB_TOKEN",
  "userId": 4,
  "projectId": 1,
  "evidenceType": "admin_note",
  "content": "管理员访谈记录：该成员能独立排查 CloudBase、SQL、RAG 和 AI 接口问题，适合参与技术验证型项目。不适合在目标极不清楚时直接承担最终交付承诺。",
  "confidence": 0.9
}
```

写入结果：

```text
evidence_records
rag_sources.source_type = admin_note / admin_evidence / admin_interview
rag_sources.source_trust = admin_note / admin_interview / verified_record
rag_sources.visibility = sealed
rag_chunks
rag_index_jobs.status = pending
```

### 3. 手动跑索引

```json
{
  "action": "processRagIndexJobs",
  "adminWebToken": "你的 ADMIN_WEB_TOKEN",
  "limit": 10
}
```

或用定时任务密钥：

```json
{
  "action": "processRagIndexJobs",
  "schedulerSecret": "你的 SCHEDULER_SECRET",
  "limit": 10
}
```

确认：

```text
rag_index_jobs.status = completed
rag_sources.status = indexed
rag_chunks.status = indexed
rag_chunks.vector_doc_id 有 ReAI objectId
```

### 4. 只测试检索问题和证据召回，不跑最终 AI 初审

```json
{
  "action": "adminTestProjectApplicationEvidence",
  "adminWebToken": "你的 ADMIN_WEB_TOKEN",
  "projectId": 1,
  "applicantUserId": 4,
  "application": {
    "message": "我想参与这个项目，负责 AI 接入、CloudBase 数据流和 RAG 证据链验证。",
    "canOffer": "我可以提供小程序云函数、SQL 表结构、ReAI 知识库接入和 AI 初审链路调试。",
    "relatedExperience": "最近做过呆猫 2.0 的数据库迁移、RAG 切片、ReAI 接入和 YYLX 模型接口连通。"
  }
}
```

返回中重点看：

```text
retrievalPlan：AI 生成的 5-6 个检索问题
evidence：召回并过滤后的证据链
hardFacts：SQL 里的客观事实
```

判断测试是否通过：

```text
1. evidence 里应该能看到 profile/project_member_review/admin_note 等不同来源。
2. owner_review/admin_note 这类 sealed 证据应该能参与项目审核。
3. risk 里应该能看到“不适合/风险/不擅长/边界不清”等负向或偏好证据。
```

### 5. 测试完整项目申请审核，不真正写申请

```json
{
  "action": "adminTestProjectApplicationReview",
  "adminWebToken": "你的 ADMIN_WEB_TOKEN",
  "projectId": 1,
  "applicantUserId": 4,
  "application": {
    "message": "我想参与这个项目，负责 AI 接入、CloudBase 数据流和 RAG 证据链验证。",
    "canOffer": "我可以提供小程序云函数、SQL 表结构、ReAI 知识库接入和 AI 初审链路调试。",
    "relatedExperience": "最近做过呆猫 2.0 的数据库迁移、RAG 切片、ReAI 接入和 YYLX 模型接口连通。"
  }
}
```

返回中重点看：

```text
review.status = pass / revise / reject
review.summary 应该引用“主理人评价/管理员证据/证据不足”等依据。
```

判断测试是否通过：

```text
1. AI 不能只复述个人自述。
2. 如果个人自述很夸张，但密封证据有风险，AI 不应该只按个人自述给 pass。
3. 如果证据不足，AI 应该输出 revise 或在 summary 里明确说明证据不足。
```
