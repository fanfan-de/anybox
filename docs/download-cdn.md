# Anybox 国内下载镜像发布

官网默认可以从 GitHub Releases 解析安装包。为了提升中国境内下载速度，发布时同步安装包到腾讯云 COS + CDN，并让官网读取 `downloads.json` manifest。

## 腾讯云准备

1. 创建 COS bucket，例如 `anybox-downloads-1250000000`。
2. 给 bucket 配置 CDN 加速，并绑定 `download.anybox.com.cn`。
3. 在 DNS 中把 `download.anybox.com.cn` CNAME 到腾讯云 CDN 域名。
4. 给 CDN 配置 HTTPS 证书。
5. 如果 manifest 和官网不同源，给 `downloads.json` 配 CORS。官网当前可能从
   `fanfande-studio.pages.dev` 预览域名或 `anybox.com.cn` 正式域名访问下载 manifest，
   两个来源都要允许：

```text
Access-Control-Allow-Origin: https://fanfande-studio.pages.dev
Access-Control-Allow-Origin: https://anybox.com.cn
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: *
```

在腾讯云控制台里通常应配置为 CORS 规则的多个 AllowedOrigins，而不是给同一个响应手写多条
`Access-Control-Allow-Origin` 响应头。配置后用下面的命令确认响应包含
`Access-Control-Allow-Origin`：

```powershell
curl.exe -I -H "Origin: https://fanfande-studio.pages.dev" https://download.anybox.com.cn/downloads.json
curl.exe -I -H "Origin: https://anybox.com.cn" https://download.anybox.com.cn/downloads.json
```

## 本地配置

复制模板，不要提交真实密钥：

```powershell
Copy-Item scripts\downloads.env.example .env.downloads
notepad .env.downloads
```

需要填写：

```env
ANYBOX_DOWNLOAD_BASE_URL=https://download.anybox.com.cn
TENCENT_COS_SECRET_ID=...
TENCENT_COS_SECRET_KEY=...
TENCENT_COS_BUCKET=anybox-downloads-1250000000
TENCENT_COS_REGION=ap-guangzhou
```

官网生产构建已在 `packages/site/.env.production` 默认配置 manifest URL；如果部署平台覆盖了
环境变量，也需要保持这个值：

```env
VITE_DOWNLOAD_MANIFEST_URL=https://download.anybox.com.cn/downloads.json
```

## 生成 manifest

脚本会自动查找这些产物：

- `packages/desktop/dist/Anybox-*-x64.exe`
- `packages/desktop/dist/Anybox-*-arm64.dmg`
- `packages/mobile-app/build/github-release/anybox-mobile.apk`
- `packages/mobile-app/build/anybox-mobile.apk`

脚本不会自动发布 `anybox-mobile-debug.apk`。如果确实要发布调试包，必须显式传 `--mobile`。

只生成本地 manifest：

```powershell
corepack pnpm downloads:prepare
```

输出位置：

```text
packages/site/artifacts/downloads/downloads.json
```

如果产物路径不符合默认命名，可以显式传入：

```powershell
corepack pnpm downloads:prepare -- `
  --windows packages\desktop\dist\Anybox-0.1.17-x64.exe `
  --mac packages\desktop\dist\Anybox-0.1.17-arm64.dmg `
  --mobile packages\mobile-app\build\github-release\anybox-mobile.apk
```

## 上传到腾讯云 COS

```powershell
corepack pnpm downloads:publish -- --env-file .env.downloads
```

脚本会上传：

```text
releases/<version>/<installer>
downloads.json
```

安装包使用长缓存：

```text
Cache-Control: public, max-age=31536000, immutable
```

`downloads.json` 使用短缓存：

```text
Cache-Control: public, max-age=60
```

## 发布顺序

推荐流程：

1. 构建桌面端和移动端安装包。
2. 发布 GitHub Releases，保留国外和开源入口。
3. 执行 `corepack pnpm downloads:publish -- --env-file .env.downloads`。
4. 执行 `corepack pnpm site:build` 并部署官网。
5. 打开 `https://download.anybox.com.cn/downloads.json` 和官网下载按钮验证。
