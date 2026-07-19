# Anybox Chrome 插件工程

[English](./README.md)

该目录是 Anybox Chrome 集成唯一需要人工维护的源码工程。最终可安装插件单独生成到
`plugins/Anybox-Plugins/chrome`。

## 工程结构

```text
packages/chrome-plugin/
  browser-extension/       Vite/TypeScript Chrome 扩展工程
  browser-runtime/         编译为 browser-client.mjs 的 TypeScript 浏览器 SDK
  browser-native-host/     Rust Native Messaging Host 工程
  docs/                    Browser Contract 与 Runtime 迁移设计
  runtime/                 插件清单、Node REPL MCP 脚本与 Skill 源码
  tools/                   发行目录同步脚本与回归测试
  LICENSE
  README.md

plugins/Anybox-Plugins/chrome/
  .anybox-plugin/          生成后的规范清单
  browser-extension/       生成后的扩展文件
  extension-host/          平台对应的 Rust Native Messaging Host
  scripts/                 生成后的 Node REPL 与浏览器客户端运行时
  skills/                  生成后的 Chrome Skill
  LICENSE
```

开发者只修改 `packages/chrome-plugin`。最终插件目录会提交到 Git，因为 Anybox
通过 GitHub Tree 整目录下载它；这里不使用 ZIP 分发。

## 构建与同步

在仓库根目录运行：

```powershell
corepack pnpm chrome-plugin:package
```

该命令会先对 `browser-runtime/src/browser-client.ts` 做类型检查，再通过
esbuild 打包压缩为 `browser-client.mjs`，随后构建 Chrome 扩展和 Rust
Native Messaging Host，并按严格允许列表替换最终插件目录。生成的
`plugins/Anybox-Plugins/chrome/scripts/browser-client.mjs` 是构建产物，
禁止直接修改。TypeScript/Rust 源码、测试、工程配置、sourcemap、依赖、
缓存和开发文档都不会进入最终插件。

运行打包回归测试：

```powershell
corepack pnpm chrome-plugin:package:test
```

在不修改文件的情况下检查已提交插件目录是否为最新：

```powershell
corepack pnpm chrome-plugin:package:check
```

提交代码时，应同时提交源码变更和重新生成的
`plugins/Anybox-Plugins/chrome`。

## 浏览器控制架构

插件只注册一个持久 `node-repl` MCP Server。模型通过其 `js` 工具使用预加载的
`agent.browsers` Browser Client Runtime 完成 Backend 发现、标签页查询、页面检查、
交互和截图。Runtime 使用版本化 Browser Contract 获取 capability、机器可读 API
Manifest 和动态文档；客户端预检只提供友好错误，Anybox Agent 是已实现 schema 与
capability 检查的权威边界。Extension 0.2.0 会声明 Browser Contract 版本与命令
集合，Agent 只暴露安全交集，并在版本不匹配时 fail-closed。第一切片会把
permission/ownership 生命周期能力明确
标为不可用，直到对应策略阶段真正完成。原始页面脚本与 full CDP 默认关闭；插件不再
注册逐动作的 `browser_*` MCP 工具。

隔离的 Browser Transport Worker 只保管 IPC 凭据并通过认证本机 IPC 连接 Anybox
Agent Browser Policy Gateway。Rust Native Messaging Host 使用独立的认证 IPC endpoint，
之后继续使用 Chrome 规定的 Native Messaging stdio framing。Windows 使用
Named Pipe，macOS/Linux 使用 Unix Domain Socket。生产环境不会自动回退到
HTTP 或 WebSocket 浏览器控制链路。持久化的 Native Host runtime config
只保存非秘密 IPC 定位信息和协议元数据；短时、一次性的 bootstrap proof
由 Agent 轮换，并在认证成功后删除。

仓库中的跨进程集成测试已实际覆盖 Windows Named Pipe。Unix Domain Socket
实现复用同一 framing 与认证合同，但本次 Windows 验证没有执行该平台路径。
当前运行时也尚未校验对端 PID/SID/uid；OS ACL 与短期 proof 能缩小暴露面，
但不能替代签名级进程来源证明。

完整迁移设计、ownership/Locator/cancellation 目标和分阶段交付边界见
[Browser Client Runtime 迁移设计](./docs/browser-client-runtime-migration.md)。

## Native Host 交付

与 Codex Chrome 插件一样，Native Messaging Host 由可下载插件自身交付。
当前平台二进制生成到 `extension-host/<platform>/<architecture>/`，
`scripts/installManifest.mjs` 会为当前用户注册 Chrome Native Messaging
清单，并让清单直接指向插件包内的二进制。Anybox 桌面安装包不再重复携带 Host。
