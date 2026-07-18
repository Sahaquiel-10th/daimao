# OPC 数据中心

这是独立于微信小程序的 PC 网页后台。它不放在 `miniprogram/` 目录下，也不参与微信小程序包构建。

## 架构

- 前端：`admin-web`，Vite + React。
- 后端：同源后台代理调用云函数 `daimaoBusiness`。
- 数据：仍通过 CloudBase SQL，不从网页直连数据库。
- 权限：浏览器只持有代理签发的短期会话；代理按 `admin_accounts` 和 `admin_account_communities` 校验权限，再在服务端注入 `ADMIN_WEB_TOKEN`。
- 密钥：`ADMIN_WEB_TOKEN`、供应商 API Key 和 `AI_CONFIG_ENCRYPTION_KEY` 都不能进入浏览器环境变量或接口响应。
- 审计：用户、项目、活动等写操作会写入 `admin_logs`。

## 云函数环境变量

在 `daimaoBusiness` 云函数中配置：

```text
BUSINESS_DB_DRIVER=cloudbase_rdb
ADMIN_WEB_TOKEN=一段足够长的随机字符串
ADMIN_WEB_OPENID=可选，指定某个 is_admin=1 的 openid
```

如果不配置 `ADMIN_WEB_OPENID`，云函数会使用第一个 `status='active' AND is_admin=1` 的用户作为后台操作者。

## 本地运行

```bash
cd admin-web
cp .env.example .env.local
npm install
npm run dev
```

`.env.local` 示例：

```text
VITE_ADMIN_API_URL=/api/admin
VITE_ADMIN_USE_MOCK=false
```

生产环境必须让 `/api/login`、`/api/admin` 和 `/api/upload` 指向 `server/proxy.cjs`（或等价的可信服务端代理）。不要在 Vite 环境变量、网页源码或 localStorage 中配置 `ADMIN_WEB_TOKEN`。

只看界面可设为：

```text
VITE_ADMIN_USE_MOCK=true
```

## 当前覆盖

- 登录/权限校验入口
- 用户列表、启用/禁用、管理员开关
- 项目列表、状态/可见性/推荐权重/基础信息维护
- 活动列表、新建活动、编辑活动
- 平台 / 社区 AI 供应商账户、路由、真实余额与计量
- 旧本地钱包与外部计费隔离展示（调账仅允许旧本地账户）
- RAG source 和索引任务查看

## 与小程序的隔离方式

小程序仍使用 `project.config.json` 中的：

```json
{
  "miniprogramRoot": "miniprogram/",
  "cloudfunctionRoot": "cloudfunctions/"
}
```

`admin-web` 是单独的 Web 构建产物，不会改变小程序页面、路由、体积和发布流程。
