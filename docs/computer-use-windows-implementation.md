# Anybox Windows Computer Use 当前实现

> 状态：M8 插件完全所有制架构
> 更新：2026-07-21
> 平台：Windows 11 x64

一句话结论：Computer Use 的业务、运行时、原生 helper、安全策略、状态和文档全部位于
`plugins/Anybox-Plugins/computer-use-windows`；Anybox 核心只提供通用 Node REPL 和通用权限/图片/生命周期服务。

## 1. 产品边界

安装 `computer-use-windows` 插件会带来 Windows Computer Use；禁用或卸载插件会移除这项能力。

核心中不存在：

- `anybox.computer-use` 内建 MCP；
- Computer Use MCP 工具或 schema；
- Computer Use facade、broker、helper transport 或操作路由；
- Computer Use 专用 permission scope、应用授权数据库或 telemetry；
- Desktop Computer Use 设置页、overlay 或专用 IPC；
- Agent/Desktop 打包阶段复制的 Computer Use helper。

保留的 `anybox.node-repl` 是 Anybox 通用模型运行时。它同时可以承载 Chrome、Computer Use 和其他插件的 JavaScript client，但不包含这些插件的业务逻辑。

## 2. 组件归属

| 组件 | 所有者 | 作用 |
|---|---|---|
| `.anybox-plugin/plugin.json` | 插件 | 声明 Skill 与通用 Node REPL 依赖 |
| `skills/computer-use/SKILL.md` | 插件 | 告诉 Agent 如何加载并使用 `sky` |
| `scripts/computer-use-client.mjs` | 插件 | `sky` API、公开对象映射、审批、图片回传、生命周期 |
| `scripts/runtime.cjs` | 插件 | 14 个内部操作、策略、状态和 helper 调用 |
| `scripts/lib/*` | 插件 | helper client、frame、policy、窗口/状态注册表 |
| `helper/win32-x64/*` | 插件 | 随包分发的 Windows helper 与 SHA-256 |
| `helper/ComputerUse.Helper/*` | 插件 | WGC、UIA、SendInput、Win32 与最终安全校验源码 |
| `anybox.node-repl` | 核心通用设施 | session 级持久 JS、通用权限、图片、request metadata、生命周期 hook |

## 3. 模型调用链

```text
Agent
  ↓ 调用通用 js 工具
Anybox Node REPL（无 Computer Use 业务）
  ↓ import 安装插件中的 computer-use-client.mjs
插件 sky client
  ↓ 直接调用插件 runtime.cjs
插件 HelperClient
  ↓ current-user named pipe + length-prefixed JSON frame
插件随包 Windows helper
  ↓
Windows Graphics Capture + UI Automation + SendInput + Win32
```

这里仍能看到 Node REPL，是因为它是 Anybox 的通用 JavaScript 执行入口。Computer Use 本身不再注册、生成或调用任何专用 MCP server。

## 4. 安装与插件详情

插件 manifest 只有一个运行时要求：

```json
{
  "mcp": "node-repl",
  "tools": ["js", "js_reset"],
  "required": true
}
```

因此插件详情最多显示通用 Node REPL，不应再显示“电脑控制 / `computer-use` / `anybox.computer-use`”条目。插件本身没有 `mcpServers`。

安装器会把完整插件目录复制到版本化安装根目录，包括 client、runtime、lib、Skill、helper 和文档。项目启用插件时，只解析通用 Node REPL requirement。卸载插件不会删除 Node REPL，因为 Node REPL 属于平台且可能被其他插件使用。

## 5. `sky` API

Agent 按 Skill 从已安装插件的绝对路径加载：

```js
const { setupComputerUseRuntime } = await import(
  "<installed-plugin-root>/scripts/computer-use-client.mjs"
);
await setupComputerUseRuntime({ globals: globalThis });
```

该初始化只对当前 Anybox session 有效。session 改变或调用 `js_reset` 时，核心会终止并重建
Node kernel，插件必须在新 kernel 中再次执行初始化；这避免 `sky`、窗口句柄、模块缓存或后台资源
在不同会话之间泄漏。

公开只暴露安全包装后的对象：

- 读取：`list_apps`、`list_windows`、`get_window`、`get_window_state`；
- 动作：`launch_app`、`activate_window`、`click`、`scroll`、`press_key`、`type_text`、`set_value`、`perform_secondary_action`、`drag`；
- 文档：`documentation("api" | "guidance" | "confirmations")`。

公开 `Window` 只有稳定的插件内数字 ID、app ID 和可选标题。原生 HWND、进程路径、`windowRef`、`stateRef` 和 helper launch selector 均留在插件内部。

## 6. 审批

审批能力本身是平台通用接口：`nodeRepl.requestPermission`。Computer Use 对什么操作审批、展示什么、风险多高、哪些字段脱敏，全部由插件决定。

- 每个 turn 首次观察某个应用的截图/UIA 时，插件请求一次 `plugin-action` 决策；
- 每个 launch/input 动作单独请求一次决策；
- `text` 与 `value` 只展示字符数；
- `auth_or_secret`、`finance`、`security_settings` 在插件内硬拒绝，不进入审批；
- 核心 `plugin-action` scope 不包含 Computer Use 操作枚举和参数解释。

权限等待通过 Node REPL 的 continuation 在同一 JavaScript Promise 中继续；用户决策时间不计入正常 JS 执行超时。

## 7. 状态安全

插件 client 和 runtime 共同保证：

- 每次动作必须来自最新 `get_window_state`；
- 状态默认 30 秒过期；
- 一个状态最多消费一次，失败也消费；
- 一个提交的 JavaScript 片段最多执行一个状态改变；
- 新观察会使同窗口旧状态失效；
- turn/session 结束、reset、transport close 会关闭 helper 并清空映射；
- 物理 Esc 会终止 helper，并在当前 turn 内熔断插件。

helper 在输入前再次校验窗口身份、进程开始时间、DPI、前台窗口、点归属、UIA revision、物理输入 epoch、桌面和完整性级别。JavaScript 检查不是最后一道防线。

## 8. Helper 所有权与协议

`HelperClient` 从当前安装插件目录解析 helper，不接受核心注入的 Computer Use 路径。启动前总是校验相邻 SHA-256；设置 `ANYBOX_COMPUTER_USE_REQUIRE_SIGNATURE=1` 时还要求 Authenticode 状态为 `Valid`。

每次启动使用：

- 随机 named-pipe 名称；
- 256-bit 一次性 token；
- 当前用户 pipe ACL；
- 单客户端；
- parent PID 与连接 client PID 校验；
- 4 字节长度帧和 8 MiB 上限；
- 串行请求、abort、timeout 和异常重启。

这些协议实现和 helper 二进制随插件升级、降级、禁用和卸载，不再参与 Agent/Desktop runtime 打包。

## 9. 迁移旧安装

核心只保留一个精确的迁移墓碑：同步内建运行时时，如果发现历史 Anybox-owned canonical `anybox.computer-use` 记录，就删除该记录和项目选择。

这个墓碑：

- 不注册或启动 server；
- 不提供工具、诊断或设置 UI；
- 不删除同名但 owner 不是历史 Anybox canonical binding 的用户自有 server；
- 可以在旧用户升级完成、迁移窗口结束后再移除。

## 10. 关键验收

```powershell
# 插件自测
Set-Location plugins\Anybox-Plugins\computer-use-windows
$tests = (Get-ChildItem tests -Filter '*.test.mjs' -File).FullName
node --test $tests
node scripts/verify-package.mjs

# 真实 Manager → Node REPL → plugin → helper
Set-Location ..\..\..\packages\anyboxagent
bun test Test/computer-use-plugin-node-repl-integration.test.ts

# 退役项、安装生命周期和通用 permission
bun test Test/retired-computer-use-builtin.test.ts `
  Test/plugin.test.ts `
  Test/node-repl-mcp.test.ts `
  Test/permission.test.ts

# Desktop 打包只保留通用 Node REPL
Set-Location ..\desktop
corepack pnpm run build:agent-runtime
node scripts/smoke-node-repl-runtime.mjs
```

最终仓库扫描应满足：除迁移墓碑和明确的“不存在”测试外，Agent/Desktop 源码不含 `anybox.computer-use`、`callPluginCapability`、Computer Use facade/broker/helper transport 或专用 UI。
