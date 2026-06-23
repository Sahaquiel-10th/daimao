#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/admin-web"
DEPLOY_BASE="${DEPLOY_BASE:-/var/www/daimao-admin}"
RELEASE_ID="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${DEPLOY_BASE}/releases/${RELEASE_ID}"
NGINX_CONF_SOURCE="${ROOT_DIR}/deploy/nginx/daimao-admin.conf"
NGINX_CONF_TARGET="/etc/nginx/sites-available/daimao-admin"
SYSTEMD_SERVICE_SOURCE="${ROOT_DIR}/deploy/systemd/daimao-admin-api.service"
SYSTEMD_SERVICE_TARGET="/etc/systemd/system/daimao-admin-api.service"

cd "$APP_DIR"
npm ci
npm run build

mkdir -p "$RELEASE_DIR"
rsync -a --delete "${APP_DIR}/dist/" "${RELEASE_DIR}/"
ln -sfnT "$RELEASE_DIR" "${DEPLOY_BASE}/current"

if [[ -f "$SYSTEMD_SERVICE_SOURCE" ]]; then
  sudo cp "$SYSTEMD_SERVICE_SOURCE" "$SYSTEMD_SERVICE_TARGET"
  sudo systemctl daemon-reload
  sudo systemctl enable daimao-admin-api
  sudo systemctl restart daimao-admin-api
fi

if command -v nginx >/dev/null 2>&1; then
  if [[ -f "$NGINX_CONF_SOURCE" ]]; then
    sudo cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
  fi
  sudo nginx -t
  sudo systemctl reload nginx
fi

echo "Deployed admin-web to ${RELEASE_DIR}"
