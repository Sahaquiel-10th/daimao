# 呆猫个人数据地图

## 结论

呆猫当前有两套数据库：

1. 文档型数据库：只保留 NFC 贴纸、原始碰一碰事件、订阅提醒这类微信入口/事件数据。
2. SQL 型数据库：承载个人主档案、社区、项目、活动、经验、猫友关系、RAG 元数据。

两套库当前共同的个人主键是微信 `openid`。文档库字段叫 `userId`，SQL `users.openid` 保存同一个值。所有个人维度数据都应通过这个 openid 归并到 SQL `users.id`。

## 文档型数据库

### daimao_user_profiles

用途：历史名片资料，仅作为迁移前旧数据来源保留；新保存名片不再写入这里。

关键字段：

- `userId`：微信 openid。当前名片体系的个人主键。
- `name`、`job`、`wechat`、`avatar`、`intro`：名片资料。
- `answers`、`tags`：问答和标签。
- `stickerCode`：展示用贴纸编号。
- `boundTagIds`、`boundTagCodes`：绑定过的 NFC 标签。
- `agreementVersion`：是否同意当前隐私协议。

当前写入函数：无。`daimaoTagFunctions.upsertCurrentUserProfile` 已改为 SQL-only。

### daimao_nfc_tags

用途：NFC/碰一碰标签。

关键字段：

- `tagCode`：展示编号。
- `claimToken`：绑定/访问 token。
- `ownerUserId`：标签拥有者 openid。
- `status`：`bound`/`frozen` 等。
- `visitCount`、`lastVisitedAt`：访问统计。

当前写入函数：`bindTagToCurrentUser`。

### daimao_tag_visits

用途：猫友关系原始事件。

关键字段：

- `ownerUserId`：被访问名片的用户 openid。
- `visitorUserId`：访问者 openid。
- `tagId`、`tagCode`：如果来自 NFC，则记录标签。
- `source`：来源，当前包括 `unknown`、NFC 相关来源、`share_card`。

说明：`daimao_tag_visits` 只保留原始事件。猫友列表以 SQL `user_connections` 为准。

### daimao_profile_reminder_subscriptions

用途：未注册/未保存名片的人授权接收提醒。

关键字段：

- `ownerUserId`：名片拥有者 openid。
- `recipientUserId`：待提醒用户 openid。
- `tagId`、`tagCode`
- `status`：`available`/`sent`/`unavailable`。

## SQL 型数据库

### users

用途：个人主身份表。所有业务、人、经验和 RAG 资料最终都关联到这里。

关键字段：

- `id`：SQL 内部用户 ID。
- `openid`：微信 openid，应与文档库 `userId` 对齐。
- `display_name`、`avatar_url`：业务侧展示名和头像。
- `is_admin`：是否营主/管理员。
- `experience_points`：经验分。

当前写入函数：`daimaoBusiness.currentUser`，用户调用 2.0 业务接口时按 openid 自动创建。

### user_profiles

用途：SQL 里的名片主档案。

关键字段：

- `user_id`：关联 `users.id`。
- `source_profile_id`：来源文档库 profile `_id`。
- `name`、`job`、`wechat`、`avatar_url`、`intro`：名片基础资料。
- `answers_json`、`tags_json`：名片问答和标签。
- `sticker_code`：贴纸编号。
- `agreement_version`：隐私协议版本。

说明：从现在起，SQL `user_profiles` 是人的可信主档案。名片保存不再双写 `daimao_user_profiles`。`source_profile_id` 只用于标记历史迁移来源，新版直接保存的用户可以为空。

### user_connections

用途：SQL 里的猫友聚合关系。

关键字段：

- `user_id`
- `friend_user_id`
- `source`：`nfc`、`share_card`、`manual`、`migration`。
- `visit_count`
- `first_met_at`、`last_met_at`

说明：打开分享名片、碰 NFC、历史迁移都会生成双向猫友关系。猫友列表直接读这个表。

### community_memberships

用途：社区认证。

关键字段：

- `user_id`：关联 `users.id`。
- `community_id`：关联社区。
- `status`：`active` 代表已认证。
- `tags_json`：社区给这个人的能力/身份标签。

### project_members

用途：项目参与关系。

关键字段：

- `project_id`
- `user_id`
- `role`
- `status`

说明：一个项目一份项目资料，所有相关人通过 `project_members` 与项目关联。项目申请人在申请阶段先在 `project_applications`，通过后进入 `project_members`。

### event_registrations

用途：活动报名/参加记录。

关键字段：

- `event_id`
- `user_id`
- `status`：`registered`/`approved`/`attended` 等。

说明：活动留痕通过这个表和 `user_experience_events` 进入个人经验。

### user_experience_events

用途：个人经验流水。

关键字段：

- `user_id`
- `event_type`
- `points`
- `source_type`
- `source_id`

说明：不要只改 `users.experience_points`。每次加经验应写一条流水，再更新总分。

### rag_sources / rag_chunks / rag_index_jobs

用途：可信证据检索层的文本来源、切片和索引任务。

关键字段：

- `owner_user_id`：这条资料归属哪个人。
- `project_id`、`event_id`、`community_id`：资料上下文。
- `source_type`、`source_id`：原始业务表来源。

说明：AI 判断个人能力时，SQL 硬事实来自业务表，佐证资料来自这些 RAG 表和向量库。

当前进入 RAG 的资料：

- 名片简介和问答：`source_type='profile'`
- 项目过程记录：`source_type='project_record'`
- 活动参与/活动记录：`source_type='event_record'`
- 管理员备注/评审记录：`source_type='admin_note'`
- 后续硬件录音转文字：`source_type='offline_transcript'`

明确不进入 RAG 的资料：

- 项目申请材料：保留在 `project_applications`，不作为长期可信证据。

## 当前风险点

1. 微信开发者工具现在允许真实写云端。
   - `miniprogram/config/runtime.js` 中 `allowCloudWritesInDevelop=true`。
   - 开发版保存名片会直接更新 SQL。

2. 历史文档库资料如果还需要补齐，可以执行迁移 action。
   - 新保存名片已经是 SQL-only。
   - 历史资料可执行 `migrateProfilesToSql`。

## 推荐迁移策略

阶段一：SQL 成为个人主档案，文档库保留 NFC 原始链路。

- 新保存名片：只写 SQL `users`、`user_profiles`、`user_experience_events`，并生成 `rag_sources/rag_chunks/rag_index_jobs`。
- 新猫友关系：写 SQL `user_connections`；NFC 触发时额外保留一条 `daimao_tag_visits` 原始事件。

阶段二：批量迁移历史数据。

- 扫描 `daimao_user_profiles`。
- 对每条 profile 执行阶段二同步。
- 扫描 `daimao_tag_visits`。
- 按 owner/visitor openid 补齐 SQL `users`。
- 扫描 `daimao_tag_visits`。
- 按 owner/visitor openid 补齐 SQL `users` 和 `user_connections`。

## 个人维度关联原则

所有数据最终都应能回答：

- 这个人是谁：`users.openid` / `users.id`
- 他属于哪些社区：`community_memberships`
- 他参与哪些项目：`project_members`
- 他申请过哪些项目：`project_applications`
- 他参加过哪些活动：`event_registrations`
- 他得过哪些经验：`user_experience_events`
- 哪些文本证据属于他：`rag_sources.owner_user_id`
- 他碰过谁/谁碰过他：`user_connections`

项目、活动、名片、RAG 资料都不应孤立存在，必须能回到个人 openid 或 SQL `users.id`。
