#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/ticarettakip"
SERVICE_SRC="$APP_DIR/deploy/registry/trackify-registry.service"
NGINX_SRC="$APP_DIR/deploy/registry/registry.harunhatirkirmaz.com.conf"

echo "[1/6] Node ve nginx kontrol ediliyor"
node -v
npm -v
nginx -v

echo "[2/6] Dependency kurulumu"
cd "$APP_DIR"
npm install

echo "[3/6] systemd servisi kopyalaniyor"
sudo cp "$SERVICE_SRC" /etc/systemd/system/trackify-registry.service
sudo systemctl daemon-reload
sudo systemctl enable trackify-registry
sudo systemctl restart trackify-registry

echo "[4/6] nginx config kopyalaniyor"
sudo cp "$NGINX_SRC" /etc/nginx/sites-available/registry.harunhatirkirmaz.com
sudo ln -sf /etc/nginx/sites-available/registry.harunhatirkirmaz.com /etc/nginx/sites-enabled/registry.harunhatirkirmaz.com
sudo nginx -t
sudo systemctl reload nginx

echo "[5/6] local health kontrol"
curl -fsS http://127.0.0.1:3010/health

echo "[6/6] certbot adimini manuel tamamla"
echo "sudo certbot --nginx -d registry.harunhatirkirmaz.com"
