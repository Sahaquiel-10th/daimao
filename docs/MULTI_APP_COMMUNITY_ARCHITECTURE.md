# 多主体小程序共用呆猫中心数据架构

## 目标

多个不同公司主体、不同小程序、不同 UI 的社区，可以共用呆猫中心数据：

- 成员资料、社区认证、项目、活动、证据链、RAG、AI 审核都保存在呆猫中心。
- 各社区小程序只负责自己的外皮、入口、交互和展示。
- 所有写入和读取都通过呆猫中心 API，不直接暴露数据库账号。

## 推荐架构

```text
A 社区小程序 ┐
B 社区小程序 ├─ HTTPS API ── 呆猫中心 API ── CloudBase SQL
C 社区小程序 ┘                         ├─ ReAI RAG
                                      ├─ AI 中转站
                                      └─ CloudBase 云存储
```

不要让外部小程序直接连 CloudBase SQL。正确边界是：

- 小程序调用中心 API。
- 中心 API 做鉴权、身份映射、权限过滤、数据读写。
- SQL/RAG/AI 都只由中心 API 访问。

## 数据分层

`users` 表表示“一个真实的人”。

`user_identities` 表表示“这个人在某个小程序/入口里的身份”：

- `source_appid`: 来源小程序 appid。
- `openid`: 该小程序下的 openid。
- `unionid`: 如果可用，用于自动合并身份。
- `user_id`: 归属到哪个中心用户。
- `community_id`: 这个入口默认关联的社区，可为空。

同一个微信用户在不同小程序下 openid 不同，因此不能再把 `users.openid` 当成唯一长期身份。它保留为兼容字段，新的多端身份以 `user_identities(source_appid, openid)` 为准。

`app_clients` 表表示接入呆猫中心的外部应用：

- 一个小程序一个 app client。
- 可以绑定默认社区。
- 后续可扩展 API key、签名密钥、白名单、限流配置。

## 身份自动化方案

当前已实现的自动化：

1. 用户从现有小程序进入云函数。
2. 云函数读取 `APPID + OPENID`。
3. 先查 `user_identities(source_appid, openid)`。
4. 如果存在，直接得到中心 `user_id`。
5. 如果不存在，兼容旧逻辑查 `users.openid`。
6. 如果旧用户存在，自动补一条 `user_identities`。
7. 如果旧用户不存在，创建 `users`，再创建 `user_identities`。

后续外部小程序接入时，建议使用：

1. 外部小程序调用 `wx.login()` 拿 `code`。
2. 把 `appid + code + 请求签名` 发给呆猫中心 API。
3. 呆猫中心 API 用该 appid 的配置调用微信 `jscode2session`，换取 openid/unionid。
4. 按 `user_identities` 自动创建或绑定中心用户。

不要让外部小程序前端直接上报 openid 作为可信身份，openid 必须由服务端通过微信接口换取或校验。

## 自动合并与人工合并

能自动合并的情况：

- 多个小程序都能拿到同一个 `unionid`。
- 用户主动绑定手机号、微信号、邀请链接、认证流程中的唯一凭据。

不能自动确定时：

- 先创建独立 `users`。
- 后台提供“合并用户”能力，把多个 `user_identities` 归到同一个 `user_id`。
- 证据链、项目记录、活动记录都以 `user_id` 关联，因此合并后可统一归档。

## 安全边界

中心 API 必须做：

- `appid` 白名单。
- 每个 app client 独立密钥。
- HMAC 请求签名，包含 timestamp、nonce、body hash。
- 防重放：timestamp 窗口和 nonce 去重。
- 所有查询按 `community_id`、角色、用户身份过滤。
- 证据链 sealed 数据只允许后台和 AI 审核链路读取。

## 当前状态

已落地：

- `user_identities` 表。
- `app_clients` 表。
- 现有小程序登录时自动补 `user_identities`。
- 保留 `users.openid` 兼容现有数据。

未落地，后续要做：

- HTTP 中心 API 网关。
- 外部小程序 app client 管理界面。
- `wx.login code -> openid/unionid` 服务端换取。
- 请求签名和 nonce 防重放。
- 用户合并后台。
