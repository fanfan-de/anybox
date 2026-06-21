# EdgeOne Pages Migration

This guide moves the public Anybox website from the current CVM-hosted Caddy static directory to Tencent EdgeOne Pages/Makers.

The migration only covers the Vite website in `packages/site`. It does not move `anyboxProvider`, PostgreSQL, Redis, the mobile bridge, or the download mirror.

## Current State

- Website source: `packages/site`
- Local build output: `packages/site/dist`
- Current production static directory: `/home/ubuntu/anybox-site/dist`
- Current production server: Tencent CVM `129.211.1.144`
- Current Caddy behavior:
  - static website paths serve `/srv/anybox-site`
  - `/api`, `/v1`, `/health`, `/livez`, `/readyz`, `/metrics` proxy to `api:3000`
  - `/api/mobile` proxies to the host mobile bridge on port `4896`
  - `provider.anybox.com.cn` proxies to `api:3000`

## EdgeOne Project Settings

Import the GitHub repository:

```text
https://github.com/fanfan-de/anybox
```

Use the production branch:

```text
master
```

The repository contains `edgeone.json`, so EdgeOne can read these build settings from the repo:

```text
Install command: corepack pnpm install --filter anybox-site --no-frozen-lockfile
Build command:   corepack pnpm --filter anybox-site build
Output dir:      packages/site/dist
Node version:    22.17.1
```

If the console does not pick up `edgeone.json`, enter the same values manually in Project Settings -> Build and Deployment Configuration.

## Environment Variables

`packages/site/.env.production` already sets the production download manifest:

```env
VITE_DOWNLOAD_MANIFEST_URL=https://download.anybox.com.cn/downloads.json
```

Set these in EdgeOne project environment variables if you need to override the repo default:

```env
VITE_GITHUB_USERNAME=fanfan-de
```

`VITE_DOWNLOAD_MANIFEST_URL` keeps the China download button using the existing Tencent COS/CDN mirror. Without it, the site falls back to GitHub Releases.
Also make sure `https://download.anybox.com.cn/downloads.json` returns CORS headers for the active site domain, or the browser will reject the manifest and the button will still fall back.

## First Deployment

1. Create the EdgeOne project by importing the GitHub repo.
2. Let EdgeOne run the first build.
3. Open the EdgeOne preview URL and verify:
   - home page renders
   - `/docs/` renders
   - `/privacy/` renders
   - download buttons resolve through `download.anybox.com.cn`

Local parity check:

```powershell
corepack pnpm site:build
```

## Domain Cutover

Use a staged domain first, for example:

```text
site.anybox.com.cn
```

After the staged domain is verified, add the production domain:

```text
anybox.com.cn
```

Then update DNS from the current CVM A record to the CNAME target provided by EdgeOne.

Do not remove the CVM website directory immediately. Keep `/home/ubuntu/anybox-site/dist` for at least 24 hours as a rollback target.

## API Route Warning

Today `anybox.com.cn` also carries backend routes through Caddy. If the apex domain is moved to EdgeOne Pages, these paths will no longer hit the CVM automatically:

```text
/api
/api/*
/api/mobile
/v1
/v1/*
/health
/livez
/readyz
/metrics
```

Before moving `anybox.com.cn`, choose one of these approaches:

1. Keep API consumers on `provider.anybox.com.cn` and use EdgeOne only for the public website.
2. Configure EdgeOne rules to proxy backend paths to the CVM or to `provider.anybox.com.cn`, then verify every route.
3. Keep `anybox.com.cn` on the CVM and deploy EdgeOne on `www.anybox.com.cn` or another website-only domain.

For the current `packages/site` website, the static pages do not require same-domain `/api` routes. The risk is external clients or mobile bridge flows that may still depend on `https://anybox.com.cn/api...`.

## Rollback

If production traffic has issues after DNS cutover:

1. Change `anybox.com.cn` DNS back to A record `129.211.1.144`.
2. Wait for DNS propagation.
3. Confirm the CVM Caddy route returns the old static site:

```powershell
curl.exe --resolve anybox.com.cn:443:129.211.1.144 -I https://anybox.com.cn/
```

The CVM deployment does not need to be restarted for a DNS rollback.
