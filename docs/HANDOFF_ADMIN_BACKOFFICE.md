# 呆猫网页管理后台交接文档

## 目标

做一个网页端管理后台，给运营/营主使用，覆盖用户审核、用户资料维护、活动发布、活动管理、项目管理、RAG/AI 证据查看。

后台只面向管理员，不面向普通用户。

## 数据源

主数据全部在 CloudBase SQL：

- `users`：用户主身份，含 `openid`、`display_name`、`is_admin`、`experience_points`
- `user_profiles`：名片主档案
- `community_memberships`：社区认证
- `communities`：社区配置
- `projects`：项目主表
- `project_members`：项目成员
- `project_applications`：项目申请
- `official_events`：官方活动
- `event_registrations`：活动报名/参与
- `user_experience_events`：经验流水
- `rag_sources` / `rag_chunks` / `rag_index_jobs`：RAG 证据层
- `admin_logs`：后台操作日志

文档型数据库只作为入口/事件数据：

- `daimao_nfc_tags`：NFC 贴纸
- `daimao_tag_visits`：原始碰一碰事件
- `daimao_profile_reminder_subscriptions`：订阅提醒

## 接入方式

优先复用云函数：

- 云函数名：`daimaoBusiness`
- 环境：`cloud1-8gocbg40af3862ce`
- 数据库驱动：`BUSINESS_DB_DRIVER=cloudbase_rdb`

网页端不要直连数据库。所有读写通过云函数或 HTTP 网关调用。

## 权限

当前网页后台采用两层权限：

- 超级管理员：能查看和编辑所有社区、所有成员、所有用户资料，能维护社区主体资料。
- 社区管理员：只能看到自己绑定社区的成员、认证关系和证据链；可以给本社区成员上传密封证据。

代理服务环境变量：

- `ADMIN_SUPER_USERNAME` / `ADMIN_SUPER_PASSWORD`
- `ADMIN_WEB_TOKEN`：服务器代理调用 `daimaoBusiness` 的内部令牌，不给浏览器和普通管理员。

社区管理员不再通过环境变量维护。超管后台「管理员」模块写入：

- `admin_accounts`：后台账号、角色、状态、PBKDF2-SHA256 密码哈希。
- `admin_account_communities`：社区管理员和社区的多对多绑定。

`ADMIN_COMMUNITY_ACCOUNTS` 仍可作为旧环境兜底，但正式后台不要用它做日常账号管理。

当前已在代理层做服务端拦截：社区管理员即使绕过前端按钮，也不能编辑全局用户、不能编辑社区主体资料、不能查看其他社区成员证据。

待补：所有后台写操作统一写入 `admin_logs`，记录操作者、动作、目标表和目标 ID。

## 当前后台覆盖范围

已经接入：

- 登录：超级管理员 / 社区管理员账号。
- 管理员：超级管理员可新增、编辑、停用社区管理员，并绑定一个或多个社区。
- 概览：用户、社区、项目、活动统计。
- 用户：超级管理员可维护用户资料、头像、经验值、状态、管理员标记、社区认证、密封证据链。
- 社区：超级管理员可维护社区资料；社区管理员可查看本社区，搜索用户并添加认证，给成员上传证据。
- 项目：项目列表、封面上传、基础字段编辑。
- 活动：活动列表、封面上传、创建/编辑活动。
- RAG：证据来源和索引任务查看；社区管理员视角会按自己社区/成员过滤。
- 图片上传：浏览器上传原始二进制到 `/api/upload`，代理写入 CloudBase Storage，SQL 保存返回的 `cloud://...` fileID。

上线前必须执行：

```text
database/migrations/2026-06-29-admin-accounts.sql
```

上线前仍建议补齐：

- 项目申请审核列表：按项目展示申请人、AI 初审结论、证据摘要、人工通过/拒绝。
- 项目成员管理：添加成员、移除成员、项目结束后给成员写主理人评价。
- 活动报名/签到：报名列表、审核、签到、参加记录沉淀。
- NFC 批次管理：导入标签、查看绑定、冻结/解绑。
- 操作日志：给每一次后台写操作留痕。
- 社区归属字段：`projects` / `official_events` 后续应补 `community_id` 或 owner scope，社区管理员发布的项目/活动才能严格归属和过滤。

## 已有/待补 API

### 已有但需要 RDB 化

这些 action 在 `daimaoBusiness` 里已有雏形，但目前部分还走 MySQL 直连 SQL。网页后台开工前，建议先统一改成 CloudBase RDB：

- `adminList`
- `adminUpdateProject`
- `adminCreateEvent`
- `adminReviewCandidate`

### 建议新增 API

用户：

- `adminListUsers`
- `adminGetUserDetail`
- `adminUpdateUserProfile`
- `adminSetUserStatus`
- `adminSetUserAdmin`
- `adminAddUserExperienceEvent`

社区：

- `adminListCommunities`
- `adminUpsertCommunity`
- `adminCertifyUserCommunity`
- `adminRevokeUserCommunity`

项目：

- `adminListProjects`
- `adminCreateProject`
- `adminUpdateProject`
- `adminArchiveProject`
- `adminListProjectApplications`
- `adminApproveProjectApplication`
- `adminRejectProjectApplication`
- `adminAddProjectMember`
- `adminRemoveProjectMember`

活动：

- `adminListEvents`
- `adminCreateEvent`
- `adminUpdateEvent`
- `adminCancelEvent`
- `adminListEventRegistrations`
- `adminApproveEventRegistration`
- `adminMarkEventAttended`

RAG/AI：

- `adminListRagSources`
- `adminGetRagSource`
- `adminReindexRagSource`
- `adminArchiveRagSource`
- `adminListRagJobs`

NFC：

- `adminListNfcTags`
- `adminImportNfcTags`
- `adminFreezeNfcTag`
- `adminUnbindNfcTag`

## 页面建议

当前第一期已经落地：

- 登录/权限校验
- 用户列表
- 用户详情
- 项目列表
- 项目编辑/发布
- 活动列表
- 活动编辑/发布
- 社区成员搜索认证
- 社区成员密封证据上传
- 用户证据链查看、编辑、归档

下一期优先级：

- 项目申请审核
- 活动报名审核
- 经验流水管理
- 项目成员评价入口
- 操作日志

第三期：

- NFC 批次管理
- 操作日志
- AI 任务/向量索引任务监控

## 注意事项

- `project_applications` 不进入长期 RAG 证据层，只作为申请业务数据。
- 活动参与进入 RAG 的时机建议是 `approved` 或 `attended`，不要把普通 `registered` 当作能力证据。
- 手动编辑用户资料时，要同步更新 `user_profiles`，并重新生成该用户的 `profile` RAG source。
- 后续线下录音转文字接入时，写 `rag_sources.source_type='offline_transcript'`，不要让硬件后台直连数据库。
