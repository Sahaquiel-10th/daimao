# 呆猫管理后台部署

目标：先用服务器公网 IP + 独立端口访问，避免影响同一服务器上已有项目。后续绑定域名时再调整 Nginx。

## 1. 云函数配置

环境变量配置在云函数 `daimaoBusiness`，不是 `daimaoTagFunctions`。

```text
BUSINESS_DB_DRIVER=cloudbase_rdb
ADMIN_WEB_TOKEN=一段足够长的随机字符串
ADMIN_WEB_OPENID=可选，指定某个 is_admin=1 的 openid
```

`ADMIN_WEB_TOKEN` 不要写入 `admin-web/.env`。前端页面会让管理员手动输入 token。

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
ADMIN_WEB_USERNAME=admin
ADMIN_WEB_PASSWORD=后台登录密码
ADMIN_SESSION_SECRET=一段足够长的随机字符串
```

`TENCENTCLOUD_SECRETID` 和 `TENCENTCLOUD_SECRETKEY` 来自腾讯云访问管理 CAM。建议创建只用于部署/CloudBase 调用的子用户密钥，不要把主账号密钥放进代码仓库。

网页登录使用 `ADMIN_WEB_USERNAME` 和 `ADMIN_WEB_PASSWORD`。`ADMIN_WEB_TOKEN` 只保存在服务器上，用来让代理服务调用 `daimaoBusiness`，不要发给普通后台使用者。

## 3. 服务器一次性初始化

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

## 4. 手动部署一次

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

## 5. GitHub Actions 自动部署

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

自动部署会使用这个 SSH key 登录服务器，然后执行：

```bash
sudo -H bash -lc 'cd /root/daimao && git pull --ff-only origin main && bash scripts/deploy-admin-web-local.sh'
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

## 6. IP 访问和多项目

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
