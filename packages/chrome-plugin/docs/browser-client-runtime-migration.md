# Anybox Browser Client Runtime 迁移设计

状态：Phase 0 已完成；Phase 1/2 首个纵向切片已实现并验证。

本文记录 Anybox Chrome 插件从静态 Browser Facade 迁移到完整 Browser Client
Runtime 的 clean-room 设计。事实来源是本仓库当前源码；Codex Chrome 插件只作为
用户已经确认的行为与架构参考，不复制其实现、私有协议、字符串或服务依赖。

## 审计起点执行链

```text
Chrome 插件 stdio MCP
→ runtime/scripts/node-repl-server.js
→ browser-runtime 构建出的 browser-client.mjs
→ 静态 agent.browsers Facade
→ runtime/scripts/browser-gateway-worker.js
→ runtime/scripts/browser-ipc-client.cjs
→ Anybox Agent BrowserIpcGateway
→ Browser command gateway
→ BrowserExtensionBridge
→ Rust Native Messaging Host
→ Chrome Extension
→ Chrome APIs / CDP
```

首个纵向切片完成后的当前链路为：

```text
Chrome 插件 stdio MCP
→ node-repl-server.js
→ setupBrowserRuntime / BrowserManager / BrowserContext
→ capability-filtered API + Documentation Manifest
→ CommandRouter
→ protected Transport Worker
→ authenticated Browser IPC
→ Agent BrowserPolicyEngine + strict Command Gateway
→ BrowserExtensionBridge
→ Rust Native Messaging Host
→ Chrome Extension defensive validation
→ Chrome
```

当前必须保留的安全能力：

- Runtime 与 Native Host 使用不同 IPC role 和 endpoint。
- Browser IPC v1 使用 broker instance、challenge、nonce 和 HMAC proof。
- Native Host bootstrap proof 短期有效、成功认证后一次性消费。
- IPC proof 只交给 Worker；Node REPL 初始化完成后清除敏感环境变量。
- Native Host 名与 Chrome Extension ID 固定并在多层校验。
- Rust Host 只负责 framing、认证后的透明转发和 Chrome Native Messaging。
- raw page JavaScript 和 full CDP 不在模型 Runtime command contract 中。

## Phase 0 实时代码基线

### 源码、生成物与版本

- 源码根目录是 `packages/chrome-plugin`、`packages/shared` 和
  `packages/anyboxagent`。
- `plugins/Anybox-Plugins/chrome` 是受版本控制的安装包生成物；唯一允许的同步入口是
  `packages/chrome-plugin/tools/package-chrome-plugin.mjs`，不能在该目录手工维护第二份
  实现。
- 审计时插件版本为 0.5.0，Browser Runtime 为 0.2.0，Extension 为 0.1.1，
  Runtime IPC client、Node REPL 和 Rust Host 为 0.3.0。
- Browser IPC protocol 与 Extension protocol 都是 1；Node REPL 对 MCP 暴露
  2025-06-18。新增 Browser Contract 使用独立的 contract version 1，不提升也不
  改写现有传输协议。

本切片交付版本为：插件 0.6.0、Browser Runtime 0.3.0、Extension 0.2.0、
Runtime IPC client/Node REPL 0.4.0。Rust Host 保持 0.3.0，Browser IPC 与
Extension protocol 仍保持 1。

基线验证：

- `chrome-plugin:package:test` 通过：Extension privacy 8 项、Browser Runtime
  8 项、Rust unit 9 项与 bridge 1 项、打包工具 11 项。
- `chrome-plugin:package:check` 通过，生成包共 22 个文件。
- `@anybox/shared` 96 项测试通过。
- Agent 的 extension bridge、IPC gateway 和 Chrome Runtime 定向测试共 23 项通过。
- `plugin.test.ts` 中启动真实 Node REPL 的一个定向用例在本机遇到已有 Named Pipe
  `EADDRINUSE`。这是修改前已存在的环境冲突；迁移不得通过终止用户的 Anybox 进程来
  “修复”测试。

### 当前命令矩阵

| Contract method | Worker 允许 | Agent 当前校验 | Extension 实现 | 主要实现机制 |
| --- | --- | --- | --- | --- |
| `tabs.list` | 是 | 无 params 校验 | 是 | `chrome.tabs.query({})` |
| `tabs.open` | 是 | 无 params 校验 | 是 | `chrome.tabs.create` |
| `tabs.activate` | 是 | 无 params 校验 | 是 | `chrome.tabs.update` |
| `tabs.release` | 是 | 只检查正整数 tabId | 否（Agent 本地清理） | 清理 owned-tab Map |
| `page.snapshot` | 是 | 无 params/result 校验 | 是 | `chrome.scripting.executeScript` |
| `page.interactiveSnapshot` | 是 | 无 params/result 校验 | 是 | scripting，并写入临时 DOM attribute |
| `page.domTree` | 是 | 无 params/result 校验 | 是 | CDP DOM domain |
| `page.accessibilityTree` | 是 | 无 params/result 校验 | 是 | CDP Accessibility domain |
| `page.screenshot` | 是 | 无 params/result 校验 | 是 | CDP Page domain |
| `page.click` | 是 | 无 params/result 校验 | 是 | CDP Input domain |
| `page.clickElement` | 是 | 无 params/result 校验 | 是 | element reference + scripting |
| `page.fill` | 是 | 无 params/result 校验 | 是 | element reference + scripting |
| `page.type` | 是 | 无 params/result 校验 | 是 | CDP Input domain |
| `page.scroll` | 是 | 无 params/result 校验 | 是 | scripting |
| `page.waitFor` | 是 | 无 params/result 校验 | 是 | extension 轮询 |

审计起点的 Extension 内部还实现 `page.executeScript` 与 `cdp.send`，但
Runtime/IPC command enum 不暴露这两条路径。第一纵向切片已经移除这两条可执行实现，
并在 Runtime、Agent contract 与 Extension handler 三层显式拒绝。

### 当前职责与信任边界

| 层 | 当前代码 | 实际职责 | 是否可信策略边界 |
| --- | --- | --- | --- |
| Node REPL | `runtime/scripts/node-repl-server.js` | MCP、持久 globals、超时、图片输出、启动 Worker 后清理 secret env | 否，模型能执行 JavaScript |
| 静态 Facade | `browser-runtime/src/browser-client.ts` | `agent.browsers` 与 Tab 包装、静态文档、本地绑定记录 | 否 |
| Gateway Worker | `runtime/scripts/browser-gateway-worker.js` | 保管 proof、15-method allowlist、转发 | 只能作纵深防御，不能是唯一边界 |
| IPC client | `runtime/scripts/browser-ipc-client.cjs` | framing、challenge/nonce/HMAC、重连、pending response | 传输可信，不理解浏览器权限 |
| Agent IPC gateway | `anyboxagent/src/browser-extension/ipc-gateway.ts` | 两类 role、endpoint、proof、request/response | 认证与路由边界 |
| Command gateway | `anyboxagent/src/browser-extension/command-gateway.ts` | 命令转发和少量 owned-tab bookkeeping | 目标中的权威 Browser Policy 边界 |
| Bridge | `anyboxagent/src/browser-extension/bridge.ts` | Extension 连接、pending、active/owned tab 偏好 | 当前 Map 不是 ownership 证明 |
| Rust Host | `browser-native-host/src/main.rs` | 一次性 bootstrap、Native Messaging framing、透明转发 | 认证传输边界，不承载业务策略 |
| Extension | `browser-extension/src/background/*.ts` | Chrome API/CDP 执行、URL/输入隐私处理 | 浏览器执行与防御性校验边界 |

当前主要缺口：

- `packages/shared/src/browser-ipc.ts` 只精确约束 method，params/result 仍为
  `unknown`。
- `packages/anyboxagent/src/browser-extension/command-gateway.ts` 除 release 的
  tabId 外没有权威 params、result、capability、permission 或 ownership 校验。
- `packages/chrome-plugin/browser-runtime/src/browser-client.ts` 使用静态文档和
  `Record<string, unknown>`，没有 backend discovery 或 capability negotiation。
- Agent 的 owned tab Map 只用于偏好与诊断，不是访问控制证明。
- `tabs.release` 不会通知扩展 detach debugger。
- interactive snapshot 把 `data-anybox-element-id` 写入真实 DOM。
- timeout 只 reject Promise，没有端到端 cancellation。

## 目标模块

```text
setupBrowserRuntime
└─ BrowserManager
   └─ BrowserContext
      ├─ BrowserBackendInfo / Capability
      ├─ API Manifest
      ├─ Documentation Manifest
      ├─ Browser / Tabs / User / Tab / Locator Facade
      └─ CommandRouter（非权威预检）
         └─ Protected Transport Worker
            └─ Agent BrowserPolicyEngine（权威）
               └─ 现有 IPC / Bridge / Rust Host / Extension
```

职责划分：

- Shared Browser Contract 是 command schema、result schema、capability、manifest
  和稳定错误码的唯一来源。
- Browser Client 负责对象模型、易用语义、capability 预检、动态文档和结果展示，
  不是安全边界。
- Worker 只持有 IPC 凭据、维护连接并检查最小 transport envelope。
- Agent 对 contract version、schema、capability、session、permission 和 tab
  ownership 做权威判定；Bridge 在选定实际 active Extension connection 后立即再次
  核对该连接广告的 command capability，关闭异步 policy 阶段发生 backend 切换时的
  TOCTOU 窗口。
- Extension 对参数、资源上限、document/frame identity 和动作前置条件做防御性
  校验。
- Rust Host 保持 browser-command 无感知的透明传输。

### 与当前实现的对应关系

| 目标概念 | Anybox clean-room 实现位置 | 当前组件的处置 |
| --- | --- | --- |
| `setupBrowserRuntime` | `browser-runtime/src/browser-client.ts` 的稳定入口 | 保留入口，替换静态对象组装 |
| BrowserManager | Browser Runtime 新模块/类 | 负责 backend discovery、default 与 URL 选择 |
| BackendTransport | Runtime 到 Worker 的窄接口 | 复用现有 IPC client，不持有 proof |
| BrowserContext | 每次 backend binding 的对象 | 取代会漂移的全局静态 Facade |
| API/Documentation manifest | `packages/shared/src/browser-contract.ts` 生成 | 取代硬编码文档 |
| CommandRouter | Browser Runtime | 只做 schema/capability 预检 |
| Transport Worker | `runtime/scripts/browser-gateway-worker.js` | 移除业务 allowlist，保留凭据与最小 envelope |
| BrowserPolicyEngine | Agent `browser-extension/browser-policy.ts` | 成为 schema/capability/permission/ownership 权威入口 |
| Extension defense | `browser-extension/src/background/commands.ts` | 从同一 contract 校验 params/result |
| IPC/Host/Native Messaging | 原有 IPC client、gateway、bridge、Rust Host | 第一切片不重写 |

## Browser Contract

Browser Contract 使用独立版本，不复用插件、Extension、Native Host 或 IPC package
版本。

第一切片已实现的 `BrowserGetInfoResult` 以 `BrowserBackendInfo` 为 backend，
形态为：

```text
backend
  contractVersion
  browserId
  name
  kind
  connected
  protocolVersion?
  backendVersion?
  capabilities.commands
  capabilities.features
apiManifest
documentationManifest
```

Shared schema仍保留可选 `instanceID` 供未来受信 backend 内部标识使用，但当前 Agent
不会把持久 Extension instance ID 放入模型可见的 `getInfo`。

Feature capability 必须显式表示 tab ownership、user tab claim、locator runtime、
command cancellation、arbitrary page JavaScript、scoped CDP 和 full CDP。未实现的
能力返回 `false`，不能通过文档暗示可用。

API Manifest 的每个 command entry 包含：

```text
method
apiPath
security class
public receiver
public result binding
commandParamsSchema
commandResultSchema
```

Documentation Manifest 使用独立的文档 entry：

```text
method
apiPath
signature
summary
security class
```

Zod runtime schema 是事实来源，机器可读 JSON Schema 从同一 schema 生成。
Manifest 明确区分底层 command schema 与公开 Runtime 的返回绑定：例如
`tabs.list` 的 command result 是 `{tabs:[...]}`，公开 API 则是附带
`BrowserTab` runtime handle 的数组；`tabs.open/activate` 的公开结果是稳定绑定的
`BrowserTab` handle。Client 会按本地 Contract v1 重建 canonical manifest，不把
后端返回的任意 Schema 当成权威执行输入。

Extension `0.2.0` hello 会携带 Browser Contract version 与 command 名列表；Agent
只取当前安全 Contract 的交集。未知未来命令被忽略，Contract version 不匹配时
fail-closed 为零 capability。旧 `0.1.x` Extension 走显式版本矩阵兼容分支，不把
“缺省 capabilities”泛化为未来版本的全能力。

第一切片的公开对象模型：

```text
setupBrowserRuntime({globals})
agent.browsers.list()
agent.browsers.get("extension")
agent.browsers.getDefault()
agent.browsers.getForUrl(url)

browser.browserId
browser.capabilities
browser.status()
browser.documentation()
browser.tabs.list()
```

旧的 `tabs.open/activate/get/current` 与 Tab 高层方法继续由 Compatibility Adapter
调用同一个 CommandRouter，避免出现一条新契约路径和一条绕过 Agent 校验的旧路径。

## Application payload

Browser IPC 的 framing、HMAC 和 protocol v1 不变。`ready` 对 Runtime 可选携带
`applicationCapabilities.runtimeOperations` 与 `browserContractVersions`。新 Runtime
在发送 `getInfo` 前检查该声明；旧 Agent 没有此字段时会得到稳定的
`CONTRACT_VERSION_UNSUPPORTED`，而不会向旧 strict union 发送未知 operation 后等待
断线。operation 使用有界字符串，Runtime 只检查自己需要的成员并忽略未来新增成员，
不会因 Agent 广告 `cancel`/`turnEnded` 等后续能力而让握手失败。插件 0.6.0 的新
Runtime 因此要求支持 Browser Contract v1 的 Agent；当前没有
静默降级到缺少 Agent 权威 Schema/Policy 的旧执行链。

Application payload 是严格 discriminated union，三个 request variant 分别为：

```text
runtime.request(status)
  requestID
  operation: status

runtime.request(getInfo)
  requestID
  operation: getInfo
  contractVersion（必填）

runtime.request(command)
  requestID
  operation: command
  contractVersion（新 command 必填；旧 command 可缺省）
  method
  params
  context
  timeoutMs

runtime.response
  requestID
  ok
  data | error
```

旧 command request 缺省 contract version 时进入 Compatibility Adapter。后续增加
绝对 deadline、cancel、turnEnded 时继续使用向后兼容的 application union；只有
framing、握手或认证语义不兼容时才提升 Browser IPC protocol version。

首个纵向切片的 wire 形态：

```json
{
  "type": "runtime.request",
  "requestID": "opaque-id",
  "operation": "command",
  "contractVersion": 1,
  "method": "tabs.list",
  "params": {},
  "context": {
    "sessionID": "optional-compat",
    "messageID": "optional-compat",
    "toolCallID": "optional-compat"
  }
}
```

```json
{
  "type": "runtime.response",
  "requestID": "opaque-id",
  "ok": false,
  "error": {
    "code": "INVALID_COMMAND_PARAMS",
    "message": "redacted diagnostic",
    "retryable": false
  }
}
```

`getInfo` 请求携带 Runtime 期望的 Browser Contract version；版本不匹配返回
`CONTRACT_VERSION_UNSUPPORTED`，而不是让 Client 把 v2/v1 形态差异误报成无效结果。
它返回经过 schema 验证的 `BrowserBackendInfo`、按 backend command capability 裁剪的
API Manifest 和 Documentation Manifest。稳定错误码至少区分 contract/version、
schema、backend/capability、permission/session/ownership、deadline/cancel 和下游
command failure。

模型可见 `status` 只返回 `connected`、`contractCompatible`、可选
`backendVersion`、`transport`、`protocolVersion`、Runtime/Native Host 连接计数与
`peerProcessIdentityVerified`；broker ID、connection ID、extension instance、session、
owned tabs、last command 和内部 transport error 不会进入 Runtime。Backend `getInfo`
同样不公开持久 extension instance ID。Extension 原始错误保留在受控本地诊断边界，
当前 Agent 只返回稳定 code、retryable 与脱敏文案，不填可选的 `error.details`。
IPC/Node Runtime 为协议演进仍能承载 `details`；未来若启用，Agent 必须先按字段 allowlist
构造并脱敏，不能透传 Extension 的任意对象。

## 权限与标签页所有权

目标 Tab Registry 位于 Agent，key 至少包含 browser、tab、session 和 lease。
状态包括：

```text
agent-owned
user-visible
claimed
deliverable
handoff
released
closed
```

规则：

- Agent 创建的 tab 在 `tabs.open` 成功返回前原子登记。
- 用户 tab 只能由 `user.openTabs` 观察，并通过 `user.claimTab` 原子取得 lease。
- 所有站点内容和交互 command 都必须携带可由 Agent 查证的 session/context 和 tab
  lease。
- `tabs.list` 在新语义中只列 owned/claimed；旧的“列出全部 Chrome tab”只在迁移期
  Compatibility Adapter 中保留。
- `release` 释放 lease 并 detach；`finalize({keep})` 关闭、交付或释放相应 tab，
  不能只清本地 Map。
- Extension/Native Host/Runtime 断线以及 turnEnded 都触发 pending command 和
  lease 清理。

## Locator 与 Frame

Locator 使用不可变 descriptor，不把永久 ID 写入页面：

```text
strategy: role/name | label | text | placeholder | test-id | css
frameChain
filters
nth
documentIdentity
generation
```

动作执行时由 Extension 重新解析 descriptor，并检查：

- 唯一匹配；
- DOM attached；
- visible；
- enabled；
- editable/checkable/selectable；
- frame 与 document identity；
- navigation 后 generation 是否过期。

页面变化后的重试只允许在 descriptor 可重新解析、origin/permission 仍有效且动作
尚未产生不可安全重放的副作用时进行。interactive snapshot 作为兼容层返回带
snapshot/document/generation 的短期 element reference。

## Deadline、取消和清理

目标链路：

```text
AbortSignal
→ Browser Client cancel
→ Worker pending registry
→ Browser IPC cancel
→ Agent command registry
→ Extension cancel
```

Agent timeout 后必须发送 cancel；Extension 的轮询、定位和可中止 CDP 工作需要观察
取消信号。晚到结果不再解析为当前调用结果，只记录有限审计元数据后丢弃。释放、
finalize、turnEnded、Runtime 断线和 Extension 断线都必须 detach debugger 并清理
pending command。

## 隐私

当前 Extension 已对 URL path/query/hash、密码、OTP、token、银行卡字段和 editable
value 做脱敏。迁移期间继续保留，并补充统一结果策略：

- 输入值不进入 result、日志或 error；只返回长度和分类。
- screenshot base64 不进入日志；图片本身属于敏感站点内容。
- title、URL、错误和 Locator metadata 在 Agent 输出前再次按 command policy
  处理。
- raw page JavaScript 和 full CDP 默认恒为 false，不能作为权限绕过路径。

Node REPL 在模型代码运行前绑定 Worker `postMessage` 与 AsyncLocalStorage
`run/getStore`，阻止模型通过修改共享 prototype 直接替换 host 注入 context。
但 `sessionID/messageID/toolCallID` 仍只是兼容标签，不是 ownership proof；Phase 3
必须将 server-issued invocation identity 绑定到已认证 IPC connection/session，
并由 Agent 验证 tab lease，不能把本切片的 prototype hardening 当成最终授权机制。

## 分阶段交付

1. Phase 0：记录版本、链路、命令矩阵和测试基线。
2. Phase 1/2：Browser Contract、getInfo/capabilities、BrowserManager、tabs.list、
   动态文档、Agent/Extension 双重 schema 校验。
3. Phase 3：BrowserPolicyEngine 接入真实 permission/origin grant，Tab Registry、
   user.openTabs、claimTab、finalize 和 turnEnded。
4. Phase 4：Locator、Frame、document identity、generation、navigation 语义。
5. Phase 5：deadline、cancel、disconnect cleanup、debugger detach 和恢复。
6. Phase 6：Clipboard、Downloads、Uploads、Page Assets、DOM CUA、Browser Auth、
   scoped CDP；full CDP 仅显式 developer mode。
7. Phase 7：feature flag、Compatibility Adapter 对比、默认切换和旧 Facade 删除。

每一阶段必须单独构建、测试和回滚。生成安装包只能通过
`tools/package-chrome-plugin.mjs` 从 `packages/chrome-plugin` 源码更新，不手工维护
`plugins/Anybox-Plugins/chrome`。

## 逐文件迁移表

| 文件 | 第一切片 | 后续阶段 |
| --- | --- | --- |
| `packages/shared/src/browser-contract.ts` | 新增 command params/result、BrowserBackendInfo、capability、errors、manifests | ownership、locator、cancel、advanced capabilities |
| `packages/shared/src/browser-ipc.ts` | 增加 getInfo 与 contract version，保持 IPC v1 | cancel、turnEnded、deadline |
| `browser-runtime/src/browser-client.ts` | BrowserManager、Context、Router、动态文档、兼容 Facade | UserTab、Locator/Frame、finalize、CUA 子系统 |
| `runtime/scripts/node-repl-server.js` | 暴露新 Runtime，保留 secret 清理；透传稳定 error code | AbortSignal、turn lifecycle、metadata bridge |
| `runtime/scripts/browser-gateway-worker.js` | 收敛为最小 envelope + transport | pending cancel registry 与断线清理 |
| `runtime/scripts/browser-ipc-client.cjs` | getInfo/错误元数据透传，认证不改 | cancel 与 late-result 隔离 |
| `anyboxagent/src/browser-extension/browser-policy.ts` | 新增 capability/security-class 权威入口 | origin grant、逐动作批准、lease/turn policy |
| `anyboxagent/src/browser-extension/command-gateway.ts` | params → policy → bridge → result 双向严格校验 | atomic claim/finalize/cancel |
| `anyboxagent/src/browser-extension/bridge.ts` | 提供 BrowserBackendInfo 与现有连接事实 | durable Tab Registry、detach/recovery |
| `browser-extension/src/background/commands.ts` | 同源 params 防御校验 | locator/document/frame/cancel/detach |
| `browser-extension/src/background/anybox-client.ts` | 保持 envelope 与结果防御校验 | lifecycle/cancel 消息 |
| `browser-native-host/src/main.rs` | 不修改 | 仅在 framing/认证真的不兼容时升级 |
| `runtime/.anybox-plugin/plugin.json` 与 Skill | 描述动态 capability 和 Agent 权威校验 | 随实际 capability 更新，不提前宣称 |
| `tools/package-chrome-plugin.mjs` | 校验新 Runtime 安全标志并同步生成包 | 保持源码/安装包一致性 |

## 阶段测试与主要风险

| 阶段 | 最小验证 | 主要风险与控制 |
| --- | --- | --- |
| 1/2 Contract + Runtime | shared schema、manifest 裁剪、Manager discovery、tabs.list E2E、旧 Facade tests | strict result 暴露历史输出漂移；逐命令 fixture 锁定 |
| 3 Policy + ownership | cross-session denial、claim race、origin grant、finalize/detach | 假 ownership 比无 ownership 更危险；capability 保持 false 直到全链完成 |
| 4 Locator | uniqueness、hidden/disabled/editable、stale、iframe/navigation | 动作重试可能重复副作用；只重试可证明尚未提交的解析阶段 |
| 5 lifecycle | timeout cancel、late response、disconnect、turnEnded、debugger detach | 传输断线与浏览器动作完成竞态；request registry 使用终态和幂等 cleanup |
| 6 advanced | 每能力独立审批、隐私与 origin/frame negative tests | raw CDP 绕过策略；默认 false 且 Agent 与 Extension 双门 |
| 7 rollout | feature flag A/B、旧新错误对比、package check、Windows Native Messaging E2E | 一次切换面过大；每阶段保持旧 adapter 与可回滚包 |

第一切片不会把 `ownership=false`、`claim=false`、`locator=false` 或 `cancel=false`
包装成已实现能力，也不会把 capability gate 描述成用户 origin 授权。这样后续协议可以
向前扩展，而不会形成错误的安全承诺。

## 第一纵向切片交付状态

已完成：

- `setupBrowserRuntime` 安装 discovery-backed `agent.browsers`。
- BrowserManager 通过 Agent `getInfo` 获取 Extension backend 状态、capability、
  API Manifest 与 Documentation Manifest。
- Extension hello 协商 Browser Contract version/command capability；Agent 取安全
  交集，版本不兼容时 fail-closed，文档随实际 command 集合裁剪。
- `browser.tabs.list()` 及旧 tabs/Tab API 统一经过客户端 CommandRouter 和 Agent
  params → policy → bridge → result 校验。
- 新 v1 command 强制显式 tabId；旧无 contractVersion 请求由 Agent compatibility
  adapter 为页面命令和 `tabs.activate` 解析 session preferred/active tab。
- Worker 已删除 15-method 业务 allowlist，只保留凭据、连接和最小 envelope 校验。
- raw page JavaScript/full CDP 同时在 Runtime、Agent contract 与 Extension 拒绝。
- stable code/retryable 从 Extension、Bridge、Agent IPC、Worker、Node REPL 一直
  传到 MCP structuredContent；下游 URL/path 等原始错误文本在 Agent 边界脱敏。
- 模型可见 status/getInfo 不暴露 broker、connection、session、tab 或持久
  extension instance 诊断标识。
- 组合 E2E 已串起 packaged Node Runtime → Worker → Agent Gateway/Policy → Bridge
  → 认证 Native Host endpoint，并验证 `tabs.list`、结构化结果和动态文档。
- 生成安装包已由 packaging 工具从源码同步并通过一致性检查。

最终回归（2026-07-19）：

- Shared typecheck 通过，10 个文件共 135 项测试通过。
- Extension 12 项、Browser Runtime 12 项、Rust unit 9 项、Windows bridge 1 项、
  packaging 15 项测试通过。
- Agent Bridge/Command Gateway/IPC/packaged Runtime 定向测试 47 项通过；插件市场与
  Chrome Node REPL 加载测试在隔离用户目录下 46 项通过。
- `chrome-plugin:package:check` 通过，生成包 22 个文件；`git diff --check` 通过。
- Agent 全量 `tsc --noEmit` 仍有 8 个审计前已存在、且不位于 browser migration
  文件中的类型错误（permission、cinema/plugin/server tests）；本切片未新增 browser
  路径类型错误。

仍未完成且 capability 保持 false：

- 用户 origin 授权、逐动作确认和强制 tab ownership；
- `user.openTabs/claimTab`、`finalize`、可靠 debugger detach；
- Locator/Frame/document generation 与导航语义；
- 端到端 cancel、turnEnded、deadline 后底层中止和断线恢复；
- feature flag 双 Runtime 切换与真实已安装 Chrome 的人工/自动 E2E。
