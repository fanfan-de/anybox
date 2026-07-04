---
name: deploy-anybox-tencent-server
description: "在腾讯云服务器 anybox-server 上执行 anyboxProvider 的服务器侧 Docker Compose 部署、故障处理、首次 seed 和健康检查。用于代码包或项目目录已经在 /home/ubuntu 后，需要备份旧目录、解压/切换新版本、保留远端 .env.tencent、运行 scripts/tencent-deploy.sh、处理 nginx 端口占用、清空 ADMIN_BOOTSTRAP_PASSWORD、验证 anybox.com.cn 的部署场景；不要用于本地打包、scp 上传或创建发布包。"
---

# Anybox 腾讯云服务器侧部署

## 范围

只处理服务器侧流程。不要执行本地打包、`scp` 上传、生成 `anyboxProvider.tar.gz`，也不要用本地 `.env.tencent` 覆盖服务器生产配置。

固定环境：

- SSH 别名：`anybox-server`
- 服务器用户：`ubuntu`
- 服务器项目目录：`/home/ubuntu/anyboxProvider`
- 可选已上传压缩包：`/home/ubuntu/anyboxProvider.tar.gz`
- Compose 文件：`docker-compose.tencent.yml`
- 部署脚本：`scripts/tencent-deploy.sh`
- 生产域名：`anybox.com.cn`

## 安全规则

- 不要删除 Docker volumes，不要运行 `docker compose down -v`。
- 默认保留服务器上的 `.env.tencent`，只做脱敏检查，不输出密钥。
- `ADMIN_BOOTSTRAP_PASSWORD` 只允许首次 seed 前临时设置；seed 完成后必须清空。
- 重复运行 `seed` 会创建新的 Demo Workspace；只在首次初始化管理员或用户明确要求时运行。
- 停止宿主机 `nginx` 前先确认它是否是旧的 anyboxProvider 反代，不要盲停无关站点。

## 部署前检查

确认 SSH、Docker、Compose 可用：

```powershell
ssh anybox-server "hostname; docker --version; docker compose version"
```

检查当前容器、端口和旧 nginx：

```powershell
ssh anybox-server "cd /home/ubuntu/anyboxProvider 2>/dev/null && docker compose -f docker-compose.tencent.yml --env-file .env.tencent ps || true; sudo ss -ltnp '( sport = :80 or sport = :443 )' || true; systemctl is-active nginx || true"
```

检查服务器 `.env.tencent` 是否存在，并只输出关键项状态：

```powershell
ssh anybox-server 'cd /home/ubuntu/anyboxProvider && test -f .env.tencent && echo env_exists || echo env_missing'
```

## 备份并切换新版本

如果 `/home/ubuntu/anyboxProvider.tar.gz` 已经在服务器上，按这个流程切换项目目录，并从旧目录恢复生产 `.env.tencent`：

```powershell
ssh anybox-server 'set -eu
cd /home/ubuntu
backup=""
if [ -d anyboxProvider ]; then
  backup="anyboxProvider.backup.$(date +%Y%m%d-%H%M%S)"
  mv anyboxProvider "$backup"
  echo "BACKUP=$backup"
fi
tar -xzf anyboxProvider.tar.gz
if [ -n "$backup" ] && [ -f "$backup/.env.tencent" ]; then
  cp "$backup/.env.tencent" anyboxProvider/.env.tencent
  echo "ENV_RESTORED_FROM=$backup/.env.tencent"
fi
cd anyboxProvider
chmod +x scripts/tencent-deploy.sh
ls -l docker-compose.tencent.yml scripts/tencent-deploy.sh .env.tencent
'
```

如果没有压缩包但项目目录已经是目标版本，跳过解压，只执行：

```powershell
ssh anybox-server "cd /home/ubuntu/anyboxProvider && chmod +x scripts/tencent-deploy.sh"
```

## 运行部署

执行部署脚本：

```powershell
ssh anybox-server "cd /home/ubuntu/anyboxProvider && ./scripts/tencent-deploy.sh"
```

脚本会构建镜像、启动 Postgres/Redis、运行迁移，并启动 `api`、`worker`、`caddy`。

## 常见阻塞处理

### 80/443 被 nginx 占用

先确认 nginx 配置是不是旧 anyboxProvider 反代：

```powershell
ssh anybox-server "sudo nginx -T 2>/dev/null | egrep -n 'server_name|listen|proxy_pass|anybox|3000' || true"
```

如果确认是旧 anyboxProvider 反代，停用 nginx，让 Caddy 接管 80/443：

```powershell
ssh anybox-server "sudo systemctl stop nginx && sudo systemctl disable nginx"
ssh anybox-server "cd /home/ubuntu/anyboxProvider && docker compose -f docker-compose.tencent.yml --env-file .env.tencent up -d --force-recreate api worker caddy"
```

### ADMIN_BOOTSTRAP_PASSWORD 是占位值

如果 `api` 或 `worker` 日志报：

```text
ADMIN_BOOTSTRAP_PASSWORD must not use a placeholder value in production
```

普通生产运行时直接清空它并重启服务：

```powershell
ssh anybox-server "cd /home/ubuntu/anyboxProvider && sed -i 's/^ADMIN_BOOTSTRAP_PASSWORD=.*/ADMIN_BOOTSTRAP_PASSWORD=/' .env.tencent && docker compose -f docker-compose.tencent.yml --env-file .env.tencent up -d --force-recreate api worker"
```

如果这是首次部署且需要创建管理员，先生成一次性强密码，运行 seed，记录管理员密码给用户，然后立刻清空：

```powershell
ssh anybox-server 'cd /home/ubuntu/anyboxProvider
bootstrap="$(openssl rand -hex 16)"
sed -i "s/^ADMIN_BOOTSTRAP_PASSWORD=.*/ADMIN_BOOTSTRAP_PASSWORD=$bootstrap/" .env.tencent
docker compose -f docker-compose.tencent.yml --env-file .env.tencent --profile tools run --rm seed
sed -i "s/^ADMIN_BOOTSTRAP_PASSWORD=.*/ADMIN_BOOTSTRAP_PASSWORD=/" .env.tencent
docker compose -f docker-compose.tencent.yml --env-file .env.tencent up -d --force-recreate api worker
echo "GENERATED_ADMIN_BOOTSTRAP_PASSWORD=$bootstrap"
'
```

不要把数据库、Redis、Session、Encryption、Provider API Key 等密钥输出到对话里。

## 验证

检查容器：

```powershell
ssh anybox-server "cd /home/ubuntu/anyboxProvider && docker compose -f docker-compose.tencent.yml --env-file .env.tencent ps"
```

检查健康状态：

```powershell
ssh anybox-server "printf 'https_livez='; curl -sS -o /tmp/livez.out -w '%{http_code}' https://anybox.com.cn/livez; echo; printf 'https_readyz='; curl -sS -o /tmp/readyz.out -w '%{http_code}' https://anybox.com.cn/readyz; echo; printf 'https_home='; curl -sS -o /tmp/home.out -w '%{http_code}' https://anybox.com.cn/; echo"
```

从本地绕过 DNS/代理验证公网 HTTPS：

```powershell
curl.exe --resolve anybox.com.cn:443:129.211.1.144 -sS -o NUL -w "local_https_livez=%{http_code}`n" https://anybox.com.cn/livez
curl.exe --resolve anybox.com.cn:443:129.211.1.144 -sS -o NUL -w "local_https_readyz=%{http_code}`n" https://anybox.com.cn/readyz
```

确认 bootstrap 已清空、nginx 已停用：

```powershell
ssh anybox-server 'cd /home/ubuntu/anyboxProvider && val=$(grep -E "^ADMIN_BOOTSTRAP_PASSWORD=" .env.tencent | tail -n1 | cut -d= -f2-); echo bootstrap_password_length=${#val}; echo nginx_active=$(systemctl is-active nginx || true)'
```

成功标准：

- `api` 为 `healthy`
- `postgres` 和 `redis` 为 `healthy`
- `worker` 为 `Up`
- `caddy` 绑定 `0.0.0.0:80` 和 `0.0.0.0:443`
- HTTPS `/livez`、`/readyz`、首页返回 `200`
- `bootstrap_password_length=0`

## 交付说明

最终回复用户时报告：

- 部署是否成功
- 备份目录名
- 关键健康检查状态码
- 是否创建了管理员；如果本次生成了临时管理员密码，只报告该临时密码并提醒立即修改
- 是否停用了 nginx
- 任何剩余风险，例如 seed 创建了默认 demo 用户或 Caddyfile 仅有格式化警告
