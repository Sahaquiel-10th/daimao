# OPC 数据中心

这是独立于微信小程序的 PC 网页后台。它不放在 `miniprogram/` 目录下，也不参与微信小程序包构建。

## 架构

- 前端：`admin-web`，Vite + React。
- 后端：复用云函数 `daimaoBusiness`。
- 数据：仍通过 CloudBase SQL，不从网页直连数据库。
- 权限：网页请求携带 `adminWebToken`，云函数校验 `ADMIN_WEB_TOKEN` 后映射到 `users.is_admin=1` 的管理员用户。
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
VITE_CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
VITE_CLOUDBASE_FUNCTION=daimaoBusiness
VITE_CLOUDBASE_REGION=ap-shanghai
VITE_CLOUDBASE_ACCESS_KEY=可选，CloudBase Publishable Key
VITE_ADMIN_WEB_TOKEN=与云函数 ADMIN_WEB_TOKEN 相同
VITE_ADMIN_USE_MOCK=false
```

如果 IP 访问时 CloudBase 匿名登录报 `Failed to fetch`，可以在 CloudBase 控制台的 `环境管理 -> API Key 配置` 创建或复制 `Publishable Key`，在登录页的 `CloudBase Publishable Key` 填入。它是浏览器侧公开访问 Key，不等同于后台访问令牌；真正的管理权限仍由云函数环境变量 `ADMIN_WEB_TOKEN` 校验。

只看界面可设为：

```text
VITE_ADMIN_USE_MOCK=true
```

## 当前覆盖

- 登录/权限校验入口
- 用户列表、启用/禁用、管理员开关
- 项目列表、状态/可见性/推荐权重/基础信息维护
- 活动列表、新建活动、编辑活动
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
