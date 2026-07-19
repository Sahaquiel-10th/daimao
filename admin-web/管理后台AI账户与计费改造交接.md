# 管理后台 AI 账户与计费改造交接

> 数据中心主导版本：2026-07-18
> 适用对象：超管后台、社区管理后台、后台代理服务开发者

## 1. 已确定的架构

平台和社区不再共用一套二次计费钱包：

- 平台拥有一个独立 AI 路由，由超管配置，只承担数据中心自身和无法归属社区的 AI 请求。
- 每个社区拥有一个或多个独立 AI 上游账户，并为自己的 AppClient 选择账户和模型。
- 上游可以是呆猫中转站，也可以是允许域名内的 OpenAI 兼容服务或 Anthropic 服务。
- 数据中心继续负责身份、权限、提示词、RAG、结构化输出校验、业务编排、服务端转发和审计。
- API Key 只进入数据中心服务端，经 AES-256-GCM 加密后入库；浏览器、小程序和读取接口都不能取得完整 Key。
- `relay/external` 的余额和实扣以上游为准。数据中心不为它们充值、调账或维护第二套余额。

账户作用域：

| `accountScope` | 数据字段 | 配置者 | 可以绑定到 |
| --- | --- | --- | --- |
| `platform` | `community_id = NULL` | 仅超级管理员 | `platform_ai_settings` |
| `community` | `community_id = 社区ID` | 超管或该社区管理员 | 同社区 AppClient |

路由优先按“本次请求属于谁”判断，不直接按项目是否绑定社区判断：

1. 外部社区 AppClient 发起的请求，使用该 AppClient 的配置。
2. 后台明确代表某社区发起的请求，使用该社区对应 AppClient 的配置。
3. 数据中心自身请求、没有来源 AppClient 的请求和无法归属的历史请求，使用平台配置。

## 2. 数据中心本次提供的能力

### 2.1 平台 AI 配置已经数据库化

新增表：`platform_ai_settings`，固定使用 `id=1`。

新增接口：

- `adminGetPlatformAiSettings`
- `adminUpdatePlatformAiSettings`
- `adminCheckPlatformAiConnection`

无 AppClient 归属的 AI 请求会先读取 `platform_ai_settings`。当其为 `relay/external` 时，使用超管绑定的平台账户；当其为 `local` 时，才回退旧的 `AI_BASE_URL / AI_API_KEY / AI_MODEL`。

旧环境变量仅用于迁移和应急回退。完成平台账户联调后，应将平台设置切换到 `relay/external`；不要在确认前删除旧环境变量。

### 2.2 上游账户支持平台和社区两种作用域

沿用接口：

- `adminListAiProviderAccounts`
- `adminUpsertAiProviderAccount`

读取结果增加：

```json
{
  "id": 1,
  "accountScope": "platform",
  "communityId": null,
  "apiKeyLastFour": "1234"
}
```

服务端强制隔离：

- 平台设置不能绑定社区账户。
- AppClient 不能绑定平台账户或其他社区账户。
- 账户创建后不能在 `platform/community` 作用域间移动；需要新建账户。
- 完整 API Key 永不回显，更新时不传 `apiKey` 表示保持原 Key。

### 2.3 中转站真实余额和用量

`providerType=relay` 时，数据中心会使用保存的 Key 服务端读取：

```text
GET {baseUrl}/account
GET {baseUrl}/usage?page=1&page_size=5|10
```

平台从 `adminGetPlatformAiSettings.externalBilling` 读取；单个社区 AppClient 从 `adminGetAppClientBilling.externalBilling` 读取。

普通 `openai_compatible/anthropic` 服务如果没有上述只读接口，后台应显示“该供应商不提供余额读取”，不能拿本地钱包余额冒充真实余额。

## 3. 超管后台必须实现

新增“平台 AI”页面，且只允许 `super_admin` 访问。

### 3.1 平台账户列表

请求：

```json
{
  "action": "adminListAiProviderAccounts",
  "accountScope": "platform"
}
```

展示：账户名、供应商类型、协议、Base URL、Key 后四位、充值链接、状态和更新时间。不得提供完整 Key 查看功能。

### 3.2 创建平台账户

```json
{
  "action": "adminUpsertAiProviderAccount",
  "account": {
    "accountScope": "platform",
    "name": "数据中心中转站账户",
    "providerType": "relay",
    "protocol": "openai_chat",
    "baseUrl": "https://s-api.aiarrival.cn/v1",
    "apiKey": "sk-live-...",
    "rechargeUrl": "https://中转站充值页",
    "status": "active"
  }
}
```

平台账户不要传 `communityId`。

### 3.3 绑定平台默认路由

```json
{
  "action": "adminUpdatePlatformAiSettings",
  "settings": {
    "billingEnabled": true,
    "billingSource": "relay",
    "aiProviderAccountId": 1001,
    "defaultModel": "your-default-model-id",
    "taskModels": {
      "project_application_retrieval_queries": "cheap-json-model",
      "project_application_secretary_review": "review-model",
      "assistant_chat_transcript": "chat-model",
      "assistant_chat_turn": "chat-model"
    },
    "note": "数据中心自身 AI 线路"
  }
}
```

`taskModels` 优先于 `defaultModel`。第一版 UI 可以只要求默认模型，但数据结构必须保留任务模型编辑能力。

`billingSource` 含义：

- `relay`：呆猫中转站，支持余额和用量读取。
- `external`：其他供应商，由该供应商直接计费。
- `local`：迁移期旧环境变量线路，不是新的推荐配置。

### 3.4 平台余额、用量及连通测试

```json
{
  "action": "adminGetPlatformAiSettings",
  "page": 1,
  "pageSize": 10
}
```

使用以下返回值：

- `platformAiSettings`：启停、路由来源、账户、默认模型和任务模型。
- `providerAccount`：不含秘密的账户资料。
- `externalBilling.account`：余额、预留、可用、本月和累计汇总。
- `externalBilling.usage`：中转站原始分页计量数据。
- `externalBilling.readError`：余额或用量读取失败原因。
- `configurationSource`：`platform_database` 或 `environment_fallback`。

连通测试：

```json
{
  "action": "adminCheckPlatformAiConnection"
}
```

该操作会产生一次真实模型请求和少量费用，按钮旁必须说明。失败时原样展示后端 `code/message`。

## 4. 社区管理后台必须实现

社区管理员只能看到和修改其登录会话被授权的社区。浏览器不能直接持有 `ADMIN_WEB_TOKEN`，所有写操作必须经过后台代理服务。

数据中心云函数接收到的是后台代理注入的服务端管理员凭证，不能把浏览器自报的角色当作可信信息。因此“谁是 super_admin、社区管理员能管理哪些 communityId”必须由现有后台代理根据 `admin_accounts/admin_account_communities` 判定；数据中心负责第二层平台/社区/账户/AppClient 归属校验。两层都必须保留。

### 4.1 社区账户列表与维护

```json
{
  "action": "adminListAiProviderAccounts",
  "accountScope": "community",
  "communityId": 2001
}
```

创建：

```json
{
  "action": "adminUpsertAiProviderAccount",
  "account": {
    "accountScope": "community",
    "communityId": 2001,
    "name": "社区自己的 AI",
    "providerType": "relay",
    "protocol": "openai_chat",
    "baseUrl": "https://s-api.aiarrival.cn/v1",
    "apiKey": "sk-live-...",
    "rechargeUrl": "https://中转站充值页",
    "status": "active"
  }
}
```

后台代理必须忽略浏览器自行提交的越权 `communityId`，并使用登录会话允许的社区 ID 校验或重写。社区管理员不得创建 `accountScope=platform` 的账户。

### 4.2 为社区 AppClient 选择账户和模型

```json
{
  "action": "adminUpdateAppClientBillingSettings",
  "appClientId": 3001,
  "settings": {
    "billingEnabled": true,
    "billingSource": "relay",
    "aiProviderAccountId": 4001,
    "defaultModel": "your-model-id",
    "taskModels": {}
  }
}
```

后台代理必须先确认：

- AppClient 属于当前社区管理员的授权社区。
- 供应商账户也属于同一社区。
- 社区管理员不能把 AppClient 切换到平台账户。

数据中心还会再次校验账户和 AppClient 的社区是否一致。

### 4.3 社区计费页面改造

指定单个 AppClient 调用：

```json
{
  "action": "adminGetAppClientBilling",
  "appClientId": 3001,
  "page": 1,
  "pageSize": 10
}
```

当 `client.balanceSource=ai_provider`：

- 真实余额读取 `externalBilling.account`。
- 真实计量读取 `externalBilling.usage`。
- 充值按钮跳转 `externalBilling.providerAccount.rechargeUrl`。
- 隐藏数据中心本地充值、调账、钱包冻结等按钮。
- `usageEvents` 仅作为数据中心审计记录，不是余额事实来源。
- `externalBilling.readError` 不为空时显示“上游数据暂不可用”，不得回退显示本地钱包。

当 `client.balanceSource=local_wallet`：保留旧钱包页面，仅用于尚未迁移的 AppClient。

## 5. 后台代理的强制权限规则

当前后台账号角色和社区绑定在：

- `admin_accounts.role`
- `admin_account_communities.community_id`

管理后台代理需要在把请求转发给数据中心前执行：

| 操作 | `super_admin` | `community_admin` |
| --- | --- | --- |
| 查询/维护平台账户 | 允许 | 禁止 |
| 读取/更新平台 AI 设置 | 允许 | 禁止 |
| 查看全部社区账户 | 允许 | 禁止 |
| 维护授权社区账户 | 允许 | 允许 |
| 绑定授权社区 AppClient | 允许 | 允许 |
| 读取授权社区余额/用量 | 允许 | 允许 |
| 本地充值/调账 relay/external | 禁止 | 禁止 |

社区管理员请求必须同时校验“请求社区”“目标 AppClient 社区”“目标账户社区”，不能只隐藏前端菜单。

## 6. UI 页面建议

计费模块拆成三层：

1. **AI 路由**：平台或社区当前选择哪个供应商账户、默认模型、任务模型、启停状态。
2. **供应商账户**：URL、协议、Key 后四位、轮换 Key、充值入口、状态。
3. **余额与计量**：真实余额、汇总、请求明细和数据中心审计。

不要继续使用旧的“统一电力定价”页面表达 `relay/external`。旧的价格、充值单、钱包、调账只放入“旧本地计费”区域，并根据 `billingSource=local` 条件显示。

## 7. 错误码处理

前端必须展示 `success=false` 的 `code` 和 `message`，不能静默失败。重点处理：

| 错误码 | 页面提示/处理 |
| --- | --- |
| `AI_PROVIDER_ACCOUNT_REQUIRED` | 请选择供应商账户 |
| `AI_PROVIDER_SCOPE_MISMATCH` | 平台与社区账户作用域不匹配 |
| `AI_PROVIDER_COMMUNITY_MISMATCH` | 账户与 AppClient 不属于同一社区 |
| `AI_PROVIDER_SCOPE_IMMUTABLE` | 账户作用域不能修改，请新建账户 |
| `AI_PROVIDER_ACCOUNT_NOT_ACTIVE` | 上游账户未启用 |
| `AI_PROVIDER_SECRET_CONFIG_REQUIRED` | 服务端未配置加密主密钥 |
| `AI_PROVIDER_CONFIG_INVALID` | Key 无法解密或 URL 不允许 |
| `AI_MODEL_NOT_CONFIGURED` | 请配置默认模型或任务模型 |
| `AI_PROVIDER_AUTH_FAILED` | 上游 Key 错误、停用或过期 |
| `AI_PROVIDER_READ_FAILED/TIMEOUT` | 暂时无法读取余额或计量 |
| `POWER_BALANCE_INSUFFICIENT` | 上游余额不足，跳转充值链接 |
| `EXTERNAL_BILLING_MANAGED` | 外部账户不能在数据中心充值或调账 |

## 8. 上线顺序

1. 执行 `database/migrations/2026-07-18-platform-ai-account.sql`。
2. 确认云函数存在稳定的 `AI_CONFIG_ENCRYPTION_KEY` 和正确的 `AI_PROVIDER_ALLOWED_HOSTS`。
3. 发布数据中心云函数。
4. 超管后台先实现平台账户页和平台 AI 设置页。
5. 创建一个独立的平台中转站 Key，创建 `accountScope=platform` 的账户。
6. 绑定平台默认模型，执行一次 `adminCheckPlatformAiConnection`。
7. 核对 `adminGetPlatformAiSettings.externalBilling` 的余额和用量。
8. 平台稳定后，再逐社区接入；每个社区必须使用独立 Key。
9. 社区管理后台完成权限隔离、账户配置、AppClient 路由和真实余额页面。
10. 全部稳定前保留旧环境变量和 `local` 回退；不要删除旧钱包表和历史流水。

## 9. 不可违反的安全要求

- API Key 不得下发到浏览器或小程序。
- 后台不得提供“查看完整 Key”，只允许覆盖/轮换。
- `AI_CONFIG_ENCRYPTION_KEY` 不得入库，不得通过接口返回，不得随意轮换。
- Base URL 必须 HTTPS、禁止本机/内网地址，并受 `AI_PROVIDER_ALLOWED_HOSTS` 限制。
- 平台和每个社区使用独立供应商 Key；多个租户共用 Key 会导致余额、用量和审计混合。
- `/account`、`/usage` 只读；充值仍通过供应商 `rechargeUrl` 完成。
