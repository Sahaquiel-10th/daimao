#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-daimao-admin}"
DEPLOY_BASE="${DEPLOY_BASE:-/var/www/${APP_NAME}}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
NGINX_CONF_SOURCE="${NGINX_CONF_SOURCE:-deploy/nginx/daimao-admin.conf}"
NGINX_CONF_TARGET="/etc/nginx/sites-available/${APP_NAME}"
ENV_FILE="/etc/daimao-admin.env"

if [[ ! -f "$NGINX_CONF_SOURCE" ]]; then
  echo "Missing nginx config: $NGINX_CONF_SOURCE"
  echo "Run this script from the repository root."
  exit 1
fi

sudo apt update
sudo apt install -y nginx git curl ca-certificates

sudo mkdir -p "${DEPLOY_BASE}/releases" "${DEPLOY_BASE}/shared"
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_BASE"

if [[ ! -f "$ENV_FILE" ]]; then
  sudo tee "$ENV_FILE" >/dev/null <<'EOF'
CLOUDBASE_ENV=cloud1-8gocbg40af3862ce
CLOUDBASE_REGION=ap-shanghai
CLOUDBASE_FUNCTION=daimaoBusiness
TENCENTCLOUD_SECRETID=
TENCENTCLOUD_SECRETKEY=
ADMIN_WEB_TOKEN=
ADMIN_WEB_USERNAME=admin
ADMIN_WEB_PASSWORD=
ADMIN_SESSION_SECRET=
EOF
  sudo chmod 600 "$ENV_FILE"
  echo "Created ${ENV_FILE}. Fill TENCENTCLOUD_SECRETID and TENCENTCLOUD_SECRETKEY before using the admin API proxy."
fi

READY_RELEASE="${DEPLOY_BASE}/releases/ready"
rm -rf "$READY_RELEASE"
mkdir -p "$READY_RELEASE"
echo "<!doctype html><title>daimao-admin</title><p>daimao-admin is ready.</p>" > "${READY_RELEASE}/index.html"
rm -rf "${DEPLOY_BASE}/current"
ln -sfnT "$READY_RELEASE" "${DEPLOY_BASE}/current"

sudo cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
sudo ln -sfn "$NGINX_CONF_TARGET" "/etc/nginx/sites-enabled/${APP_NAME}"
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo "Nginx is serving ${DEPLOY_BASE}/current on port 8088."
