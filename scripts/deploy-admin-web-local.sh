#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/admin-web"
DEPLOY_BASE="${DEPLOY_BASE:-/var/www/daimao-admin}"
RELEASE_ID="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${DEPLOY_BASE}/releases/${RELEASE_ID}"

cd "$APP_DIR"
npm ci
npm run build

mkdir -p "$RELEASE_DIR"
rsync -a --delete "${APP_DIR}/dist/" "${RELEASE_DIR}/"
ln -sfnT "$RELEASE_DIR" "${DEPLOY_BASE}/current"

if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t
  sudo systemctl reload nginx
fi

echo "Deployed admin-web to ${RELEASE_DIR}"
