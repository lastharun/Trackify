# Trackify Registry Deploy

Bu servis sadece cihaz kaydi, heartbeat ve blok/unblock icin vardir.

## 1. Gerekli env

`.env` veya systemd environment icine sunlari koy:

```env
REGISTRY_PORT=3010
REGISTRY_ADMIN_TOKEN=super-secret-admin-token
REGISTRY_TELEGRAM_BOT_TOKEN=your-bot-token
REGISTRY_TELEGRAM_DEV_ID=your-telegram-chat-id
```

## 2. Local calistirma

```bash
cd /Users/harun/ticarettakip
npm run dev:registry
```

Health check:

```bash
curl http://localhost:3010/health
```

## 3. Ornek API

Register:

```bash
curl -X POST http://localhost:3010/api/devices/register \
  -H 'Content-Type: application/json' \
  -d '{
    "device_id":"device-123",
    "device_name":"Harun MacBook",
    "platform":"macOS",
    "app_version":"2.0"
  }'
```

Admin devices:

```bash
curl 'http://localhost:3010/api/admin/devices?admin_token=YOUR_ADMIN_TOKEN'
```

Permanent block:

```bash
curl -X POST http://localhost:3010/api/admin/devices/device-123/block \
  -H 'Content-Type: application/json' \
  -H 'x-registry-admin-token: YOUR_ADMIN_TOKEN' \
  -d '{"mode":"perm","reason":"manual block"}'
```

Temporary block:

```bash
curl -X POST http://localhost:3010/api/admin/devices/device-123/block \
  -H 'Content-Type: application/json' \
  -H 'x-registry-admin-token: YOUR_ADMIN_TOKEN' \
  -d '{"mode":"temp","duration":"24h","reason":"trial expired"}'
```

Unblock:

```bash
curl -X POST http://localhost:3010/api/admin/devices/device-123/unblock \
  -H 'x-registry-admin-token: YOUR_ADMIN_TOKEN'
```

## 4. Hazir deploy dosyalari

Hazir dosyalar:

- `deploy/registry/trackify-registry.service`
- `deploy/registry/registry.harunhatirkirmaz.com.conf`
- `deploy/registry/install_registry.sh`

## 5. Subdomain onerisi

Subdomain:

`registry.harunhatirkirmaz.com`

Nginx reverse proxy:

```nginx
server {
    server_name registry.harunhatirkirmaz.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

SSL:

```bash
sudo certbot --nginx -d registry.harunhatirkirmaz.com
```

## 6. Telegram komutlari

Sadece `REGISTRY_TELEGRAM_DEV_ID` kullanabilir:

- `/devices`
- `/block <device_id> <sebep>`
- `/block_temp <device_id> 12h <sebep>`
- `/unblock <device_id>`

## 7. Admin panel

Panel:

- `https://registry.harunhatirkirmaz.com/panel/`

Panel ozellikleri:

- cihaz listesi
- online son 24 saat filtresi
- owner label
- license_expires_at
- last_ip
- event gecmisi
- block / temp block / unblock
