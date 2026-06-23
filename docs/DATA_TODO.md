# 数据层后续待办

## 已完成

- CloudBase SQL 接入完成。
- 名片保存改为 SQL-only。
- `users` / `user_profiles` / `user_connections` 成为个人、名片、猫友主数据。
- 名片简介、标签、三个问答保存时自动写入 `rag_sources`、`rag_chunks`、`rag_index_jobs`。
- 项目申请材料不进入长期可信证据检索层。
- RAG 来源类型已预留 `offline_transcript`，用于后续线下录音设备转写文本。
- 小程序核心业务接口已切到 CloudBase SQL：项目列表、项目详情、围观点星、申请入局、我的项目、活动列表、活动报名、我的活动。

## 待做

### 活动参与记录进入 RAG

当前 `event_registrations` 已保存活动报名/参与硬事实，但还没有自动写入 `event_record` RAG。

实施条件：

- 将活动报名、签到、审核这一组接口统一切到 CloudBase RDB。
- 明确哪些活动状态进入 RAG：建议 `attended`、`approved`，不把普通 `registered` 当作能力证据。

写入规则：

- `rag_sources.source_type = 'event_record'`
- `rag_sources.owner_user_id = users.id`
- `rag_sources.event_id = official_events.id`
- `visibility = 'match_only'`
- `rag_chunks.evidence_polarity = 'neutral'` 或按活动角色提升为 `positive`

### 线下录音转文字入口

暂不接入硬件录音设备后台，但表结构已预留：

- `rag_sources.source_type = 'offline_transcript'`
- `owner_user_id` 关联录音归属人
- `project_id` / `event_id` 按场景可选
- 原始文件不强制保存，早期只保存转写文本和元数据

后续接入时优先做成云函数接口，不让硬件后台直连数据库。

### 项目协作空间全面 RDB 化

当前围观/开局的核心浏览和报名申请链路已走 CloudBase RDB。项目协作空间里仍有部分进阶能力需要后续统一：

- 项目记录上传和分析
- 项目日程提醒
- 邀请成员
- 项目内会议请求

这些能力与 RAG/AI/订阅消息耦合更深，建议在接向量库和 AI 时一起整理。

### 网页管理后台 API RDB 化

`daimaoBusiness` 里已有若干 admin action 雏形，但部分仍是 MySQL 直连 SQL 写法。网页管理后台开工前，需要先按 [HANDOFF_ADMIN_BACKOFFICE.md](/Users/machao/Desktop/I%20have%20a%20呆猫/docs/HANDOFF_ADMIN_BACKOFFICE.md) 统一成 CloudBase RDB。
