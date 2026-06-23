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

管理员身份来自：

- `users.is_admin = 1`

后台所有写操作必须：

- 校验登录态
- 校验 `is_admin`
- 写 `admin_logs`

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

第一期：

- 登录/权限校验
- 用户列表
- 用户详情
- 项目列表
- 项目编辑/发布
- 活动列表
- 活动编辑/发布

第二期：

- 社区认证管理
- 项目申请审核
- 活动报名审核
- 经验流水管理
- RAG 证据查看

第三期：

- NFC 批次管理
- 操作日志
- AI 任务/向量索引任务监控

## 注意事项

- `project_applications` 不进入长期 RAG 证据层，只作为申请业务数据。
- 活动参与进入 RAG 的时机建议是 `approved` 或 `attended`，不要把普通 `registered` 当作能力证据。
- 手动编辑用户资料时，要同步更新 `user_profiles`，并重新生成该用户的 `profile` RAG source。
- 后续线下录音转文字接入时，写 `rag_sources.source_type='offline_transcript'`，不要让硬件后台直连数据库。
