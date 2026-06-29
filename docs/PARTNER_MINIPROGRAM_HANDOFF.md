# 外部社区小程序接入呆猫中心数据交接文档

## 适用场景

其他社区可以使用自己的小程序外皮和 UI，但共用呆猫中心数据：

```text
社区小程序 -> daimaoBusiness 云函数 -> CloudBase SQL / ReAI RAG / AI / 云存储
```

小程序端不直连 SQL、ReAI、AI 中转站，也不保存任何后台密钥。所有读写都通过 `daimaoBusiness` 完成。

## 接入方式

### 方式 A：复用当前小程序源码

这是短期推荐方式。社区开发者拿到源码后，只改自己的页面、品牌、配置，不改中心数据链路。

关键配置：

- `project.config.json`
  - `appid` 改成该社区自己的小程序 AppID。
  - `cloudfunctionRoot` 保持 `cloudfunctions/`。
- `miniprogram/config/cloud.js`
  - `env` 保持呆猫中心云环境 ID。
  - `resourceAppid` 保持呆猫中心资源方 AppID。
- `miniprogram/config/runtime.js`
  - `apiMode` 保持 `cloud`。

当前代码已使用：

```js
new wx.cloud.Cloud({
  resourceAppid,
  resourceEnv,
});
```

也就是说，小程序前端虽然属于不同 AppID，但业务数据仍请求呆猫中心云环境。

如果某个外部主体的小程序无法被授权访问该 CloudBase 资源环境，就不要让它直连云函数；改走方式 B。

### 方式 B：标准 HTTPS 中心 API

这是后续多主体规模化后的推荐方式：

```text
外部社区小程序 -> HTTPS API -> 呆猫中心 API -> daimaoBusiness/SQL/RAG/AI
```

这个方式需要额外实现：

- app client 管理。
- `wx.login code -> openid/unionid` 服务端换取。
- appid 白名单。
- HMAC 签名。
- nonce 防重放。
- 按 `community_id` 做权限过滤。

当前仓库已经准备好 `app_clients` 和 `user_identities` 表，但标准 HTTPS API 网关还没有落地。

## 必须保留的云函数

### `daimaoBusiness`

核心业务云函数，必须保留。

负责：

- 项目列表、项目详情、围观、申请入局。
- 我的项目、我的活动、通知。
- 社区、成员、项目、活动后台管理。
- CloudBase SQL 读写。
- ReAI RAG 写入、召回、索引任务。
- AI 初审和证据链检索。
- 多小程序身份映射：`source_appid + openid -> user_id`。

小程序业务接口都通过：

```js
const api = require("../../utils/businessApi");

const result = await api.request("listProjects", {
  status: "active",
});
```

底层等价于：

```js
wx.cloud.callFunction({
  name: "daimaoBusiness",
  data: {
    action: "listProjects",
    status: "active",
  },
});
```

### `daimaoTagFunctions`

NFC 名片和碰一碰链路仍需要保留。

负责：

- NFC 标签查询。
- 标签绑定当前用户。
- 名片资料保存和读取。
- 碰一碰访问记录。
- 猫友关系。

小程序名片接口通过：

```js
const tagApi = require("../../utils/tagApi");

await tagApi.upsertCurrentUserProfile(profile);
await tagApi.bindTagToCurrentUser(token);
```

## 可以删除或忽略的云函数

仓库当前可交付代码里，只有两个有效云函数：

- `cloudfunctions/daimaoBusiness`
- `cloudfunctions/daimaoTagFunctions`

如果云开发控制台里还能看到这些历史函数，且确认不是其他项目在用，可以删除或忽略：

- `merchantPay`
- `merchantLogin`
- `merchantAuth`
- `merchantPayCallback`
- `merchantProducts`
- `merchantStores`
- `generateReview`
- `nfcAdmin`

注意：你的云环境有多个项目共享，删除控制台函数前必须先确认没有其他项目调用。

## `daimaoBusiness` 环境变量

必须配置：

```text
BUSINESS_DB_DRIVER=cloudbase_rdb
CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
MYSQL_DATABASE=cloud1-8gocbg40af3862ce
```

ReAI RAG：

```text
VECTOR_PROVIDER=reai_vdb
REAI_VDB_BASE_URL=https://api.cn.reai.com
REAI_VDB_PID=呆猫 ReAI 项目 ID
REAI_VDB_ID=项目级总知识库 tag ID
REAI_API_KEY=ReAI API Key
REAI_DEFAULT_TAG_IDS=项目级总知识库 tag ID，可多个逗号分隔
```

AI 中转站：

```text
AI_BASE_URL=https://app.yylx.io/v1
AI_API_KEY=AI 中转站 Key
AI_MODEL=gpt-5.5
AI_TEMPERATURE=0.5
AI_REQUEST_TIMEOUT_MS=25000
```

后台和定时任务：

```text
ADMIN_WEB_TOKEN=后台服务器代理调用云函数的内部令牌
ADMIN_WEB_OPENID=可选，指定超级管理员 openid
SCHEDULER_SECRET=定时任务密钥
```

可选：

```text
DASHBOARD_PUBLIC_TOKEN=大屏只读接口访问令牌
WECHAT_PROJECT_REMINDER_TEMPLATE_ID=订阅消息模板 ID
WECHAT_REMINDER_TITLE_KEY=订阅消息字段
WECHAT_REMINDER_TIME_KEY=订阅消息字段
WECHAT_REMINDER_NOTE_KEY=订阅消息字段
WECHAT_MINIPROGRAM_STATE=formal
```

安全要求：

- `REAI_API_KEY`、`AI_API_KEY`、`ADMIN_WEB_TOKEN`、`SCHEDULER_SECRET` 只能放云函数环境变量或服务器环境变量。
- 不允许写入小程序源码。
- 不允许交给社区开发者前端使用。

## `daimaoTagFunctions` 环境变量

建议配置：

```text
CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
TAG_SQL_SYNC=true
```

`TAG_SQL_SYNC` 不设或不等于 `false` 时，名片资料会同步到 CloudBase SQL。

## 小程序业务 API 调用方式

统一使用：

```js
const api = require("../../utils/businessApi");
const result = await api.request(action, data);
```

`api.request()` 会自动：

1. 初始化呆猫中心 CloudBase 资源环境。
2. 调用 `daimaoBusiness`。
3. 检查 `success`。
4. 失败时抛出业务错误。

### 常用用户端 action

项目：

```js
await api.request("listProjects", {});
await api.request("getProject", { projectId });
await api.request("applyProject", {
  projectId,
  request: {
    message: "我想参与这个项目",
    canOffer: "我能提供的能力",
    relatedExperience: "相关经历",
  },
});
await api.request("listMyProjects", {});
await api.request("toggleWatch", { projectId });
```

活动：

```js
await api.request("listEvents", {});
await api.request("registerEvent", { eventId });
```

身份和个人页：

```js
await api.request("getMyIdentity", {});
await api.request("getAgentProfile", {});
await api.request("saveAgentProfile", { profile });
```

通知和秘书：

```js
await api.request("listNotifications", {});
await api.request("markNotificationRead", { notificationId });
await api.request("getRecommendations", {});
```

项目空间：

```js
await api.request("getProjectSpace", { projectId });
await api.request("publishUpdate", { projectId, update });
await api.request("createProjectRecord", { projectId, record });
await api.request("analyzeProjectRecord", { recordId });
```

### NFC 和名片 action

统一使用：

```js
const tagApi = require("../../utils/tagApi");
```

常用接口：

```js
await tagApi.getTagByToken(token);
await tagApi.bindTagToCurrentUser(token);
await tagApi.recordTagVisit({ ownerUserId, source: "share_card" });
await tagApi.upsertCurrentUserProfile(profile);
await tagApi.getCurrentProfile();
await tagApi.getProfileByUserId(userId);
await tagApi.getMyConnections();
```

## 管理后台接口

多个社区共用同一个管理后台。

管理后台不要从浏览器直接携带 `ADMIN_WEB_TOKEN` 调云函数。当前推荐链路：

```text
浏览器后台 -> 轻量服务器 /api/admin -> daimaoBusiness
```

服务器代理读取：

```text
ADMIN_WEB_TOKEN
CLOUDBASE_ENV
CLOUDBASE_FUNCTION=daimaoBusiness
TENCENTCLOUD_SECRETID
TENCENTCLOUD_SECRETKEY
```

社区管理员账号不再靠环境变量维护，而是保存在 SQL：

- `admin_accounts`
- `admin_account_communities`

超管可以在后台维护社区管理员。

## 身份映射规则

不同小程序下，同一个微信用户的 `openid` 不同。

因此：

- `users.id` 是呆猫中心的真实用户 ID。
- `user_identities(source_appid, openid)` 是小程序身份映射。
- `unionid` 可用时，后续可以辅助自动合并。
- 不能确认是同一个人时，不自动合并，交给后台人工合并。

当前 `daimaoBusiness.currentUser()` 已经会自动：

1. 读取当前调用来源的 `APPID/OPENID`。
2. 查 `user_identities`。
3. 找不到时兼容旧的 `users.openid`。
4. 必要时自动创建 `users` 和 `user_identities`。

## 社区数据边界

社区相关数据都要通过 `community_id` 做边界：

- 社区管理员只能管理自己社区。
- 超级管理员可以看全局。
- 证据链 sealed 内容不向普通用户展示。
- RAG 召回后仍要回查 SQL 校验状态，归档/撤销/删除的证据不会传给 AI。

## 上线前检查清单

交付给一个新社区前，至少检查：

1. `project.config.json` 的 `appid` 是否改为该社区小程序 AppID。
2. `miniprogram/config/cloud.js` 是否仍指向呆猫中心资源环境。
3. `daimaoBusiness` 是否已部署。
4. `daimaoTagFunctions` 是否已部署。
5. `user_identities`、`app_clients` 迁移是否已执行。
6. 管理后台是否已创建该社区和社区管理员。
7. 新社区管理员是否只能看到自己的社区。
8. 小程序端是否可以正常调用 `getMyIdentity`。
9. 名片保存后，`users`、`user_profiles`、`user_identities` 是否有记录。
10. 项目申请后，站内信和后台审核是否正常。

## 不建议交给社区开发者的内容

不要交付：

- CloudBase SQL 账号或任何数据库直连能力。
- ReAI API Key。
- AI 中转站 API Key。
- `ADMIN_WEB_TOKEN`。
- `SCHEDULER_SECRET`。
- 腾讯云 CAM SecretId / SecretKey。

社区开发者只需要：

- 小程序源码。
- 可以调用的 `action` 清单。
- 自己小程序的 AppID 配置方式。
- UI 和业务展示规则。

