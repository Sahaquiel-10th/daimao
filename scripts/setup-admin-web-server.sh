#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-daimao-admin}"
DEPLOY_BASE="${DEPLOY_BASE:-/var/www/${APP_NAME}}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
NGINX_CONF_SOURCE="${NGINX_CONF_SOURCE:-deploy/nginx/daimao-admin.conf}"
NGINX_CONF_TARGET="/etc/nginx/sites-available/${APP_NAME}"

if [[ ! -f "$NGINX_CONF_SOURCE" ]]; then
  echo "Missing nginx config: $NGINX_CONF_SOURCE"
  echo "Run this script from the repository root."
  exit 1
fi

sudo apt update
sudo apt install -y nginx git curl ca-certificates

sudo mkdir -p "${DEPLOY_BASE}/releases" "${DEPLOY_BASE}/shared"
sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_BASE"

mkdir -p "${DEPLOY_BASE}/current"
echo "<!doctype html><title>daimao-admin</title><p>daimao-admin is ready.</p>" > "${DEPLOY_BASE}/current/index.html"

sudo cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
sudo ln -sfn "$NGINX_CONF_TARGET" "/etc/nginx/sites-enabled/${APP_NAME}"
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo "Nginx is serving ${DEPLOY_BASE}/current on port 8088."
