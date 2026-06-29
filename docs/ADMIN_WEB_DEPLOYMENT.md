# 呆猫管理后台部署

目标：先用服务器公网 IP + 独立端口访问，避免影响同一服务器上已有项目。后续绑定域名时再调整 Nginx。

## 1. 云函数配置

环境变量配置在云函数 `daimaoBusiness`，不是 `daimaoTagFunctions`。

```text
BUSINESS_DB_DRIVER=cloudbase_rdb
ADMIN_WEB_TOKEN=一段足够长的随机字符串
ADMIN_WEB_OPENID=可选，指定某个 is_admin=1 的 openid
```

`ADMIN_WEB_TOKEN` 不要写入 `admin-web/.env`，也不要交给普通管理员。它是服务器代理调用云函数用的内部令牌。

第一次上线前，还需要在 CloudBase SQL 编辑器执行：

```text
database/migrations/2026-06-29-admin-accounts.sql
```

这个迁移会创建 `admin_accounts` 和 `admin_account_communities`。社区管理员账号以后从超管后台的「管理员」模块维护，不再靠环境变量。

## 2. 服务器代理配置

管理后台默认不再让浏览器直接调用 CloudBase。浏览器请求同源接口 `/api/admin`，服务器上的 `daimao-admin-api` 代理服务再调用云函数 `daimaoBusiness`。

在服务器配置 `/etc/daimao-admin.env`：

```text
CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
CLOUDBASE_REGION=ap-shanghai
CLOUDBASE_FUNCTION=daimaoBusiness
TENCENTCLOUD_SECRETID=腾讯云访问密钥 SecretId
TENCENTCLOUD_SECRETKEY=腾讯云访问密钥 SecretKey
ADMIN_WEB_TOKEN=与 daimaoBusiness 云函数环境变量相同的后台令牌
ADMIN_SUPER_USERNAME=superadmin
ADMIN_SUPER_PASSWORD=超级管理员登录密码
ADMIN_SESSION_SECRET=一段足够长的随机字符串
```

`TENCENTCLOUD_SECRETID` 和 `TENCENTCLOUD_SECRETKEY` 来自腾讯云访问管理 CAM。建议创建只用于部署/CloudBase 调用的子用户密钥，不要把主账号密钥放进代码仓库。

网页登录分两类账号：

- 超级管理员：`ADMIN_SUPER_USERNAME` / `ADMIN_SUPER_PASSWORD`，配置在服务器 `/etc/daimao-admin.env`，用于启动后台、维护社区和管理员账号。
- 社区管理员：在超管后台「管理员」模块新增/编辑/停用，密码以 PBKDF2-SHA256 加盐哈希保存在 CloudBase SQL 的 `admin_accounts`，社区绑定保存在 `admin_account_communities`。

兼容旧配置：如果只配置了 `ADMIN_WEB_USERNAME` / `ADMIN_WEB_PASSWORD`，代理服务会把它当作超级管理员账号。`ADMIN_COMMUNITY_ACCOUNTS` 也仍可作为旧环境的临时兜底，但正式运营不要再用它维护社区管理员。

`ADMIN_WEB_TOKEN` 只保存在服务器上，用来让代理服务调用 `daimaoBusiness`，不要发给普通后台使用者。

如果只想临时配置一个旧版社区管理员，也可以不用 JSON，改用：

```text
ADMIN_COMMUNITY_USERNAME=community_admin
ADMIN_COMMUNITY_PASSWORD=社区管理员登录密码
ADMIN_COMMUNITY_IDS=1,2
```

## 3. 图片上传链路

管理后台上传头像、社区图、项目封面、活动封面时，链路是：

```text
浏览器选择文件
-> POST /api/upload 原始二进制
-> daimao-admin-api 代理校验会话和大小
-> CloudBase Storage uploadFile
-> 返回 cloud://... fileID
-> 保存到 CloudBase SQL 对应字段
```

当前限制：

- 前端限制单文件不超过 `8MB`。
- 代理服务限制单文件不超过 `8MB`。
- Nginx 配置 `client_max_body_size 10m;`。
- 支持 `png`、`jpg`、`jpeg`、`webp`。

如果看到 `413 Request Entity Too Large`，通常是服务器还没应用新的 Nginx 配置。重新部署后执行：

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart daimao-admin-api
```

## 4. 服务器一次性初始化

登录轻量应用服务器：

```bash
ssh ubuntu@服务器公网IP
```

安装 git 后拉仓库：

```bash
sudo apt update
sudo apt install -y git
git clone git@github.com:Sahaquiel-10th/daimao.git
cd daimao
bash scripts/setup-admin-web-server.sh
```

初始化完成后，访问：

```text
http://服务器公网IP:8088
```

第一次看到 `daimao-admin is ready.` 是正常的，等自动部署跑完后会替换成正式后台页面。

腾讯云安全组需要放行 TCP `8088` 端口。

## 5. 手动部署一次

如果暂时不接 GitHub Actions，可以在服务器仓库目录执行：

```bash
cd ~/daimao
git pull
bash scripts/deploy-admin-web-local.sh
```

检查代理服务：

```bash
sudo systemctl status daimao-admin-api --no-pager
curl -sS http://127.0.0.1:8090/health
```

## 6. GitHub Actions 自动部署

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 添加：

```text
DEPLOY_HOST=124.222.88.31
DEPLOY_USER=ubuntu
DEPLOY_SSH_KEY=部署私钥内容
```

推荐创建一把只用于部署的 SSH key：

```bash
ssh-keygen -t ed25519 -C "daimao-admin-deploy" -f ~/.ssh/daimao_admin_deploy
```

把公钥加入服务器：

```bash
ssh-copy-id -i ~/.ssh/daimao_admin_deploy.pub ubuntu@服务器公网IP
```

把私钥 `~/.ssh/daimao_admin_deploy` 的完整内容填进 GitHub Secret `DEPLOY_SSH_KEY`。

自动部署会先在 GitHub Actions 里构建校验，再把 `admin-web`、部署脚本和 Nginx/systemd 配置打包传到服务器，最后执行：

```bash
sudo -H bash -lc 'cd /root/daimao && tar -xzf /tmp/daimao-admin-source.tgz -C /root/daimao && bash scripts/deploy-admin-web-local.sh'
```

所以服务器上的 `ubuntu` 用户需要能免密 `sudo`，腾讯云 Ubuntu 镜像默认通常满足这一点。

以后推送到 `main` 分支且改动涉及以下路径时，会自动构建并发布：

```text
admin-web/**
deploy/nginx/daimao-admin.conf
deploy/systemd/daimao-admin-api.service
scripts/deploy-admin-web-local.sh
scripts/setup-admin-web-server.sh
```

## 7. IP 访问和多项目

没有域名时，公网 IP 就是入口：

```text
http://服务器公网IP:8088
```

一台服务器通常只有一个公网 IP。多个项目可以用端口、路径或域名区分：

```text
http://服务器公网IP
http://服务器公网IP:8080
http://服务器公网IP/admin
https://admin.example.com
```

多个项目共享 CPU、内存、磁盘和带宽。配置正确时可以共存；某个项目占满资源时会影响其他项目。
