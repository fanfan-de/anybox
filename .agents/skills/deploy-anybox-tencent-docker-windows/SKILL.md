---
name: deploy-anybox-tencent-docker-windows
description: '将本地 C:\Projects\anyboxProvider 项目上传到腾讯云服务器 129.211.1.144，并以 ubuntu 用户部署到 /home/ubuntu/ 下，使用仓库内的 Docker Compose 腾讯云部署流程。适用于用户要打包、上传、配置、部署、验证或更新这个特定 anyboxProvider 项目。'
---

# 腾讯云 Docker 部署 anyboxProvider

## 概览

这个 skill 固定用于当前项目的腾讯云部署流程：

- 本地项目目录：`C:\Projects\anyboxProvider`
- 服务器 SSH 别名：`anybox-server`
- 服务器实际地址：`ubuntu@129.211.1.144`
- 服务器部署根目录：`/home/ubuntu/`
- 服务器项目目录：`/home/ubuntu/anyboxProvider`
- 部署方式：`docker-compose.tencent.yml` 和 `scripts/tencent-deploy.sh`

采用简单优先策略：本地维护并上传 `.env.tencent`。不要上传 `.env`、`node_modules`、`dist` 或 `.git`。

## 部署前检查

先确认服务器上的 Docker 可用：

```bash
ssh anybox-server 'docker --version && docker compose version && docker ps'
```

如果本地 shell 没有配置好 SSH，就让用户在 VS Code 远程终端里手动执行上面的检查命令，不要临时改用其他服务器或其他部署目标。

## 打包并上传

在本地 Windows PowerShell 中执行：

```powershell
cd C:\Projects

tar -czf anyboxProvider.tar.gz `
  --exclude=anyboxProvider/node_modules `
  --exclude=anyboxProvider/dist `
  --exclude=anyboxProvider/.env `
  --exclude=anyboxProvider/.git `
  anyboxProvider

scp .\anyboxProvider.tar.gz anybox-server:/home/ubuntu/
```

如果本地已有旧的压缩包，只能删除 `C:\Projects\anyboxProvider.tar.gz`，不要删除源项目文件。

## 在服务器解压

在腾讯云服务器上执行：

```bash
cd /home/ubuntu

if [ -d anyboxProvider ]; then
  mv anyboxProvider "anyboxProvider.backup.$(date +%Y%m%d-%H%M%S)"
fi

tar -xzf anyboxProvider.tar.gz
cd anyboxProvider
```

如果用户临时决定不上传 `.env.tencent`，更新部署时需要从旧备份复制回来：

```bash
cp ../anyboxProvider.backup.*/.env.tencent .env.tencent 2>/dev/null || true
```

如果存在多个备份目录，显式选择最新的备份目录，不要依赖通配符。

## 配置生产环境变量

简单优先时，先在本地 `C:\Projects\anyboxProvider\.env.tencent` 填好生产配置，然后随压缩包一起上传。若本地还没有该文件，先在本地复制模板：

```powershell
cd C:\Projects\anyboxProvider
Copy-Item .env.tencent.example .env.tencent
notepad .env.tencent
```

如果要在服务器上直接编辑，也可以执行：

```bash
cp .env.tencent.example .env.tencent
nano .env.tencent
```

至少替换这些值：

```env
APP_DOMAIN=你的域名
APP_BASE_URL=https://你的域名

POSTGRES_PASSWORD=<随机 hex>
DATABASE_URL=postgres://anybox:<同一个 PostgreSQL 密码>@postgres:5432/anybox_provider

REDIS_PASSWORD=<随机 hex>
REDIS_URL=redis://:<同一个 Redis 密码>@redis:6379

SESSION_SECRET=<随机 hex>
ENCRYPTION_KEY=<随机 hex，必须稳定保存和备份>
METRICS_TOKEN=<随机 hex>
ADMIN_TOKEN=<随机 hex>

ADMIN_BOOTSTRAP_EMAIL=<管理员邮箱>
ADMIN_BOOTSTRAP_PASSWORD=<初始管理员密码>

DEFAULT_PROVIDER_API_KEY=<上游模型供应商 API Key>
```

生成随机值：

```bash
openssl rand -hex 32
```

生产环境不能保留 `change_me` 或 `replace_me` 这类占位值。`ENCRYPTION_KEY` 必须长期保存；丢失后，数据库里已加密的供应商凭据将无法解密。`.env.tencent` 包含生产密钥，不能提交到 Git，也不要把压缩包发给别人。

## 执行部署

在 `/home/ubuntu/anyboxProvider` 中执行：

```bash
chmod +x scripts/tencent-deploy.sh
./scripts/tencent-deploy.sh
```

首次部署时，执行一次初始化管理员：

```bash
docker compose -f docker-compose.tencent.yml --env-file .env.tencent --profile tools run --rm seed
```

初始化完成后，清空 bootstrap 密码并重启运行服务：

```bash
nano .env.tencent
docker compose -f docker-compose.tencent.yml --env-file .env.tencent up -d api worker
```

重启前把这一项改为空：

```env
ADMIN_BOOTSTRAP_PASSWORD=
```

## 验证部署

检查容器和接口：

```bash
docker compose -f docker-compose.tencent.yml --env-file .env.tencent ps
curl -fsS http://127.0.0.1/livez
curl -fsS https://$APP_DOMAIN/livez
curl -fsS https://$APP_DOMAIN/readyz
```

如果验证失败，查看日志：

```bash
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 api
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 caddy
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 worker
```

同时确认腾讯云安全组已放行 TCP `80` 和 `443`，域名 A 记录已经指向 `129.211.1.144`。

## 更新已有部署

当本地 `C:\Projects\anyboxProvider` 有代码改动，要同步到服务器时，按这个标准流程执行。默认采用简单优先策略：本地 `.env.tencent` 是生产配置的来源，会随压缩包一起覆盖服务器上的 `.env.tencent`。

### 1. 本地确认

在本地 PowerShell 中确认 `.env.tencent` 存在，不要把 `.env` 当作生产配置上传：

```powershell
Test-Path C:\Projects\anyboxProvider\.env.tencent
```

如果返回 `False`，先创建并填写：

```powershell
cd C:\Projects\anyboxProvider
Copy-Item .env.tencent.example .env.tencent
notepad .env.tencent
```

### 2. 重新打包

在本地 PowerShell 中执行：

```powershell
cd C:\Projects

if (Test-Path .\anyboxProvider.tar.gz) {
  Remove-Item .\anyboxProvider.tar.gz
}

tar -czf anyboxProvider.tar.gz `
  --exclude=anyboxProvider/node_modules `
  --exclude=anyboxProvider/dist `
  --exclude=anyboxProvider/.env `
  --exclude=anyboxProvider/.git `
  anyboxProvider
```

上传前可以确认压缩包已生成：

```powershell
Get-Item C:\Projects\anyboxProvider.tar.gz
```

### 3. 上传压缩包

```powershell
scp C:\Projects\anyboxProvider.tar.gz anybox-server:/home/ubuntu/
```

上传后可远程确认：

```powershell
ssh anybox-server "ls -lh /home/ubuntu/anyboxProvider.tar.gz"
```

### 4. 服务器备份旧项目并解压新版本

在服务器执行：

```bash
cd /home/ubuntu

if [ -d anyboxProvider ]; then
  mv anyboxProvider "anyboxProvider.backup.$(date +%Y%m%d-%H%M%S)"
fi

tar -xzf anyboxProvider.tar.gz
cd anyboxProvider
```

不要删除 Docker volume。PostgreSQL 和 Redis 的数据保存在 Docker volume 里，更新代码时只替换项目目录。

如果这次不想用本地 `.env.tencent` 覆盖服务器配置，需要在本地打包时额外排除 `.env.tencent`，然后从最新备份恢复：

```bash
cp /home/ubuntu/anyboxProvider.backup.YYYYMMDD-HHMMSS/.env.tencent /home/ubuntu/anyboxProvider/.env.tencent
```

### 5. 执行部署脚本

在服务器执行：

```bash
cd /home/ubuntu/anyboxProvider
./scripts/tencent-deploy.sh
```

脚本会重新构建镜像、启动数据库和 Redis、运行迁移，并启动 `api`、`worker`、`caddy`。

### 6. 验证

```bash
docker compose -f docker-compose.tencent.yml --env-file .env.tencent ps
curl -fsS http://127.0.0.1/livez
curl -fsS http://127.0.0.1/readyz
```

如果域名已经解析并开放 `80`/`443`，再验证公网 HTTPS：

```bash
curl -fsS https://你的域名/livez
curl -fsS https://你的域名/readyz
```

失败时先看日志：

```bash
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 api
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 worker
docker compose -f docker-compose.tencent.yml --env-file .env.tencent logs --tail=200 caddy
```

### 7. 什么时候需要 seed

更新代码时通常不要再运行 `seed`。`seed` 只在首次初始化管理员账号和演示数据时运行一次。重复运行可能创建额外 demo workspace。
