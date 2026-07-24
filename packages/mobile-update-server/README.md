# Anybox Mobile Update Server

This package is the read-only Expo Updates Protocol v1 gateway for Anybox
Mobile. It has no database, no administration endpoint, and no credentials that
can write to COS. The only cryptographic material available to the process is
the public OTA certificate.

## Local verification

```powershell
pnpm --filter @anybox/mobile-update-server typecheck
pnpm --filter @anybox/mobile-update-server test
```

The process needs `packages/mobile-app/credentials/ota-certificate.pem`, which is
created by `pnpm mobile:keys:init` and is safe to commit. Start it with:

```powershell
pnpm --filter @anybox/mobile-update-server build
$env:ANYBOX_OTA_CERTIFICATE_PATH = "C:\Projects\Anybox\packages\mobile-app\credentials\ota-certificate.pem"
pnpm --filter @anybox/mobile-update-server start
```

## Tencent deployment

Prerequisites:

1. `updates.anybox.com.cn` has an A record for the existing Anybox server.
2. The provider stack has created the external Docker network
   `anybox-provider_app`.
3. The public certificate exists. Never copy the private OTA key or APK
   keystore to the server.
4. The provider Caddy configuration contains the update domain reverse proxy.

Upload this monorepo without `.git`, `node_modules`, local signing environment
files, `.anybox-mobile-keys`, APKs, or private PEM/JKS files. On the server:

```bash
cd /home/ubuntu/Anybox/packages/mobile-update-server
docker compose -f docker-compose.tencent.yml config --quiet
docker compose -f docker-compose.tencent.yml up -d --build --wait
```

Smoke checks:

```bash
docker compose -f docker-compose.tencent.yml exec -T update-server \
  node -e "fetch('http://127.0.0.1:3210/livez').then(async r => { console.log(await r.text()); process.exit(r.ok ? 0 : 1) })"
curl -fsS https://updates.anybox.com.cn/livez
curl -fsS https://updates.anybox.com.cn/readyz
curl -i \
  -H 'expo-protocol-version: 1' \
  -H 'expo-platform: android' \
  -H 'expo-runtime-version: 0.3.0' \
  -H 'expo-channel-name: production' \
  https://updates.anybox.com.cn/v1/manifest
```

Before the first pointer is published, the final request should return `204`.
