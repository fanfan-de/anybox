# Anybox Connector 开发指南

本文档说明如何在当前 `anybox` 项目里新增、维护和发布 Connector。这里的 Connector 指 Anybox 平台级或插件级的外部系统连接能力，例如 Gmail、飞书、Slack、GitHub、数据库、浏览器、本地文件等。

## 设计原则

Connector 是 Anybox 的平台能力，不应该默认属于某个单独插件。插件可以声明自己依赖某个 Connector，用户只需要连接一次，多个插件就可以复用。

核心原则：

- 普通用户只做授权或填写必要的自建应用凭证，不理解 OAuth 细节。
- 插件不保存第三方平台密钥，不把 OAuth client secret 写进插件 manifest。
- 全局 MCP 配置只保存 `connectorId`，不保存 token、API key、App Secret。
- Connector runtime 在真正启动 MCP server 时才解析凭证，并只在内存中注入。
- 新 connector 默认先做最小可用读能力，再逐步增加写能力和高风险权限。

当前已有两类参考实现：

- Gmail：Anybox 官方构建注入 Google OAuth client metadata，用户一键授权。
- Feishu：用户自建飞书应用，用户本地填写 App ID/App Secret，再授权自己的飞书账号。

## 代码地图

主要入口：

- `packages/anyboxagent/src/connector/connector.ts`
  平台 Connector 定义、状态、配置保存、OAuth 启动、runtime 解析、MCP binding 同步和诊断。

- `packages/anyboxagent/src/auth/provider-auth.ts`
  通用 OAuth/PKCE 流程、token exchange、refresh、revoke、credential 保存。

- `packages/anyboxagent/src/auth/auth.ts`
  本地 credential store。当前落盘为 agent data 目录下的 `auth.json`，文件权限尽量设为 `0600`。

- `packages/anyboxagent/src/plugin/plugin.ts`
  插件 manifest、`connectorRequirements`、插件自带 connector 的安装和 runtime binding。

- `packages/anyboxagent/plugins/builtin/<connector>/0.1.0/`
  内置 connector 对应的内置插件包、skill 和本地 MCP wrapper。

- `packages/desktop/src/renderer/src/app/connectors/ConnectorsPage.tsx`
  桌面端 Connector 管理页。

- `packages/desktop/scripts/prepare-agent-runtime.mjs`
  打包 managed agent runtime，并复制内置 connector MCP wrapper。

- `packages/desktop/scripts/verify-agent-runtime.mjs`
  验证发布运行时是否包含必需 connector 文件。

## Connector 类型

### 1. Anybox 托管 OAuth Connector

适合 Gmail 这类希望普通用户开箱即用的集成。

特征：

- OAuth client metadata 由 Anybox 维护。
- 官方发布包在 CI/构建机注入 client ID 或其他 metadata。
- 用户只点击连接并授权。
- catalog 可以暴露 client ID，但绝不能暴露 client secret。

示例：Gmail。

实现位置：

- `builtinDefinitions()` 中定义 `gmail`
- `ConnectorBuildConfig` 读取 `gmailOAuthClientID` 和 `gmailOAuthClientSecret`
- `oauthConfigForCredential()` 只在 token exchange 时注入 managed secret

### 2. 用户自建 OAuth App Connector

适合飞书这类个人开发者阶段无法申请商店应用、但用户可以创建自建应用的集成。

特征：

- 用户在连接页填写 App ID/App Secret。
- App Secret 存在本地 credential store，不进入源码、manifest、MCP config 或 catalog 响应。
- 保存配置后才允许发起 OAuth。
- 后续拿到企业主体或商店应用资质后，可以新增一个官方托管版 Connector，保留自建应用版给高级用户。

示例：Feishu。

关键字段：

```ts
credential: {
  kind: "oauth",
  label: "Feishu Custom App",
  clientIDConfigKey: "FEISHU_APP_ID",
  clientSecretConfigKey: "FEISHU_APP_SECRET",
  authorizationURL: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
  tokenURL: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
  scopes: ["offline_access"],
  tokenEndpointAuthMethod: "client_secret_post",
  tokenRequestFormat: "json"
}
```

### 3. API Key Connector

适合没有 OAuth 的服务，或者企业内部服务。

特征：

- 用户输入 API key。
- key 存在 credential store。
- runtime 用 `${API_KEY}` placeholder 注入。

示例字段：

```ts
credential: {
  kind: "api_key",
  key: "DOCS_API_KEY",
  label: "Docs API key",
  type: "password",
  required: true,
  secret: true
}
```

### 4. Remote MCP Connector

适合第三方本身提供远程 MCP server 的情况。

特征：

- runtime transport 为 `remote`。
- `serverUrl`、`authorization`、`headers` 可以使用 credential placeholder。
- 如果使用 OAuth，默认会把 access token 放入 Authorization header，除非 `tokenPlacement` 改为其他 header。

## 平台 Connector 新增流程

以下流程适用于新增一个内置平台 connector。

### 1. 明确产品形态

先回答这些问题：

- 面向普通用户是否能一键授权？
- 是否需要企业主体、商店应用或 admin 安装？
- 用户是否必须自己创建第三方开发者应用？
- 初版只读还是需要写能力？
- 第三方 API 是否有租户、组织、工作区边界？
- token 是否可以 refresh？是否需要额外的 app token？

不要先写代码。Connector 的授权模型如果选错，后面 UI、存储、权限和发布都会返工。

### 2. 添加或复用内置插件包

内置 connector 推荐同时提供一个内置插件包，用于声明 `connectorRequirements` 和 skill。

目录：

```text
packages/anyboxagent/plugins/builtin/<id>/0.1.0/
  .anybox-plugin/
    plugin.json
  connectors/
    <id>/
      server.js
  skills/
    <id>/
      SKILL.md
```

插件 manifest 不直接存 OAuth client secret。它只声明依赖平台 Connector：

```json
{
  "name": "feishu",
  "version": "0.1.0",
  "description": "Read Feishu profile and documents.",
  "skills": "skills",
  "connectorRequirements": [
    {
      "connector": "feishu",
      "tools": ["feishu_profile", "feishu_search_files"],
      "permissions": ["Read Feishu profile.", "Search Feishu files."],
      "required": true,
      "reason": "User-authorized Feishu access through the Anybox Feishu connector."
    }
  ]
}
```

### 3. 在 `connector.ts` 注册平台定义

在 `builtinDefinitions()` 中新增定义。

必填信息：

- `id`
- `name`
- `description`
- `publisher`
- `risk`
- `permissions`
- `tools`
- `credential`
- `runtime`
- `installReview`
- `available`

本地 stdio runtime 示例：

```ts
runtime: {
  transport: "stdio",
  command: "node",
  args: [serverPath],
  cwd: connectorRoot,
  env: {
    SERVICE_ACCESS_TOKEN: "${OAUTH_ACCESS_TOKEN}",
    SERVICE_TOKEN_TYPE: "${OAUTH_TOKEN_TYPE}"
  },
  timeoutMs: 10000
}
```

注意：

- `available` 应该检查 runtime 文件是否存在。
- 官方托管 OAuth 可以额外检查 build config 是否存在。
- 自建应用 OAuth 不应因为用户还没填 App ID/App Secret 就 `available: false`；应该 `available: true`，但 `configured: false`。

### 4. 如果需要用户配置，使用 `configFields`

用户自建应用版 Connector 使用 `configFields`：

```ts
configFields: [
  {
    key: "FEISHU_APP_ID",
    label: "Feishu App ID",
    type: "text",
    required: true,
    placeholder: "cli_xxxxxxxxxxxxxxxx"
  },
  {
    key: "FEISHU_APP_SECRET",
    label: "Feishu App Secret",
    type: "password",
    required: true,
    secret: true
  }
]
```

再在 OAuth credential 上引用：

```ts
clientIDConfigKey: "FEISHU_APP_ID",
clientSecretConfigKey: "FEISHU_APP_SECRET"
```

保存路径：

- Renderer 收集输入。
- Electron main 调 `/api/connectors/:connectorID/config`。
- Agent 调 `Connector.saveConnectorConfig()`。
- App ID/App Secret 存到 `Auth.OAuthClientRegistrationRecord`。
- API 响应只返回 `configured` 和脱敏后的 `configurationLabel`。

### 5. 实现 MCP wrapper

内置本地 wrapper 放在：

```text
packages/anyboxagent/plugins/builtin/<id>/0.1.0/connectors/<id>/server.js
```

当前本地 wrapper 直接实现最小 JSON-RPC MCP，不依赖 SDK。必须支持：

- `initialize`
- `tools/list`
- `tools/call`
- `ping`
- `roots/list`

工具返回格式：

```js
{
  content: [{ type: "text", text }],
  structuredContent,
  isError: false
}
```

错误也通过 MCP tool result 返回：

```js
{
  content: [{ type: "text", text: message }],
  structuredContent: { error: message },
  isError: true
}
```

wrapper 只从环境变量读取 token/API key，例如：

```js
const ACCESS_TOKEN = process.env.FEISHU_ACCESS_TOKEN || ""
```

不要让 wrapper 读取源码里的 secret，也不要把 token 打印到 stdout/stderr。

### 6. 接入发布运行时

如果是内置本地 wrapper，需要更新：

- `packages/desktop/scripts/prepare-agent-runtime.mjs`
- `packages/desktop/scripts/verify-agent-runtime.mjs`

打包脚本需要复制：

```text
packages/anyboxagent/plugins/builtin/<id>/0.1.0/connectors/<id>/server.js
```

到：

```text
packages/desktop/build/agent-runtime/connectors/<id>/server.js
```

`verify-agent-runtime.mjs` 要把新文件加入 required files。

### 7. 如果 schema 扩展，更新桌面类型和 IPC

当你新增 ConnectorDefinition 字段时，需要同步这些文件：

- `packages/desktop/src/main/types.ts`
- `packages/desktop/src/renderer/src/app/types.ts`
- `packages/desktop/src/shared/desktop-ipc-contract.ts`
- `packages/desktop/src/preload/index.ts`
- `packages/desktop/src/main/ipc.ts`

如果只是新增一个 connector 定义，而没有新增字段，通常不需要改这些。

### 8. UI 接入

当前 `ConnectorsPage.tsx` 已支持：

- connector 列表
- OAuth/API key 状态
- `configFields` 表单
- 保存配置
- 清除配置
- sign in / reconnect / disconnect
- diagnose

新增 connector 时优先通过定义字段驱动 UI，不要写 connector 专属分支。只有在第三方确实需要特殊步骤时，再考虑增加通用 metadata，而不是硬编码 `if connector.id === "xxx"`。

## OAuth 设计细节

### Authorization URL

通用 OAuth 会自动加：

- `response_type=code`
- `client_id`
- `redirect_uri`
- `scope`
- `state`
- `code_challenge`
- `code_challenge_method=S256`

额外参数通过 `authorizationParams` 添加。

### Token exchange

当前支持：

- `tokenEndpointAuthMethod: "none"`
- `tokenEndpointAuthMethod: "client_secret_post"`
- `tokenEndpointAuthMethod: "client_secret_basic"`
- `tokenRequestFormat: "form"`
- `tokenRequestFormat: "json"`

标准 OAuth 返回：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "token_type": "Bearer",
  "scope": "..."
}
```

飞书风格返回也支持：

```json
{
  "code": 0,
  "data": {
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

如果新平台 token response 更特殊，优先在 `provider-auth.ts` 增加通用解析能力；只有确实无法泛化时再做 provider-specific 分支。

### Refresh

`resolvePlatformRuntime()` 会调用 `ProviderAuth.resolveGenericOAuthCredential()`。如果 access token 接近过期，会尝试 refresh，然后再注入 runtime。

因此 MCP wrapper 不需要自己刷新 token。

## 安全规则

必须遵守：

- 不把 API key、App Secret、refresh token 写入全局 MCP config。
- 不在 connector catalog 响应里返回 App Secret。
- 不把 secret 写入 `plugin.json`。
- 不把用户自建应用 secret 写进 `build/agent-runtime/config/connectors.json`。
- 不在 MCP wrapper stdout/stderr 打印 token。
- 读能力和写能力分开设计，写工具必须标记风险和权限。
- OAuth scope 最小化，能只读就先只读。

当前限制：

- credential store 当前是本地 `auth.json` 文件，不是系统 Keychain。以后如果要提高安全性，应把 `Auth` 层替换或桥接到系统凭据存储，而不改变 Connector API。

## 测试清单

Agent 侧：

```powershell
cd C:\Projects\anybox\packages\anyboxagent
bun test Test/plugin.test.ts
bunx tsc --noEmit -p tsconfig.json
```

Desktop 侧：

```powershell
cd C:\Projects\anybox\packages\desktop
npm run typecheck
npx vitest run src/renderer/src/app/connectors/ConnectorsPage.test.tsx src/main/managed-agent.test.ts
npm run build:agent-runtime
npm run verify:agent-runtime
```

新增 connector 至少补这些测试：

- catalog 能列出 connector。
- secret 不出现在 catalog 响应。
- 未配置时不能启动 OAuth。
- 保存配置后 `configured: true`。
- OAuth authorization URL 不包含 secret。
- token exchange 请求包含必要 client secret。
- runtime 解析后只注入 access token，不注入 refresh token。
- MCP diagnostic 能列出工具。

## 新增 Connector 检查表

1. 明确授权模型：官方托管、用户自建应用、API key、远程 MCP。
2. 明确最小 scope 和初版工具列表。
3. 在 `connector.ts` 添加平台定义。
4. 如果需要本地 wrapper，新增 `plugins/builtin/<id>/0.1.0/connectors/<id>/server.js`。
5. 如果需要插件依赖，新增或更新 `.anybox-plugin/plugin.json` 的 `connectorRequirements`。
6. 如果需要 skill，新增 `skills/<id>/SKILL.md`。
7. 更新 `prepare-agent-runtime.mjs` 和 `verify-agent-runtime.mjs`。
8. 如果新增 schema 字段，同步 main/preload/renderer/shared 类型。
9. 更新或补充 `ConnectorsPage` 测试。
10. 更新 `Test/plugin.test.ts` 覆盖 auth/config/runtime。
11. 跑完整验证命令。
12. 用真实第三方应用做一次手动连接测试。

## 什么时候不要做内置 Connector

以下情况先不要内置：

- 第三方平台强制企业审核，而你还没有主体。
- API 文档不稳定，无法确认 scope 和 endpoint。
- 只能通过用户手动复制长 token，且 token 权限过大。
- 初版只服务一个插件，且不会被其他插件复用。
- 需要高风险写权限，但没有清晰的用户确认和审计设计。

这种情况可以先做插件自带 connector 或实验性 registry connector，等授权模型清楚后再上升为 Anybox 平台级资源。
