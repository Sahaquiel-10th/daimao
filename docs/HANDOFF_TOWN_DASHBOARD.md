# 呆猫小镇大屏交接文档

## 目标

做一个给领导、社区、孵化器大屏展示的网页端可视化：

- 每个项目是一栋房子/一个工位/一个屏幕。
- 每个认证成员是一个小人。
- 小人根据参与项目关系在项目之间活动。
- 展示当前生态活跃度：社区、项目、认证用户、活动、猫友关系。

这是只读展示系统，不做业务写入。

## 推荐接入方式

使用 `daimaoBusiness` 云函数的公开只读 action：

- `publicDashboardStats`
- `publicProjectTown`

环境：

- CloudBase env：`cloud1-8gocbg40af3862ce`
- 云函数：`daimaoBusiness`
- 驱动：`BUSINESS_DB_DRIVER=cloudbase_rdb`

如果配置了 `DASHBOARD_PUBLIC_TOKEN`，调用时需要带同名 token 字段。

## 已有 API

### publicDashboardStats

用途：大屏顶部统计。

请求：

```json
{
  "action": "publicDashboardStats",
  "token": "可选，取决于 DASHBOARD_PUBLIC_TOKEN"
}
```

返回核心字段：

- `stats.userCount`
- `stats.communityMemberCount`
- `stats.projectCount`
- `stats.activeProjectCount`
- `stats.eventCount`
- `stats.connectionCount`
- `communities`
- `generatedAt`

### publicProjectTown

用途：小镇主画布。

请求：

```json
{
  "action": "publicProjectTown",
  "limit": 100,
  "token": "可选，取决于 DASHBOARD_PUBLIC_TOKEN"
}
```

返回核心字段：

- `town.projects`
- `town.communities`
- `town.events`
- `generatedAt`

`town.projects[]` 包含：

- `id`
- `name`
- `description`
- `status`
- `stage`
- `tags`
- `starCount`
- `watchCount`
- `houseType`
- `position`
- `creator`
- `members`

`members[]` 包含：

- `id`
- `displayName`
- `avatarUrl`
- `experiencePoints`
- `role`
- `status`
- `communities`

## 数据表关系

- 项目：`projects`
- 项目成员：`project_members`
- 用户：`users`
- 用户名片：`user_profiles`
- 社区：`communities`
- 社区认证：`community_memberships`
- 活动：`official_events`
- 猫友关系：`user_connections`

一个人参与多个项目、一个项目多人参与，统一看 `project_members`。

## 视觉建议

第一版别做复杂 3D，先做稳定可读的 2D 小镇：

- 项目房子按 `projects.position` 或前端布局算法排列。
- 房子大小按 `members.length`、`starCount`、`watchCount` 综合决定。
- 小人按 `project_members` 分布到房子旁边。
- 一个用户参与多个项目时，可以在几个房子之间做循环移动。
- 活动可以做成小镇中的公告牌/日历牌。
- 社区可以做成左侧徽章墙。

## 刷新策略

- 大屏每 30-60 秒刷新一次即可。
- 不需要实时 WebSocket。
- 如果现场演示需要更灵动，可以前端本地做随机走动动画，不要频繁打后端。

## 权限和安全

这是公开只读接口，但仍建议配置：

- `DASHBOARD_PUBLIC_TOKEN`
- 大屏 URL 带 token
- 不展示 openid、wechat、个人敏感字段

当前公开接口只返回展示名、头像、经验分、社区徽章、项目关系，不返回微信号。

## 待补建议

后续可以给 `publicProjectTown` 增加：

- `town.recentActivities`：最近项目动态/活动动态
- `town.topUsers`：经验高的人
- `town.connections`：项目之间共同成员关系
- `town.timeline`：近期活动时间线

这些字段都可以从现有 SQL 表推导，不需要新增主表。
